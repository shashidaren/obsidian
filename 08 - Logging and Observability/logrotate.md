# logrotate

## Concept

`logrotate` manages the size and retention of log files on disk. It renames (or copies) active logs, compresses old ones, removes expired copies, and signals applications so they open a fresh file.

## Why it matters

- Unrotated logs are a classic cause of full disks and cascading outages
- Applications that keep an open file descriptor will continue writing to the *renamed* file unless told otherwise
- Incorrect `copytruncate` vs `create` choices, missing `postrotate` scripts, or wrong permissions produce silent log loss or permission errors
- Retention policy is both an operational and a compliance concern

Treat logrotate as critical infrastructure, not a set-and-forget cron job.

## Mental Model

```
logrotate runs (usually daily via cron/systemd timer)
  → reads /etc/logrotate.conf + /etc/logrotate.d/*
  → for each matching file:
       rename / copy / compress according to config
       run postrotate / prerotate scripts
       remove files older than the retention window
```

Two common strategies for the active file:

- **create** (preferred when the app can reopen): rename old → create new empty file → signal app (HUP / systemctl reload)
- **copytruncate**: copy content → truncate original in place (app keeps writing to the same inode; small race window of lost lines)

## Key Commands

```bash
# Config locations
/etc/logrotate.conf
/etc/logrotate.d/          # per-package snippets

# Force a run (useful for testing)
logrotate -f /etc/logrotate.conf
logrotate -f /etc/logrotate.d/nginx

# Debug / dry-run style (shows what would happen)
logrotate -d /etc/logrotate.conf

# Status / last run tracking
cat /var/lib/logrotate/status

# Typical snippet pattern
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 appuser appgroup
    sharedscripts
    postrotate
        systemctl reload myapp >/dev/null 2>&1 || true
    endscript
}
```

Important options: `size` vs `daily`/`weekly`, `maxage`, `dateext`, `dateformat`, `su`, `olddir`.

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks / fix                        |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| Disk fills with old logs             | rotate count too high or size never triggers | Inspect config, force run, check status file |
| App still writes to `.1` file        | Missing or failed postrotate signal        | Confirm HUP/reload; prefer create + signal |
| New log file has wrong owner/mode    | Missing `create` mode/owner or `su`        | Add explicit `create 0640 user group`     |
| logrotate itself fails silently      | Permission, SELinux, or bad include        | `logrotate -d`, check cron/systemd unit logs |
| Gaps / missing log lines             | copytruncate race or app not reopening     | Switch to create + proper signal if possible |
| Compressed logs not readable by tools| delaycompress / wrong compression          | Adjust delaycompress; document zcat usage |

## Investigation Tips

- Always start with `logrotate -d /etc/logrotate.conf` to see the decision tree without changing anything.
- Check `/var/lib/logrotate/status` for the last successful rotation timestamp per file.
- After a forced rotation, confirm the application has the new file open (`lsof` / `ls -l /proc/<pid>/fd`).
- On systems using journald primarily, file-based logs may still exist for applications that bypass journald; both need care.
- Test retention math: `rotate 14` + `daily` keeps ~14 days; combine with `maxage` for calendar-based expiry.
- Watch for packages that ship their own logrotate snippets and override them carelessly.

## Related Notes

- [[Disk Full Runbook]]
- [[Logging Architecture]]
- [[journald and Persistent Storage]]
- [[rsyslog]]
- [[df and du Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
