# Ansible Architecture

## Concept

Ansible is an agentless configuration and orchestration tool. A control node reads inventory, variables, and playbooks, then pushes desired state to managed hosts over SSH (or another connection plugin) using modules.

## Why it matters

- Idempotent playbooks make routine change safer than ad-hoc SSH
- Most "Ansible is broken" incidents are inventory, variables, or connectivity — not YAML syntax
- Variable precedence and inventory grouping decide what actually lands on a host
- Roles and collections are how teams reuse and version operational knowledge

If you cannot answer "which inventory, which vars, which play ran on this host", you cannot debug a surprise change.

## Mental Model

```
Control node
  inventory  → which hosts, which groups
  vars       → group_vars / host_vars / extra-vars / facts / role defaults
  playbook   → plays → tasks → modules
       |
       | SSH (or ansible_connection)
       v
Managed host
  facts gathered → module executed → changed / ok / failed / skipped
```

Key pieces:

- **Inventory** — static files, dynamic scripts, or inventory plugins (cloud, CMDB)
- **Play** — hosts + become + vars + list of tasks
- **Module** — the unit of work (`yum`, `copy`, `systemd`, `template`)
- **Role** — reusable bundle of tasks, handlers, templates, defaults
- **Facts** — host data collected at the start of a play (`ansible_facts`)
- **State file is not a thing** — unlike Terraform, Ansible does not store a world-state file; each run evaluates current host state through modules

Variable precedence (simplified, lowest → highest):

```
role defaults
  inventory group_vars / host_vars
    play vars
      extra-vars (-e)     ← wins almost everything
```

## Key Commands

```bash
# Inventory and targeting
ansible-inventory -i inventory/ --list --yaml | less
ansible-inventory -i inventory/ --graph
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

# See what a host will actually get
ansible-inventory -i inventory/ --host web01
ansible-config dump --only-changed

# Syntax / lint (when available)
ansible-playbook --syntax-check site.yml
ansible-lint site.yml
```

`--check` is not a guarantee of a safe apply. Some modules do not implement a real dry-run.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Host missing from run | Wrong inventory, group, or `--limit` | `ansible-inventory --graph`, `--list-hosts` |
| Vars not what you expected | Precedence, wrong group, extra-vars | `ansible-inventory --host <name>` |
| `UNREACHABLE` | SSH, DNS, firewall, `ansible_host`, keys | `ansible <host> -m ping -vvv` |
| `MISSING sudo password` / become fail | become method, sudoers, tty | `-b`, `ansible_become_*`, sudoers |
| Task always `changed` | Non-idempotent module / command | Prefer dedicated modules over raw `shell` |
| Role "not found" | `roles_path`, collections, cwd | `ansible-config dump --only-changed` |
| Facts look empty / wrong | `gather_facts: false`, fact cache stale | Re-run with facts on; check cache plugin |

## Investigation Tips

- Reproduce on **one host** with `--limit` and `-vv` before blasting the fleet.
- Print effective inventory for the host: `ansible-inventory --host name`. If the address or group is wrong, the playbook is a distraction.
- Prefer modules over `shell`/`command` so reruns stay idempotent and `--check`/`--diff` have a chance.
- Keep secrets out of git; use Vault or an external secret source. A leaked vault password is a production incident.
- Separate inventories (or extra-vars) for prod vs non-prod. A default inventory that includes prod is a landmine.
- Collections and roles should be pinned (versioned requirements file), not "whatever Galaxy served today".

## Related Notes

- [[Ansible Troubleshooting]]
- [[SSH Hardening and Troubleshooting]]
- [[Change Management]]
- [[Secrets Management]]
- [[IaC Drift]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
