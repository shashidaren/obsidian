# journalctl Field Filters and Vacuum

## Concept

`journalctl` can match on structured fields (`_SYSTEMD_UNIT`, `PRIORITY`, `_PID`, `SYSLOG_IDENTIFIER`, custom fields) instead of grepping text. It can also enforce disk limits with vacuum so a chatty unit does not fill the journal partition.

Field matches are exact and indexed. Text search (`-g`) is a fallback when you do not know the field.

## Why it matters

- During an incident you need the last 50 lines of one unit, or every message from a PID, without scrolling through the whole boot.
- `journalctl -u foo` is a field match on `_SYSTEMD_UNIT`. Combining it with `PRIORITY` or a time window is how you keep the signal.
- Vacuum is the difference between “the journal ate `/var`” and “we kept the last 7 days”.
- Persistent journal plus field filters is the fastest way to answer “did this start after the package update?”

## Mental Model

```
journal fields (indexed)
    _SYSTEMD_UNIT=sshd.service
    PRIORITY=3
    _PID=1234
    SYSLOG_IDENTIFIER=kernel
        → journalctl UNIT PRIORITY ... --since ...

vacuum
    journalctl --vacuum-size=2G
    journalctl --vacuum-time=7d
    (also SystemMaxUse= in journald.conf)
```

`--since` / `--until` accept relative times (`-1h`, `yesterday`) and absolute timestamps. Combine them with a unit match.

## Key Commands

```bash
# Unit + priority + time
journalctl -u nginx.service -p err --since "1 hour ago" --no-pager

# By PID or identifier
journalctl _PID=1234 --since "10 min ago"
journalctl SYSLOG_IDENTIFIER=kernel -p warning --since boot

# Boot and cursor
journalctl -b -1 -u foo.service          # previous boot
journalctl --list-boots

# Disk usage and vacuum
journalctl --disk-usage
journalctl --vacuum-size=1G
journalctl --vacuum-time=14d

# Persistent config
grep -E 'SystemMaxUse|SystemKeepFree|MaxRetentionSec' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/* 2>/dev/null
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `journalctl -u foo` empty | Unit name wrong, or journal not persistent | `systemctl status`, `journalctl --disk-usage` |
| Journal fills `/var` | No `SystemMaxUse`, chatty unit | `--disk-usage`, `journald.conf` |
| Missing logs after reboot | Volatile storage only | `/var/log/journal` exists? |
| Field match returns nothing | Field name case or value mismatch | `journalctl -o verbose -n 5` to see fields |
| Vacuum “does nothing” | Rate limit or sealed files | `journalctl --verify`, restart journald |
| Duplicate lines from rate limiting | journald suppressed repeats | See [[journald Rate Limiting]] |

## Investigation Tips

- Start with `-u` and a tight `--since`. Widen only if the answer is not there.
- `journalctl -o json` or `-o verbose` once when you need to discover which field actually carries the information.
- Set `SystemMaxUse=` and `MaxRetentionSec=` so vacuum is policy, not an emergency command.
- After a package update, `journalctl -u <service> --since "30 min ago"` plus `dnf history` answers “did the new package break it?” in one pass.
- Kernel messages are `SYSLOG_IDENTIFIER=kernel` or `journalctl -k`. Do not expect them under a userspace unit.
- If the journal is corrupt, `journalctl --verify` and a restart of `systemd-journald` are the first steps; vacuum will not repair bad files.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[journald Rate Limiting]]
- [[Logging Architecture]]
- [[dnf History and Rollback]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I used to `grep` the entire journal for a hostname. A `_SYSTEMD_UNIT` plus `--since` returned the same answer in a second and did not page the disk as hard.
- A host ran out of space on `/var` because journald had no `SystemMaxUse`. `journalctl --vacuum-size=500M` bought time; the config change kept it from happening again.
