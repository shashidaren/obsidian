# apt History and Pinning

## Concept

`apt` (and `apt-get`) records every successful transaction in `/var/log/apt/history.log` and the term log. Pinning (`/etc/apt/preferences` and `preferences.d`) controls which version of a package is preferred when multiple repositories offer it.

Unlike `dnf history undo`, Debian-family systems do not have a first-class reverse transaction. Recovery is usually a combination of the history log, `apt-get install <pkg>=<version>`, and a snapshot or `apt-mark`.

## Why it matters

- A bad update from a third-party repo or a wrong `apt full-upgrade` can be traced to a timestamp and the exact package set.
- Pinning is how you keep a stable package while still pulling security updates for everything else.
- `apt-mark hold` is the runtime equivalent of a pin; both are easy to forget and then fight the next unattended-upgrade.
- Scriptlets and conffile prompts are not recorded as cleanly as RPM; the history log plus `/var/log/dpkg.log` are the map.

## Mental Model

```
apt install/upgrade
    → solver (respects pins and holds)
    → dpkg applies files + maintainer scripts
    → history.log records the action, the user, and the package list

pin priority:
  1001+  force even downgrade
  990    default for the target release
  500    normal
  100    installed but not from the preferred release
  <0     never install
```

Always read `apt-cache policy <pkg>` before you pin. The numbers are the only thing that matters.

## Key Commands

```bash
# What just happened
less /var/log/apt/history.log
grep -E 'Start-Date|Commandline|Install|Upgrade|Remove' /var/log/apt/history.log | tail -40

# Current policy for a package
apt-cache policy nginx
apt-cache policy | head -30

# Hold / unhold
apt-mark hold nginx
apt-mark showhold
apt-mark unhold nginx

# Install a specific version (after you have confirmed it is in a repo)
apt-get install nginx=1.18.0-6ubuntu14.4

# Preferences example (pin nginx from a specific origin)
# /etc/apt/preferences.d/nginx
Package: nginx*
Pin: origin "deb.example.com"
Pin-Priority: 990
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Package keeps upgrading despite a hold | Pin priority lower than the new version, or hold not set | `apt-cache policy`, `apt-mark showhold` |
| `apt upgrade` wants to remove a package you need | Dependency change or pin conflict | `apt-get -s upgrade`, history.log |
| History log empty or truncated | `/var` full at the time, or logrotate | `df -h /var`, `ls -l /var/log/apt` |
| Downgrade refused | Pin priority < 1001 | preferences file, `apt-get install pkg=ver` |
| Unattended-upgrades ignored a pin | File in the wrong place or syntax error | `apt-config dump`, preferences.d |

## Investigation Tips

- `history.log` is the first place to look after a bad update. Pair it with `dpkg.log` for the exact dpkg actions.
- Test a pin with `apt-get -s install` before you leave it in place. A priority of 990 is usually enough; 1001 is for forced downgrades.
- After any pin or hold change, run `apt-get update` and check `apt-cache policy` again.
- Keep a local snapshot or at least the output of `apt-mark showmanual` before a large upgrade window.
- Conffile prompts (`dpkg` questions) are not replayable. If a config was overwritten, restore from your configuration management or backup, not from apt history.

## Related Notes

- [[dnf History and Rollback]]
- [[Patching Strategy]]
- [[Repository Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A third-party repo pushed a broken `openssl` update. `history.log` gave me the exact timestamp and package list; a quick pin plus a reinstall of the previous version restored SSH in under ten minutes.
- I left a pin at priority 500 and wondered why the package kept moving. `apt-cache policy` showed the new version still winning. The number is the policy.
