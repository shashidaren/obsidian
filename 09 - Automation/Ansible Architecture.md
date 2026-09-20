# Ansible Architecture

## Concept

Ansible is an agentless configuration and orchestration tool. A control node reads inventory, variables, and playbooks, then pushes desired state to managed hosts over SSH (or another connection plugin) using modules.

There is no world-state file. Each run asks the host what is true *now*, then the module decides `ok` / `changed` / `failed` / `skipped`. That is the whole architecture: inventory + vars + modules, evaluated fresh every time.

## Why it matters

- Idempotent playbooks make routine change safer than a night of ad-hoc SSH
- Most "Ansible is broken" incidents are inventory, variables, or connectivity — not YAML syntax
- Variable precedence and inventory grouping decide what actually lands on a host
- Roles and collections are how teams reuse and version operational knowledge
- Without a state file, *drift detection* is "run `--check --diff`" or an external CMDB, not `terraform plan`

If you cannot answer "which inventory, which vars, which play ran on this host", you cannot debug a surprise change.

## Mental Model

```
Control node
  ansible.cfg     → how we connect, forks, become, collections path
  inventory       → which hosts, which groups, host/group vars
  extra-vars / vault
  playbook        → plays → roles / tasks → modules + handlers
       |
       | connection plugin (usually SSH)
       v
Managed host
  facts gathered → module python/json → changed / ok / failed / skipped
```

Key pieces:

- **Inventory** — static files, dynamic scripts, or inventory plugins (cloud, CMDB, Kubernetes)
- **Play** — hosts + become + vars + list of tasks. One playbook can have many plays.
- **Module** — the unit of work (`dnf`, `copy`, `systemd`, `template`). Prefer these over `shell`.
- **Role** — reusable bundle of tasks, handlers, templates, defaults, vars
- **Collection** — versioned namespace of modules + roles + plugins (`ansible.posix`, `community.general`)
- **Facts** — host data collected at play start (`ansible_facts`). Can be cached; cache staleness is a real bug.
- **Handlers** — run once at end of play (or on `flush_handlers`) if notified by a `changed` task
- **No state file** — unlike Terraform, Ansible does not remember last apply. Rerun is the source of truth.

Variable precedence (simplified, lowest → highest):

```
role defaults
  inventory group_vars / host_vars
    play / role vars
      set_facts / registered results
        extra-vars (-e)     ← wins almost everything
```

When two groups both define `ntp_servers`, the more specific group (and then host_vars, then `-e`) wins. Print the host, do not argue from memory.

## Key Commands

```bash
# Inventory and targeting
ansible-inventory -i inventory/ --list --yaml | less
ansible-inventory -i inventory/ --graph
ansible-inventory -i inventory/ --host web01
ansible all -i inventory/ --list-hosts
ansible web -i inventory/ -m ping

# Ad-hoc facts and one-off modules
ansible web -i inventory/ -m setup | less
ansible db  -i inventory/ -m command -a 'uptime' --become

# Playbook runs
ansible-playbook -i inventory/ site.yml --check --diff
ansible-playbook -i inventory/ site.yml --limit web01 -vv
ansible-playbook -i inventory/ site.yml --tags packages --skip-tags reboot
ansible-playbook -i inventory/ site.yml -e 'target_env=prod'
ansible-playbook -i inventory/ site.yml --start-at-task "Install nginx"

# What config is actually in effect on this control node
ansible-config dump --only-changed
ansible --version
ansible-galaxy collection list

# Syntax / lint (when available)
ansible-playbook --syntax-check site.yml
ansible-lint site.yml
```

`--check` is not a guarantee of a safe apply. Some modules do not implement a real dry-run. Treat check mode as a hint, then apply with `--limit` and `--diff`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Host missing from run | Wrong inventory, group, or `--limit` | `ansible-inventory --graph`, `--list-hosts` |
| Vars not what you expected | Precedence, wrong group, extra-vars | `ansible-inventory --host <name>` |
| `UNREACHABLE` | SSH, DNS, firewall, `ansible_host`, keys | `ansible <host> -m ping -vvv` |
| `MISSING sudo password` / become fail | become method, sudoers, tty | `-b`, `ansible_become_*`, sudoers |
| Task always `changed` | Non-idempotent module / command | Prefer dedicated modules over raw `shell` |
| Role / collection "not found" | `roles_path`, `COLLECTIONS_PATHS`, cwd | `ansible-config dump --only-changed` |
| Facts look empty / wrong | `gather_facts: false`, fact cache stale | Re-run with facts on; check cache plugin |
| Prod play used staging values | Default inventory includes too much | Separate inventories; require `-i` |
| Handler never ran | Notify name mismatch, task not `changed` | Compare notify string to handler name |

## Investigation Tips

- Reproduce on **one host** with `--limit` and `-vv` before blasting the fleet.
- Print effective inventory for the host: `ansible-inventory --host name`. If the address or group is wrong, the playbook is a distraction.
- Prefer modules over `shell`/`command` so reruns stay idempotent and `--check`/`--diff` have a chance.
- Keep secrets out of git; use Vault or an external secret source. A leaked vault password is a production incident.
- Separate inventories (or extra-vars) for prod vs non-prod. A default inventory that includes prod is a landmine.
- Collections and roles should be pinned (versioned requirements file), not "whatever Galaxy served today".
- `serial:` and `max_fail_percentage` are architecture, not afterthoughts. Decide blast radius before the first apply.
- Fact caching speeds large fleets and lies after a hardware change. Know the TTL.

## Related Notes

- [[Ansible Troubleshooting]]
- [[SSH Hardening and Troubleshooting]]
- [[Change Management]]
- [[Secrets Management]]
- [[IaC Drift]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The outage was not "Ansible applied the wrong template". It was `group_vars/all` winning over the env-specific file nobody realized was unused. `ansible-inventory --host` would have shown the resolved var in ten seconds.
- `--check` on a play full of `command:` tasks reported 0 changes and then the real run restarted every service. Dry-run only counts if the module implements it.
- Pinning collections in `requirements.yml` ended the class of bugs where Friday's Galaxy pull changed module defaults and Monday's apply touched 200 hosts.
