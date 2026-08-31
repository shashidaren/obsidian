# Ansible Troubleshooting

## Concept

Ansible failures cluster in a few layers: inventory resolution, SSH/connection, privilege escalation, module execution, and variable/fact surprises. Debug by isolating the layer, not by adding `-vvvv` to a 200-host play and hoping.

## Why it matters

- A failed play mid-rollout leaves the fleet split-brained
- `changed` on every run hides real drift and makes reviews useless
- Become and SSH problems look like "Ansible is down" when the host is fine
- One bad variable in `group_vars/all` can hit every environment

Narrow reproduction is the whole game.

## Mental Model

```
Failure layer checklist (top → bottom):

1. Did we target the right host?
2. Can we reach it? (DNS, SSH, become)
3. Did facts / vars resolve as expected?
4. Did the module run and report the truth?
5. Did handlers / later tasks depend on a silent skip?
```

Verbosity:

- `-v` — task results
- `-vv` — more module detail
- `-vvv` — connection / SSH
- `-vvvv` — usually noise; use when SSH itself is the suspect

## Key Commands

```bash
# Prove targeting
ansible-playbook -i inventory/ site.yml --list-hosts --limit web01
ansible-inventory -i inventory/ --host web01

# Prove connectivity and become separately
ansible web01 -i inventory/ -m ping -vvv
ansible web01 -i inventory/ -m command -a id -b -vv

# Narrow playbook replay
ansible-playbook -i inventory/ site.yml --limit web01 --start-at-task "Install nginx" -vv
ansible-playbook -i inventory/ site.yml --limit web01 --step
ansible-playbook -i inventory/ site.yml --limit web01 --check --diff

# See the exact module args Ansible sent
ANSIBLE_DEBUG=1 ansible-playbook ...   # last resort; huge output

# Syntax and config that is actually in effect
ansible-playbook --syntax-check site.yml
ansible-config dump --only-changed

# Temporary gather + dump vars for one host
ansible web01 -i inventory/ -m setup
ansible-playbook -i inventory/ dump-vars.yml --limit web01   # debug: var=hostvars[inventory_hostname]
```

Useful task-level debug inside a playbook:

```yaml
- debug:
    var: ansible_facts['distribution']
- debug:
    msg: "pkg={{ pkg_name }} dest={{ dest_path }}"
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `UNREACHABLE!` / connection timed out | SSH, DNS, wrong `ansible_host`, bastion, firewall | `ping` module with `-vvv`, try raw `ssh` as the same user |
| Host key / known_hosts errors | First connect, rebuilt VM, `host_key_checking` | Confirm identity; do not blindly disable checking in prod |
| `Missing sudo password` / become denied | sudoers, requiretty, wrong become user | `ansible -m command -a id -b` |
| `MODULE FAILURE` / traceback | Python on target, SELinux, missing dep | Check remote Python, `journalctl`, `/var/log/secure` |
| Task skipped unexpectedly | `when:` used a fact that was undefined / wrong type | `debug` the condition inputs |
| Always `changed=true` | `shell`/`command`, template whitespace, non-idempotent module | Switch module; add `--diff` |
| Handler never fired | `notify` name mismatch, `changed` was false, `flush_handlers` never reached | Compare notify vs handler names |
| Play succeeded, host still wrong | `--check` only, wrong inventory, vars shadowed | Re-run without `--check`; dump host vars |
| Galaxy / collection import fail | Network, version pin, path | `ansible-galaxy collection list` |

## Investigation Tips

- Reproduce with `--limit one-host` before touching the rest of the group.
- Split SSH from become: first `ping` / `command id` without `-b`, then with `-b`.
- If only prod fails, compare `group_vars` and extra-vars — not the playbook text.
- `command` and `shell` skip change detection. Wrap with `creates=` / `removes=` or, better, use a real module.
- Forks and serial: a play with `serial: 1` failing on host 3 may have already changed hosts 1–2. Know your rollback.
- Connection plugins matter: `local`, `podman`, `community.docker`, `winrm` each fail differently. Confirm `ansible_connection`.
- After a failed rollout, inventory the drift (`--check --diff` on remaining hosts) instead of immediately re-running the whole site play.

## Related Notes

- [[Ansible Architecture]]
- [[SSH Hardening and Troubleshooting]]
- [[SELinux Deep Dive]]
- [[sudo]]
- [[Change Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
