# sudo

## Concept

`sudo` is policy, not a magic root prefix. Rules in `/etc/sudoers` and `/etc/sudoers.d/*` decide who may run which command as which user, whether a password is required, and whether environment is preserved.

A bad file locks out every admin. `visudo` exists because `sudoers` syntax is picky and the failure mode is “nobody can fix it without console”.

## Why it matters

- `ALL=(ALL) NOPASSWD: ALL` on a human account is a stolen-laptop root shell
- Command lists that use relative names or wildcards unexpectedly become “run anything”
- Syntax errors and `#includedir` ordering cause “but I added the rule” tickets
- Incident response needs the denial logs; default logging is easy to miss if you only watch `journalctl -u sudo`

## Mental Model

```
sudo [ -u target ] command
  → parse /etc/sudoers then /etc/sudoers.d/* (lexical order)
  → match user / group / host / runas / command
  → last matching rule wins (usually)
  → ticket / timestamp / PAM (if a password is required)
  → exec with a sanitized env unless SETENV / !env_reset
```

Defaults (`env_reset`, `secure_path`, `timestamp_timeout`) matter as much as the allow lines. A rule that allows `/usr/bin/systemctl` still fails if the user types `systemctl` and `secure_path` does not include that directory — or succeeds as a *different* binary if PATH is preserved.

## Key Commands

```bash
# What *this* account can do
sudo -l

# What another account can do (needs privilege)
sudo -l -U alice

# Syntax check everything visudo manages
sudo visudo -c

# Edit the main file or a drop-in (always visudo)
sudo visudo
sudo visudo -f /etc/sudoers.d/alice

# Reproduce a denial with extra verbosity (sudo 1.9+)
sudo -V | head
# denials: journalctl -xe, /var/log/secure, /var/log/auth.log
grep -i sudo /var/log/secure /var/log/auth.log

# Run as another user / login shell
sudo -u postgres -H -s
sudo -i                    # root login shell
```

### Rule shapes that stay reviewable

```
# Cmnd_Alias keeps diffs readable
Cmnd_Alias NGINX_RESTART = /usr/bin/systemctl restart nginx, \
                           /usr/bin/systemctl status nginx, \
                           /usr/bin/systemctl reload nginx

%appops ALL=(root) NGINX_RESTART

# Specific user, specific runas, password required
alice ALL=(root) /usr/sbin/visudo

# Break-glass automation — narrow, no shell, no wildcard editors
deploy ALL=(root) NOPASSWD: /usr/local/bin/deploy.sh

# Host_Alias when the same file is copied everywhere
Host_Alias PROD = app01, app02, app03
%oncall PROD=(root) /usr/bin/systemctl start *, /usr/bin/systemctl stop *
```

Drop-ins: filename without dots if your sudo is old (`alice` not `alice.rules` on ancient sudo). Prefer `10-alice` so order is obvious.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `not in the sudoers file` | No matching user/group rule, or wrong hostname | `sudo -l -U user`; `hostname`; `#includedir` contents |
| `command not allowed` / `command not found` | Rule lists a different path; `secure_path` | Full path in rule; `type -a command`; `sudo -l` |
| Rule file ignored | Syntax error earlier in the same file, or filename with extra `.` | `visudo -c`; `ls -l /etc/sudoers.d` |
| Changes have no effect | Edited the wrong host, or cached ticket + different rule you forgot | `visudo -c`; `sudo -k`; re-run `sudo -l` |
| Locked out after save | Syntax error, or you removed yourself | Root console, `pkexec`, break-glass key, live ISO |
| Works interactively, fails in cron/CI | No TTY, requiretty leftover, no ticket | `Defaults !requiretty` for that user; PAM |
| User can run more than intended | Wildcard `*` or `ALL` next to editors / shells / `sudo` | Read the *actual* `sudo -l` output, not the intended policy |
| `sudo: no tty present` | requiretty + automation | Drop requiretty for that Cmnd_Alias only |

## Investigation Tips

- **Never** open `/etc/sudoers` in vim without `visudo`. Recovering from a parse error on a remote box is a console problem.
- `sudo -l` is the contract. If it does not list the command, the file you edited is not the file sudo is reading.
- Wildcards: `/usr/bin/systemctl restart *` is not “any unit”. Depending on version and flags it can be broader than you think. Prefer an explicit unit list.
- Allowing `vi`, `less`, `more`, `find`, `tar`, or `chmod` is often a root shell. If the user can write a file and execute it, you already lost.
- `NOPASSWD` should be rare and command-specific. “Ops is annoyed at the password” is not a threat model.
- Log denials centrally. A silent deny is how people “fix” access by adding `ALL`.
- Keep a root or break-glass console session while you change sudoers on the last bastion.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[Users Groups and Permissions]]
- [[PAM]]
- [[Secrets Management]]
- [[Change Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A drop-in named `alice.sudoers` was silently ignored on an older sudo. `visudo -c` said the *main* file was fine. Name files without extra dots unless you have checked the version.
- We allowed `/bin/systemctl` and the unit still said “not allowed” because the binary was `/usr/bin/systemctl`. Always `readlink -f $(command -v systemctl)` before writing the rule.
- `NOPASSWD: ALL` for a CI user leaked into an interactive group via a shared `%deploy`. `sudo -l -U` on a sample human account would have shown it.
- The only safe recovery from a broken sudoers on a cloud VM is serial console. Test that console *before* you need it.
