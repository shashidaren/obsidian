# journald Rate Limiting

## Concept

`systemd-journald` rate-limits messages per unit (and per priority in some versions) so a single noisy service cannot fill the journal or starve other units. When the limit is hit, journald drops messages and later logs a summary line: "Suppressed N messages from …".

The knobs are `RateLimitIntervalSec=` and `RateLimitBurst=` in `journald.conf`. They are not the same as application-level logging configuration or rsyslog rate limits.

## Why it matters

- A crash loop or debug-level service can suppress the exact lines you need for the incident
- The suppression message itself is easy to miss in a flood of other logs
- Rate limiting is per-unit by default; a sidecar or a library that logs under the same unit can hide the main process
- Raising the limit without raising disk caps just moves the problem to `/var` filling
- Central forwarders see the suppressed gap as missing events, not as "rate limited"

## Mental Model

```
unit emits messages
    → journald counts in the current IntervalSec window
    → under Burst: store
    → over Burst: drop until window resets
    → on next accepted message: log "Suppressed N messages"
```

`RateLimitIntervalSec=30s` and `RateLimitBurst=10000` means 10 000 messages per 30 seconds per unit before suppression. Defaults are intentionally conservative.

Priority matters on some builds: emergency messages may bypass or have a separate budget. Do not rely on that for application ERROR logs.

## Key Commands

```bash
# Effective config
systemctl cat systemd-journald
grep -R RateLimit /etc/systemd/journald.conf /etc/systemd/journald.conf.d 2>/dev/null

# Find suppression events
journalctl -u systemd-journald --no-pager | grep -i suppressed
journalctl --since "1 hour ago" | grep -i "Suppressed.*messages"

# Which unit is noisy
journalctl -o short-monotonic --since "10 min ago" | awk '{print $5}' | sort | uniq -c | sort -nr | head

# Disk pressure that often accompanies rate-limit hits
journalctl --disk-usage
```

Temporary raise (incident only):

```ini
# /etc/systemd/journald.conf.d/99-incident.conf
[Journal]
RateLimitIntervalSec=10s
RateLimitBurst=50000
```

Then `systemctl restart systemd-journald`. Restarting journald does not lose already-stored entries, but it does reset the rate-limit counters.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Missing stack traces during outage | Rate limit suppressed them | `grep Suppressed` in journald unit |
| "Suppressed N messages" every few seconds | Burst too low for the unit | config, unit log volume |
| Only one service's logs vanish | Per-unit limit | confirm unit name in suppression line |
| Logs fine locally, gap in central store | Forwarder saw drops | journald suppression + forwarder buffer |
| Raising limit fills disk | No matching SystemMaxUse | `--disk-usage`, vacuum |
| Suppression after restart of journald | Counters reset, flood resumes | unit still noisy |
| Debug logging left on | Application, not journald | unit Environment= or config |

## Investigation Tips

- Search for "Suppressed" before you conclude the application stopped logging. The application may have logged; journald dropped it.
- The suppression line names the unit. That is the place to look for a crash loop or a log-level mistake.
- Rate limiting is not a substitute for fixing the noisy service. Raise it only long enough to capture the evidence, then revert.
- If you forward to rsyslog or a shipper, confirm the forwarder is not also rate-limiting or dropping on its own socket buffer.
- `RateLimitBurst=0` disables limiting. That is acceptable for a short incident window on a host with disk headroom; it is not a permanent setting.
- After the incident, check `journalctl --disk-usage` and vacuum if the burst filled the journal.

## Related Notes

- [[journald and Persistent Storage]]
- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[rsyslog]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An application OOM produced a 40-line Java stack trace. journald suppressed 38 of the lines. The only evidence in the central store was "Suppressed 38 messages from app.service". Raising the burst for five minutes and reproducing captured the full trace.
- We disabled rate limiting permanently on a logging host. A single misconfigured client filled `/var` in 20 minutes. The limit exists for a reason; pair any raise with a disk cap and an alert on journal size.
