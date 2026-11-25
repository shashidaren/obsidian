# sudoers Deep Dive

## Concept

`sudoers` (and files in `/etc/sudoers.d/`) is the policy that decides who can run what as whom, with or without a password, and with which environment. It is parsed by `sudo` before any command runs. Syntax errors make `sudo` refuse everything until fixed.

`visudo` is the only safe editor. It locks and syntax-checks.

## Why it matters

- A wrong `NOPASSWD` line turns a low-priv account into root without a prompt. That is how many lateral movements start.
- `Defaults env_reset` (or the lack of it) decides whether a user’s `PATH` or `LD_PRELOAD` reaches the privileged command.
- Incident response often starts with “who can sudo what”. If you cannot answer quickly, you do not know your privilege boundary.
- `sudo -l` is the source of truth for a user, not the file you think is active.

## Mental Model

```
user → sudo → reads /etc/sudoers + /etc/sudoers.d/* (lexical order)
           → matches user/group, host, command
           → applies Defaults (env, lecture, timestamp)
           → execs the command as target user (usually root)
```

Last match wins for some settings; command aliases and Cmnd_Alias make large files readable. Include files in `sudoers.d` are sorted by name — `10-foo` before `20-bar`.

`timestamp_timeout` controls how long a successful password is cached. 0 means always ask; negative means never expire (dangerous).

## Key Commands

```bash
# What can I actually run?
sudo -l
sudo -ll                 # more detail, including tags

# Syntax check without applying
visudo -c
visudo -c -f /etc/sudoers.d/99-local

# Safe edit
visudo
visudo -f /etc/sudoers.d/50-admins

# Who has root?
grep -r NOPASSWD /etc/sudoers /etc/sudoers.d
grep -r 'ALL=(ALL)' /etc/sudoers.d

# Audit recent sudo
journalctl -t sudo --since today
grep sudo /var/log/auth.log | tail
```

Minimal safe drop-in:

```
# /etc/sudoers.d/50-ops
%ops ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart myapp, /usr/bin/journalctl -u myapp
Defaults:%ops !lecture, timestamp_timeout=5
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `sudo: parse error` / all sudo broken | syntax error, usually in a drop-in | `visudo -c`, boot to single or use root shell |
| User can sudo more than intended | broad `ALL`, or file sorted after a tighter one | `sudo -l` as that user, `ls /etc/sudoers.d` |
| `NOPASSWD` ignored | command path does not match exactly, or args | full path, no shell metacharacters |
| Environment variables missing | `env_reset` + no `env_keep` | `Defaults env_keep += "http_proxy"` |
| Password asked every time | `timestamp_timeout=0` or tty mismatch | `Defaults timestamp_timeout` |
| Works in one host, not another | different sudoers.d, or `#includedir` missing | `grep includedir /etc/sudoers` |

## Investigation Tips

- Always `sudo -l` as the target user. The file is not the runtime policy if includes fail.
- Put the most specific rules in higher-numbered files if you rely on order.
- Never grant `NOPASSWD: ALL`. Grant exact binaries and, where possible, exact arguments.
- `visudo -c` in CI or a config-management check prevents the “sudo is broken fleet-wide” outage.
- Log `sudo` via syslog or journal. `Defaults logfile=/var/log/sudo.log` still works; journal is usually enough.
- After changing sudoers, test with a non-root account before you log out of the root session.

## Related Notes

- [[sudo]]
- [[Users Groups and Permissions]]
- [[PAM]]
- [[Auditd Deep Dive]]
- [[Troubleshooting Methodology]]
- [[SSH Hardening and Troubleshooting]]

## Personal Lessons Learned

- A drop-in named `zz-emergency` with `ALL ALL=(ALL) NOPASSWD: ALL` was left after an incident. `sudo -l` from a contractor account showed it immediately. We now have a weekly `grep NOPASSWD` alert.
- `visudo` was not used; a missing comma made sudo refuse every command. Recovery was a console root shell and `visudo -c` to find the line.
