# journalctl Deep Dive

## Concept

`journalctl` is the primary interface to the systemd journal. The journal is a structured, indexed log store that receives messages from the kernel, systemd, and any service that writes to stdout/stderr or uses the journal API. It replaces the old practice of tailing a dozen files under `/var/log` for most operational questions.

## Why it matters

- Almost every incident starts with “what changed in the last N minutes”. The journal answers that without knowing which file the service wrote to.
- Structured fields (`_PID`, `UNIT`, `PRIORITY`, `MESSAGE_ID`) let you filter precisely instead of grepping free text.
- Persistent vs volatile journal determines whether you still have logs after a reboot. Many cloud images ship with a volatile journal.
- Rate limiting and vacuum policy can silently drop the evidence you need.

## Mental Model

```
kernel / services / stdout
    → journald (in-memory or /var/log/journal)
        → journalctl queries by time, unit, priority, fields
```

The journal is append-only until vacuumed. `journalctl -b` is the current boot; `-b -1` is the previous boot. Fields that start with `_` are trusted (set by journald); others are from the message.

## Key Commands

```bash
# Current boot, follow, errors only
journalctl -b -f -p err

# Previous boot (after a crash or reboot)
journalctl -b -1 -p err..alert

# Specific unit, with context
journalctl -u nginx.service -n 200 --no-pager
journalctl -u nginx.service --since "30 min ago"

# Kernel only
journalctl -k -b
journalctl -k -b -1

# By priority or identifier
journalctl -p warning..err --since today
journalctl SYSLOG_IDENTIFIER=sshd

# Disk usage and vacuum
journalctl --disk-usage
journalctl --vacuum-size=500M
journalctl --vacuum-time=7d

# Verify integrity (when needed)
journalctl --verify
```

Useful flags: `-o short-precise`, `-o json`, `-o verbose` (shows all fields), `--no-pager`, `-n 100`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No logs after reboot | Volatile journal | `ls /var/log/journal`, `Storage=` in journald.conf |
| Logs stop at a certain time | Disk full or vacuum | `journalctl --disk-usage`, `df -h` |
| Missing service logs | Unit not using journal or rate-limited | `journalctl -u unit`, RateLimitInterval |
| Huge journal | No vacuum policy | `--disk-usage`, set SystemMaxUse |
| Cannot correlate across hosts | Clocks skewed | [[Time Sync and chrony]] |
| `journalctl` slow on large journal | Unindexed or on slow disk | `--verify`, move to faster storage |

## Investigation Tips

- Start with `journalctl -b -p err` or `-b -1` after an unexpected reboot. The last error before the crash is usually there.
- `journalctl -u foo.service -f` is the modern `tail -f` for a service. Combine with `--since "5 min ago"` when the unit has been noisy.
- Persistent journal requires `/var/log/journal` to exist (or `Storage=persistent`). Many minimal images need this created and journald restarted.
- Rate limiting (`RateLimitIntervalSec`, `RateLimitBurst`) drops messages under flood. If a service suddenly goes silent in the journal while still running, check the rate-limit counters.
- For cross-host correlation, fix the clocks first. A five-minute skew makes “A happened before B” meaningless.
- Use `-o verbose` on a single interesting message to see every field. That is how you discover the exact `_PID` or `CODE_FILE` you can filter on next time.
- Vacuum is safer than deleting files under `/var/log/journal`. Use `--vacuum-size` or `--vacuum-time`.

## Related Notes

- [[journald and Persistent Storage]]
- [[journald Rate Limiting]]
- [[journalctl Field Filters and Vacuum]]
- [[systemctl Deep Dive]]
- [[Time Sync and chrony]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first time I lost the evidence of a crash was a cloud image with a volatile journal. I now check `ls /var/log/journal` on every new golden image.
- `journalctl -b -1 -p err` after an unexpected reboot has ended more “what happened” calls than any amount of speculation about the application.
- A service that “stopped logging” was hitting the default rate limit during a retry storm. The process was alive; the journal had simply dropped the messages. `RateLimitIntervalSec=0` for that unit (temporarily) restored visibility.
