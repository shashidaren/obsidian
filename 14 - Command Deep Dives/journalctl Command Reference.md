# journalctl Command Reference

## Concept

`journalctl` queries the systemd journal — the structured log store used by systemd-managed systems. It replaces much of the traditional “grep /var/log” workflow with filters by unit, time, priority, and boot.

## Why it matters

- Almost every service under systemd writes here (and many still write to files as well)
- Time-bounded and unit-bounded queries are far faster and more precise than grepping flat files
- Boot-scoped views (`-b`) make “what failed on last boot?” trivial
- Essential companion to `systemctl status` when a unit is failed or flapping

This note is a practical command reference; see [[journalctl Deep Dive]] for storage, vacuuming, and architecture.

## Mental Model

```
journal = structured binary log

Filter dimensions:
  - time window (--since / --until / -b)
  - unit (-u)
  - priority (-p)
  - field (e.g. _PID=, SYSLOG_IDENTIFIER=)
  - boot (-b, -b -1 for previous)

Output can be followed (-f), limited (-n), or exported.
```

Default is the current boot, all priorities, oldest first. Always narrow the window for incidents.

## Key Commands

```bash
# Current boot, errors and above
journalctl -b -p err

# Specific unit
journalctl -u nginx.service
journalctl -u nginx.service -b
journalctl -u nginx.service --since "1 hour ago"

# Follow (like tail -f)
journalctl -u myapp -f

# Previous boot
journalctl -b -1
journalctl -b -1 -p warning

# Time range
journalctl --since "2026-08-27 08:00" --until "2026-08-27 09:00"
journalctl --since "10 min ago"

# Kernel messages
journalctl -k
journalctl -k -b

# By PID or executable
journalctl _PID=1234
journalctl /usr/sbin/sshd

# Reverse (newest first), limited lines
journalctl -r -n 50
journalctl -u sshd -n 100 --no-pager

# JSON / export for tooling
journalctl -u myapp -o json-pretty
journalctl -o short-iso

# Disk usage and vacuum (careful)
journalctl --disk-usage
journalctl --vacuum-size=500M
journalctl --vacuum-time=7d
```

## Common Failure Modes & Symptoms

| Need                                 | Useful journalctl invocation                 |
|--------------------------------------|----------------------------------------------|
| Why did this unit fail?              | `journalctl -u <unit> -b -p err`             |
| What happened just before the crash? | `--since` around the incident + `-u`         |
| Kernel / OOM / disk errors           | `journalctl -k -b` / `-p err`                |
| Service was fine last boot, broken now | Compare `-b` vs `-b -1`                    |
| Too much noise                       | Raise priority (`-p warning`), tighter time  |
| Journal missing old data             | Persistence / size limits — see deep dive   |

## Investigation Tips

- Always pin a time window for incidents; full-boot logs on a busy host are huge.
- `systemctl status <unit>` already shows the last few journal lines — use `journalctl` when you need more history or filters.
- Persistent journal requires `/var/log/journal` and correct config; otherwise logs vanish on reboot.
- Priority levels: `emerg`, `alert`, `crit`, `err`, `warning`, `notice`, `info`, `debug`. `-p err` means “err and worse”.
- Combine with `systemctl --failed` as the first pass on any unhealthy host.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[systemctl Deep Dive]]
- [[systemctl Command Reference]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
