# journald and Persistent Storage

## Concept

`journald` can store logs in two ways:

- **Volatile** – in memory / `/run/log/journal` (lost on reboot)
- **Persistent** – on disk under `/var/log/journal`

Persistence is controlled by configuration in `/etc/systemd/journald.conf` and the presence of the directory.

## Why it matters

- Without persistent storage you lose logs across reboots (bad for post-incident analysis).
- With persistent storage you must manage disk usage, or the journal can fill the disk.

## Mental Model

```
Storage=auto     → persistent if /var/log/journal exists, otherwise volatile
Storage=persistent → always try to use /var/log/journal
Storage=volatile   → only /run/log/journal
Storage=none       → disable journal storage
```

## Key Commands

```bash
# Current disk usage of the journal
journalctl --disk-usage

# Is it persistent?
ls /var/log/journal

# Configuration
cat /etc/systemd/journald.conf | grep -v '^#' | grep -v '^$'

# Vacuum (clean old logs)
journalctl --vacuum-size=500M
journalctl --vacuum-time=14d

# Restart after config change
systemctl restart systemd-journald
```

### Important journald.conf settings

```
[Journal]
Storage=persistent
SystemMaxUse=1G
SystemKeepFree=2G
MaxRetentionSec=1month
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Logs disappear after reboot          | Volatile storage only                     | `ls /var/log/journal`, Storage=  |
| /var filling up                      | Journal growing without limits            | `journalctl --disk-usage`, SystemMaxUse |
| journalctl shows very little history | Aggressive vacuum or small retention      | Config + vacuum settings         |
| Permission issues writing journal    | Directory ownership / SELinux             | Permissions on /var/log/journal  |

## Investigation Tips

- Creating `/var/log/journal` and restarting journald is the usual way to enable persistence when Storage=auto.
- Set explicit size limits (`SystemMaxUse`) on any production system with persistent journals.
- `journalctl --disk-usage` should be part of regular disk checks.
- Vacuum commands are safe ways to reclaim space without deleting the entire journal.

## Related Notes

- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[Disk Full Runbook]]
- [[logrotate]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
