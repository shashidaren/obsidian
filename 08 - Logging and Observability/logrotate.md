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

`copytruncate` exists for apps that cannot reopen. It is a compromise, not the default you should reach for.

Rotation is driven by *when logrotate runs* plus *size or calendar triggers*. A `size 100M` stanza does nothing until the next scheduled run.

## Key Commands

```bash
# Config locations
/etc/logrotate.conf
/etc/logrotate.d/          # per-package snippets

# Which timer or cron actually fires it?
systemctl list-timers | grep -i logrotate
systemctl status logrotate.timer logrotate.service
ls -l /etc/cron.daily/logrotate

# Force a run (useful for testing)
logrotate -f /etc/logrotate.conf
logrotate -f /etc/logrotate.d/nginx

# Debug / dry-run (shows the decision tree, changes nothing)
logrotate -d /etc/logrotate.conf
logrotate -d /etc/logrotate.d/myapp

# Status / last run tracking
cat /var/lib/logrotate/status
# Debian/Ubuntu sometimes: /var/lib/logrotate/status
# Some builds: /var/lib/logrotate.status

# After rotation: is the app writing the new inode?
ls -li /var/log/myapp/app.log /var/log/myapp/app.log.1
ls -l /proc/<PID>/fd | grep /var/log/myapp

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

Important options: `size` vs `daily`/`weekly`, `maxsize`/`minsize`, `maxage`, `dateext`, `dateformat`, `su`, `olddir`, `sharedscripts`.

`sharedscripts` runs prerotate/postrotate once for the whole stanza, not once per matched file. That is usually what you want for a single reload.

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks / fix |
|---------|---------------|--------------------|
| Disk fills with old logs | rotate count too high, size never triggers, timer dead | Config, `list-timers`, status file, `du -sh /var/log` |
| App still writes to `.1` file | Missing or failed postrotate signal | `ls -l /proc/PID/fd`; HUP/reload; prefer create + signal |
| New log file has wrong owner/mode | Missing `create` mode/owner or `su` | Explicit `create 0640 user group` |
| logrotate itself fails silently | Permission, SELinux/AppArmor, bad include | `logrotate -d`, journal of the timer/service |
| Gaps / missing log lines | copytruncate race or app not reopening | Switch to create + proper signal if possible |
| Compressed logs not readable by tools | delaycompress / wrong compression | Document `zcat`/`zgrep`; keep one uncompressed generation |
| Wildcard matches a file still open under a new name | Glob too wide after dateext | Tighten the pattern; inspect status file |
| Rotation skipped for days | `notifempty` + app stopped writing; or size trigger waiting for next run | Status timestamps; do not confuse size with continuous watch |

## Investigation Tips

- Always start with `logrotate -d` on the *specific* snippet before `-f`.
- Check `/var/lib/logrotate/status` for the last successful rotation timestamp per file. If a file vanished from the status map, the glob no longer matches.
- After a forced rotation, confirm the application has the new file open (`lsof` / `ls -l /proc/<pid>/fd`). Matching names are not matching inodes.
- On systems using journald primarily, file-based logs may still exist for applications that bypass journald; both need care.
- Test retention math: `rotate 14` + `daily` keeps ~14 generations; combine with `maxage` for calendar-based expiry.
- Watch for packages that ship their own snippets and silently override a local change on upgrade. Put local policy in a clearly named file and document it.
- Disk-full incidents: rotate *and* confirm something is vacuuming journald. logrotate does not manage the journal.

## Related Notes

- [[Disk Full Runbook]]
- [[Logging Architecture]]
- [[journald and Persistent Storage]]
- [[rsyslog]]
- [[df and du Deep Dive]]
- [[lsof Deep Dive]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The app was writing gigabytes into `app.log.1` after a "successful" rotation. postrotate ran `kill -HUP` against a PID file that had been stale for a week. Always verify the live FD, not the script exit code.
- `copytruncate` on a busy audit log dropped the lines that explained an incident. If the process can reopen, use create + reload. If it cannot, accept the race and ship logs to journald/rsyslog instead.
- A `size 200M` rule with a daily timer let a debug-enabled service fill the disk at 14:00. Size is not a watchdog. Put a disk-usage alert next to logrotate, and have an emergency `logrotate -f` in the disk-full runbook.
- Package upgrades restored a vendor snippet and undid our `su` / `create` lines. The new file was root:root 644 and the service refused to write. Pin local overrides and diff `/etc/logrotate.d` after patching.
