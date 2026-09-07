# PAM

## Concept

PAM (Pluggable Authentication Modules) is the shared stack almost every Unix login path calls: `sshd`, `sudo`, `su`, `login`, `cron`, display managers, even some APIs. Each service has a file under `/etc/pam.d/` that lists modules for four purposes: `auth`, `account`, `password`, `session`.

If you cannot log in, cannot `sudo`, or get “account locked” after three typos, you are in PAM long before you are in “the password is wrong”.

## Why it matters

- One bad line in a common-auth / system-auth include can lock *every* interactive path, including the one you are using to fix it
- Central auth (SSSD, Winbind, FreeIPA, LDAP) is not “instead of PAM”; it is modules *inside* PAM
- Password quality, faillock, `nologin`, home creation, resource limits (`pam_limits`), and session logging all live here
- `sshd` may accept a key at the SSH layer and still fail the PAM `account`/`session` stack. That split causes a lot of false “SSH is broken” tickets

## Mental Model

```
/etc/pam.d/sshd
  @include common-auth          # Debian family
  auth  substack system-auth    # RHEL family

four groups, evaluated separately:
  auth      prove identity (unix, sss, google_authenticator, ...)
  account   is the principal allowed *now* (expiry, nologin, access.conf, faillock)
  password  changing secrets / quality (pwquality, pwhistory)
  session   side effects (limits, mkhomedir, ssh-agent, systemd --user, umask, lastlog)

flags (simplified):
  required    fail later; keep going so later modules still run
  requisite   fail now
  sufficient  success here can end the group (if no earlier required failed)
  optional    only decisive if nothing else decided
  include / substack   pull another file in
```

Order is the whole design. `pam_unix.so sufficient` *above* `pam_sss.so` means a local password wins and SSSD may never run. Flip them and local break-glass accounts may stop working the way you think.

Debian stores shared stacks in `/etc/pam.d/common-*`. RHEL uses `/etc/pam.d/system-auth` and `password-auth`, often written by `authselect`. Edit the generator’s templates or you lose changes on the next `authselect apply`.

## Key Commands

```bash
# Read the stack you will actually hit
cat /etc/pam.d/sshd
cat /etc/pam.d/sudo
cat /etc/pam.d/su
# Follow includes:
ls /etc/pam.d/common-* /etc/pam.d/system-auth /etc/pam.d/password-auth 2>/dev/null

# RHEL authselect (do not hand-edit generated files if this is in use)
authselect current
authselect check

# Account state (local)
passwd -S username
chage -l username
getent passwd username
getent shadow username          # root only; confirms the source

# Lockouts (RHEL 8+ / modern Debian with pam_faillock)
faillock --user username
faillock --user username --reset
# older tally2:
failloop2 --user username       # if present; otherwise pam_tally2

# Access lists
cat /etc/security/access.conf
cat /etc/security/limits.conf
ls /etc/security/limits.d/

# Central auth health
systemctl status sssd
sssctl user-checks username -a auth
getent passwd username          # should work if nss is healthy
journalctl -u sssd -u sshd --since '15 min ago'

# Where the “no” was logged
journalctl -u sshd --since '15 min ago'
tail -f /var/log/secure         # RHEL family
tail -f /var/log/auth.log       # Debian family

# Safe-ish module test if pamtester is installed (still be careful)
pamtester sshd username authenticate
```

Keep a root console or an already-authenticated root session *before* you edit any PAM file. That is not folklore; it is the only rollback that still works when SSH starts returning “Authentication failed”.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| All passwords rejected | `pam_unix`/`pam_sss` order, `pam_pwquality`, wrong `use_first_pass` | auth log line naming the module |
| Root works, users do not | `pam_nologin`, `pam_access`, expiry, shell, faillock | `chage -l`, `/etc/nologin`, `access.conf` |
| Key auth succeeds then session closes | `account` or `session` failed after SSH itself was happy | sshd log “pam_systemd” / “access denied” |
| “Account locked” after N failures | `pam_faillock` (or leftover tally2) | `faillock --user`; reset |
| New AD/LDAP user has no home | `pam_mkhomedir` missing from session | session stack; `/etc/skel` |
| `sudo` asks for a password it never used to | timestamp + `pam_unix` vs `pam_sss`; or `timestamp_timeout` | `/etc/pam.d/sudo`, `sudo -V` |
| Limits in `limits.conf` ignored | Service does not go through a session stack (some systemd units) | unit `LimitNOFILE=` instead |
| Change vanished after `authselect apply` / package update | You edited a generated file | `authselect current`; local-overrides |
| You locked yourself out | requisite fail on common-auth | console / break-glass / cloud serial; revert the file |

## Investigation Tips

- Read the log *before* you rearrange modules. PAM almost always names the module that returned failure (`pam_faillock(sshd:auth): ...`).
- Test with a *second* unprivileged account. Never be the only session on the box while you change `common-auth`.
- Distinguish SSH *configuration* (`PasswordAuthentication`, `UsePAM`, `KbdInteractiveAuthentication`) from PAM. Both can refuse a password; only one is the stack.
- For SSSD, `getent passwd user` failing is NSS, not PAM. Fix discovery first or you will tune the wrong layer.
- `pam_succeed_if` and `pam_access` silently skip or deny based on tty, UID ranges, and origin. They hide in includes.
- `pam_limits` applies at session open. A long-lived process will not pick up a new nofile limit until it is restarted.
- When adding MFA (`pam_google_authenticator`, `pam_oath`), put it where a break-glass local user can still get in from console. An MFA-only requisite on `system-auth` is how you lose the fleet during an IdP outage.

## Related Notes

- [[sudo]]
- [[SSH Hardening and Troubleshooting]]
- [[Users Groups and Permissions]]
- [[Secrets Management]]
- [[Identity in Cloud]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once dropped `pam_unix` below a `requisite` SSSD line during an IdP blip. Console login with the local root password still worked; SSH with the same local account did not, because sshd’s stack was the one I edited. Keep a serial/console path, and keep a local account that does not depend on the IdP module being sufficient.
- “SSH keys work, passwords do not” was `PasswordAuthentication no` *and* a `pam_faildelay` red herring. Check `sshd -T` before you rewrite PAM.
- `faillock` surviving across a password reset confused a whole helpdesk queue. Unlock is `faillock --user X --reset`, not `passwd`. The account module does not care that you changed the hash.
- `authselect apply-changes` after a CIS playbook wiped a hand-edited `system-auth`. If the host uses authselect, your change belongs in the authselect profile or it is temporary by design.
