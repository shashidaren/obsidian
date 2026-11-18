# Ansible for Linux Admins

## Concept

Ansible is an agentless automation tool that pushes modules over SSH (or WinRM) and applies desired state. For Linux sysadmins it is the practical way to keep a fleet consistent without writing a new shell script for every change.

Playbooks are YAML; inventory is the list of hosts; facts are the live state Ansible gathers before it changes anything.

## Why it matters

- A one-off `sed` on 40 hosts becomes 40 different configs. A playbook is the record of what was supposed to happen.
- `--check` and `--diff` let you see the change before you make it.
- Idempotence is the contract: running the playbook twice should not keep changing the system.
- Vault and become are how you avoid putting root passwords in cleartext or in the playbook.

## Mental Model

```
inventory + playbook
    → SSH to host
    → gather facts
    → run modules in order (or with handlers)
    → report changed / ok / failed

--check     simulate
--diff      show file diffs
--limit     one host or group
--tags      run only part of the play
```

Modules you will actually use: `package`, `service`, `copy`/`template`, `lineinfile`/`blockinfile`, `user`, `firewalld`/`nftables`, `systemd`, `command`/`shell` (last resort).

## Key Commands

```bash
# Ad-hoc
ansible all -m ping
ansible web -m package -a "name=nginx state=present" --become

# Playbook
ansible-playbook site.yml --check --diff
ansible-playbook site.yml --limit db01
ansible-playbook site.yml --tags ntp

# Facts
ansible db01 -m setup | less

# Inventory
ansible-inventory --list
ansible-inventory --graph
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `UNREACHABLE` | SSH key, firewall, or Python missing | `ssh -v`, `ansible -m ping` |
| `FAILED` on package | Repo or mirror problem | `apt`/`dnf` by hand on the host |
| Change every run | Module not idempotent, or `shell` without creates/removes | playbook logic, `changed_when` |
| Become password prompt in CI | `become` without vault or passwordless sudo | ansible.cfg, sudoers |
| Works on one host, fails on others | Facts differ (OS family, version) | `ansible -m setup`, `when` conditions |

## Investigation Tips

- Always `--check --diff` first on a production change. The diff is the review.
- Prefer modules over `shell`. If you must use `shell`, set `creates` or `changed_when` so it is idempotent.
- Use `serial` and `max_fail_percentage` on large fleets so a bad change does not hit every host at once.
- Vault the secrets; do not put them in group_vars in cleartext.
- After a playbook run, verify the service is actually healthy (`systemctl status`, a curl, or a custom fact), not just that Ansible reported `changed`.

## Related Notes

- [[systemd Units]]
- [[Patching Strategy]]
- [[IaC Drift]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A playbook that used `shell: systemctl restart nginx` without a handler restarted the service on every run. Switching to the `service` module with a notify handler fixed the noise and the unnecessary restarts.
- `--limit` saved me when a template bug would have pushed a broken config to the whole web tier. I now never run a first-time playbook without a limit.
