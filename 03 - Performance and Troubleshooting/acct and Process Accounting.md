# acct and Process Accounting

## Concept

Process accounting (`psacct` / `acct`) records every process that exits: who ran it, when, how long, CPU time, and the command. The kernel writes records to `/var/account/pacct`. `sa`, `lastcomm`, and `accton` read them.

It is not a live monitor. It is a forensic trail that survives after the process is gone.

## Why it matters

- “Who started that binary at 02:14?” when the shell history is empty and journal is rotated.
- After a compromise or a bad deploy, you need the exact command line and UID, not a guess from `ps` that already exited.
- Capacity work: which users or cron jobs are burning CPU that `top` never caught because they are short-lived.
- Compliance: some environments require command accounting.

## Mental Model

```
process exits → kernel appends fixed-size record to /var/account/pacct
                     ↓
              sa / lastcomm / dump-acct read the file
```

Records are written on exit, not on start. A long-running process appears only after it dies. `lastcomm` shows recent commands; `sa` summarises.

The file grows without bound until you rotate it. Most distros ship a logrotate snippet or a cron that does `accton off; mv; accton on`.

## Key Commands

```bash
# Is accounting on?
systemctl status psacct acct 2>/dev/null || true
accton                     # no args = show status; some distros use this
ls -l /var/account/pacct /var/log/account/pacct 2>/dev/null

# Enable (RHEL/CentOS style)
systemctl enable --now psacct
# Debian/Ubuntu
apt install acct && systemctl enable --now acct

# Recent commands
lastcomm -f /var/account/pacct | head
lastcomm root
lastcomm -u someuser bash

# Summary by command
sa -m                      # per user
sa -c                      # per command
sa -u                      # list individual records (verbose)

# Turn off briefly to rotate
accton off
mv /var/account/pacct /var/account/pacct.1
accton on
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `lastcomm` empty | accounting never enabled, or file not created | `accton`, `ls /var/account` |
| Disk filling with pacct | no rotation | size of pacct, logrotate or cron |
| Missing short commands | records only on exit; still running | wait or check live with ps |
| Permission denied | pacct mode 600, wrong group | `ls -l`, group `adm` or `root` |
| After reboot nothing | unit not enabled | `systemctl is-enabled psacct` |
| Binary name only, no args | accounting does not capture argv on all kernels/configs | expect command name; full argv needs auditd or eBPF |

## Investigation Tips

- Enable it before you need it. Turning it on after an incident only captures the future.
- Pair with `auditd` for execve argv. Accounting is lighter and survives simpler.
- Rotate aggressively on busy hosts. A full pacct makes `sa` slow and fills the filesystem that holds logs.
- `lastcomm` is chronological; `sa` is aggregated. Start with `lastcomm` for “what just ran”.
- On containers the host accounting sees the host PID namespace view; container exits still appear if the process is on the host kernel.
- Do not rely on it for real-time alerting. It is batch.

## Related Notes

- [[auditd Deep Dive]]
- [[journalctl Deep Dive]]
- [[Troubleshooting Methodology]]
- [[Users Groups and Permissions]]
- [[cron and anacron]]

## Personal Lessons Learned

- A “mystery CPU spike at night” was a developer’s forgotten `find / -name` from an old cron. `lastcomm` showed the exact minute and UID; journal only had the cron start.
- We left accounting off on production “to save disk”. After a suspected insider event the only evidence was missing. Now it is on, with a 100 MB rotation.
