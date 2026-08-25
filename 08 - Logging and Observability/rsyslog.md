# rsyslog

## Concept

`rsyslog` is the classic system logger on many Linux distributions. It receives messages from the kernel, local processes (via syslog API or journald forward), and optionally remote hosts, then filters, transforms, and writes them to files, remote syslog servers, or other outputs.

On modern systemd systems it often coexists with `journald`: journald may forward to rsyslog, or rsyslog may read the journal. Know which path your distro uses.

## Why it matters

- Application and security logs still land in traditional files (`/var/log/messages`, `/var/log/secure`, app-specific paths) that many tools and humans expect
- Centralised logging (SIEM, log aggregators) frequently depends on rsyslog forwarding
- Misconfigured queues, disk-full behaviour, or broken remote targets cause silent log loss during incidents — exactly when you need the logs
- Rate limiting and filters can hide the very messages you are hunting for

If logs “stop appearing”, rsyslog config and its queues are high on the checklist.

## Mental Model

```
Inputs:
  imuxsock / imjournal / imtcp / imudp / imfile …
        ↓
  Rules (selectors + filters + templates)
        ↓
  Actions: local files, remote (omfwd), pipelines, databases …

Key ideas:
- Facilities (auth, kern, local0…) + priorities (debug…emerg)
- Queues buffer when the output is slow or down (disk-assisted queues matter)
- Templates control message format
- Modules are loaded explicitly in config
```

Main config: `/etc/rsyslog.conf` plus drop-ins under `/etc/rsyslog.d/`.

## Key Commands

```bash
# Service status and recent errors
systemctl status rsyslog
journalctl -u rsyslog -n 50 --no-pager

# Validate config before reload
rsyslogd -N1                    # syntax check
rsyslogd -N1 -f /etc/rsyslog.conf

# Reload after changes (prefer reload over restart when possible)
systemctl reload rsyslog
# or: kill -HUP $(pidof rsyslogd)

# What is listening / where is it writing?
ss -tulpn | grep rsyslog
ls -la /var/log/

# Watch a log in real time
tail -F /var/log/messages
tail -F /var/log/secure          # RHEL-like auth
tail -F /var/log/auth.log        # Debian-like auth

# Logger — inject a test message
logger -p local0.info "rsyslog test $(date -Is)"
logger -t myapp "application test message"

# Show effective config (if rsyslog supports it on your version)
rsyslogd -N1 2>&1 | head
# Many systems: grep -r . /etc/rsyslog.conf /etc/rsyslog.d/ | grep -v '^#'

# Disk space for log files (common outage cause)
df -h /var/log
du -sh /var/log/* | sort -h | tail
```

### Useful config fragments (illustrative)

```
# Forward everything to a central server (TCP, with queue)
*.*  action(type="omfwd" target="log.example.com" port="514" protocol="tcp"
           queue.type="LinkedList" queue.filename="fwd_queue"
           action.resumeRetryCount="-1" queue.saveOnShutdown="on")

# Local file with a simple selector
authpriv.*    /var/log/secure
```

Exact syntax varies by rsyslog version (RainerScript vs legacy). Prefer the style already used on the host.

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| No new lines in /var/log/*           | rsyslog stopped, disk full, wrong path     | `systemctl status rsyslog`, `df -h /var/log`      |
| Remote SIEM missing logs             | Forwarding action failing, queue full      | rsyslog journal, network to target, queue files   |
| Logs stop under load                 | Rate limiting, disk-assisted queue exhausted | Config for `$SystemLogRateLimit*`, queue settings |
| Duplicate or missing after journald change | Forwarding path between journald and rsyslog | `ForwardToSyslog=`, imjournal vs imuxsock         |
| Permission denied writing log file   | Directory ownership / SELinux / AppArmor   | `ls -ld /var/log`, MAC logs                       |
| Config change has no effect          | Syntax error, wrong drop-in, no reload     | `rsyslogd -N1`, `systemctl reload rsyslog`        |
| Huge single log file                 | logrotate not running or misconfigured     | [[logrotate]], size of files under /var/log       |

## Investigation Tips

- Always confirm whether the host is primarily journald-centric, rsyslog-centric, or both. `journalctl` vs files under `/var/log` can disagree if forwarding is broken.
- Test with `logger` and watch the expected file or remote collector — proves the pipeline end-to-end.
- On disk-full incidents, rsyslog may stop writing or block; check `df` and any disk-assisted queue directories (often under `/var/spool/rsyslog` or similar).
- After editing config, run `rsyslogd -N1` before reload. A broken config can leave you without logging.
- For remote forwarding failures, verify connectivity (port 514/tcp or 6514/tcp for TLS) and that the action’s queue is not stuck.
- Correlate with [[logrotate]]: rsyslog opens files; rotation must signal or reopen correctly or logging continues to a deleted inode.

## Related Notes

- [[journald and Persistent Storage]]
- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[logrotate]]
- [[Metrics Logs and Traces]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
