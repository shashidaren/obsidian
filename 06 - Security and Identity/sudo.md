# sudo

## Concept

`sudo` lets permitted users run commands as root (or another user) according to rules defined in `/etc/sudoers` and files under `/etc/sudoers.d/`.

## Why it matters

- Overly broad sudo rules are a long-term security risk.
- Incorrect syntax can lock administrators out of privileged access.
- Understanding how to safely edit and test sudo policy is essential.

## Mental Model

```
User runs: sudo <command>
    ↓
sudo checks /etc/sudoers + /etc/sudoers.d/*
    ↓
If allowed → runs command as target user (usually root)
If denied  → logs the attempt and refuses
```

## Key Commands

```bash
# Edit sudoers safely (always use visudo)
sudo visudo
sudo visudo -f /etc/sudoers.d/custom

# Test a user’s permissions
sudo -l -U <username>

# Check syntax without installing
visudo -c

# See what the current user can do
sudo -l
```

### Common rule examples

```
# Full access
adminuser  ALL=(ALL) ALL

# Specific commands only
deploy ALL=(root) /usr/bin/systemctl restart nginx, /usr/bin/systemctl status nginx

# No password for certain commands
monitoring ALL=(root) NOPASSWD: /usr/bin/systemctl status *

# Group based
%sudo  ALL=(ALL:ALL) ALL
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| user is not in the sudoers file      | Missing rule or wrong username/group      | `sudo -l -U user`, check sudoers |
| sudo: command not found              | Restricted PATH or command not allowed    | Full path in sudoers rule        |
| Changes have no effect               | Syntax error or wrong file                | `visudo -c`                      |
| Locked out of sudo                   | Bad sudoers change                        | Root console / recovery mode     |

## Investigation Tips

- **Never** edit `/etc/sudoers` directly with a normal editor — always use `visudo` so syntax is checked.
- Prefer drop-in files under `/etc/sudoers.d/` for custom rules.
- Use full paths to commands in sudoers rules.
- Log entries for denied sudo attempts usually appear in the secure/auth journal or `/var/log/secure` / `/var/log/auth.log`.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
