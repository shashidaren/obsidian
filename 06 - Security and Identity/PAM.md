# PAM

## Concept

PAM (Pluggable Authentication Modules) is the modular framework Linux uses for authentication, account management, password changes, and session setup. Almost every login path (sshd, sudo, login, su, graphical greeters, etc.) goes through PAM.

## Why it matters

- “I can’t log in” tickets frequently land in PAM configuration, password policy, or account modules
- Centralised auth (SSSD, LDAP, FreeIPA, Active Directory) is wired in through PAM
- A single misconfigured line in a PAM stack can lock out all interactive access

Understanding the stack order and control flags is essential for safe changes.

## Mental Model

```
PAM stack (example: /etc/pam.d/sshd)

auth      → “who are you?” (password, key, 2FA…)
account   → “are you allowed?” (expired, locked, time restrictions…)
password  → password changes / quality checks
session   → setup/teardown (limits, logging, home directory…)

Control flags:
required    → must succeed; continue regardless
requisite   → must succeed; fail immediately on failure
sufficient  → success is enough (if no prior required failed)
optional    → only matters if it is the only module
```

Modules are tried in order. The combination of results and flags decides the final outcome.

## Key Commands

```bash
# List PAM configuration for a service
cat /etc/pam.d/sshd
cat /etc/pam.d/sudo
cat /etc/pam.d/system-auth          # common on RHEL-like
cat /etc/pam.d/common-auth         # common on Debian-like

# Test authentication (careful on production)
pamtester sshd username authenticate

# Check account status
passwd -S username
chage -l username

# SSSD / identity related
systemctl status sssd
sssctl user-checks username -a auth
journalctl -u sssd -f

# Useful log locations
journalctl -u sshd
tail -f /var/log/secure            # RHEL-like
tail -f /var/log/auth.log          # Debian-like
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical PAM-related cause                  | First checks                              |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| Password rejected for all users      | pam_unix / password quality / SSSD         | `/etc/pam.d/*`, auth logs                 |
| Root can log in, normal users cannot | account module (nologin, expired, faillock)| `chage -l`, `faillock`, pam_access        |
| SSH key works, password does not     | Password auth disabled or module order     | sshd_config + PAM auth stack              |
| “Account locked” after bad attempts  | pam_faillock / pam_tally2                  | `faillock --user user`                    |
| Home directory not created           | pam_mkhomedir missing or failing           | session stack                             |
| sudo asks for password unexpectedly  | pam_unix vs pam_sss order, or timestamp    | `/etc/pam.d/sudo`                         |

## Investigation Tips

- Never edit PAM stacks without a root session (or console) already open; a bad change can lock you out.
- On modern systems many stacks include shared files (`system-auth`, `common-auth`, `password-auth`). Change the right file.
- Auth logs (`/var/log/secure` or `auth.log`) usually show which module failed.
- For centralised auth, verify SSSD/LDAP connectivity first (`sssctl`, `getent passwd user`).
- `pam_faillock` (RHEL 8+) replaces older tally modules; unlock with `faillock --user username --reset`.
- Test changes with a second account before logging out of your working session.

## Related Notes

- [[sudo]]
- [[SSH Hardening and Troubleshooting]]
- [[Users Groups and Permissions]]
- [[Secrets Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
