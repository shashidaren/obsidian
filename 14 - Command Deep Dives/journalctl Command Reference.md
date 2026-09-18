# journalctl Command Reference

## Concept

`journalctl` is the query tool for the systemd journal: a structured, indexed log store. Filter by unit, time, boot, priority, PID, or executable instead of grepping a pile of text files.

This page is the command card. Storage, persistence, vacuuming, and “why did last boot vanish?” live in [[journalctl Deep Dive]] and [[journald and Persistent Storage]].

## Why it matters

- `systemctl status` only shows a teaser. The rest is here
- Time and unit filters beat `grep -R` on `/var/log` for anything systemd-managed
- `-b -1` is the fastest “what died on the previous boot?” you will ever get
- Priority and `_PID=` cut noise when an incident has three overlapping services

Default output is current boot, oldest first, all priorities. That is the wrong window for almost every incident.

## Mental Model

```
journal records
  _SYSTEMD_UNIT=  /  SYSLOG_IDENTIFIER=
  PRIORITY=       0 emerg … 7 debug
  __REALTIME_TIMESTAMP=
  _BOOT_ID=
  _PID=  _COMM=  _EXE=

You almost always constrain THREE things:
  who   (-u, _PID=, path-to-binary)
  when  (--since / --until / -b)
  how bad (-p)
```

`-p err` means err *and worse*, not “only err”.

## Key Commands

```bash
# Failed units this boot, then their logs
systemctl --failed
journalctl -b -p err --no-pager

# One unit, recent, follow
journalctl -u nginx.service --since "1 hour ago"
journalctl -u nginx.service -f

# Previous boot vs this boot
journalctl --list-boots
journalctl -b -1 -p warning
journalctl -b -u sshd

# Time box an incident
journalctl --since "2026-09-18 07:40" --until "2026-09-18 08:10" -p info
journalctl --since "10 min ago" -u myapp

# Kernel / OOM
journalctl -k -b
journalctl -b -p err | grep -iE 'oom|killed process|ext4|xfs|nvme|i/o error'

# By process or binary
journalctl _PID=1234
journalctl /usr/sbin/sshd --since today

# Newest first, limited, script-friendly
journalctl -u myapp -r -n 80 --no-pager
journalctl -o short-iso -u myapp --since "-30min" --no-pager
journalctl -o json-pretty -n 5 -u myapp

# Disk usage and trim (do this on purpose, not as muscle memory)
journalctl --disk-usage
journalctl --vacuum-size=500M
journalctl --vacuum-time=14d
```

Useful extra switches: `-x` (explanation text on some messages), `-o verbose` (see every field once so you know what you can filter on), `--utc`.

## Common Failure Modes & Symptoms

| Need | Invocation |
|------|------------|
| Why is this unit failed? | `journalctl -u UNIT -b -p err -x --no-pager` |
| What happened just before the crash? | `--since` 10 min before the timestamp + `-u` |
| Kernel / storage / OOM | `journalctl -k -b` and `-p err` |
| “It worked last boot” | `--list-boots` then `-b -1` vs `-b` |
| Flooded output | `-p warning`, tighter `--since`, drop `-f` until filtered |
| Empty history after reboot | Journal not persistent — see persistence note |
| Permission denied | Not in `systemd-journal` / `adm`; use root or fix groups |
| Clock jump scrambled order | `--utc` and compare `timedatectl` |

## Investigation Tips

- Pin a time window first. A busy node’s current-boot journal is not a page you read linearly.
- Start with `systemctl status UNIT -l --no-pager` then jump to `journalctl -u UNIT --since …`.
- Compare `-b` and `-b -1` before you assume a config change “today” is the cause. Some units fail only on cold boot (network ordering, decrypt, DNS).
- `-o verbose` once per incident type teaches you fields like `SYSLOG_IDENTIFIER` and `CODE_FUNC` that `-u` misses when a process logs under another name.
- `journalctl -u UNIT -u UNIT2` merges streams on one timeline. Use that for proxy + app + database instead of three terminals.
- Vacuuming is capacity management, not troubleshooting. Snapshot `--disk-usage` before you shrink anything during an incident.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[systemctl Deep Dive]]
- [[systemctl Command Reference]]
- [[Logging Architecture]]
- [[logrotate]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I used to `journalctl -u foo` with no time bound and page for ten minutes. `--since "20 min ago" -p info` is the default I type now.
- The “missing logs after reboot” incident was volatile journal on a cloud image. Persistence is a design choice, not a default you can assume.
- Merging `-u nginx -u myapp` showed the 502 was the app crashing 200 ms before nginx logged it. Separate greps hid the order.
