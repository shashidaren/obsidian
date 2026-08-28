# journald and Persistent Storage

## Concept

`systemd-journald` is the local structured log store for systemd systems. It can keep journals in memory (`/run/log/journal`, lost on reboot) or on disk (`/var/log/journal`, survives reboot). Persistence is decided by `Storage=` in `/etc/systemd/journald.conf` *and* by whether `/var/log/journal` exists.

journald is not a replacement for a central log store. It is the first durable hop — if you get this hop wrong, every later hop inherits the gap.

## Why it matters

- Post-reboot incident review is impossible on a volatile journal
- An unbounded persistent journal will fill `/var` and take the box down with it
- `Storage=auto` looks persistent in docs and volatile in reality if the directory was never created
- Size caps (`SystemMaxUse`, `SystemKeepFree`, `RuntimeMaxUse`) are the difference between “logs for 30 days” and “logs for 11 minutes”
- Permissions and SELinux/AppArmor on `/var/log/journal` silently stop writes after a restore or a hand-created directory

## Mental Model

```
Storage=auto        → use /var/log/journal if present, else /run/log/journal
Storage=persistent  → create/use /var/log/journal (falls back to runtime if /var is unwritable)
Storage=volatile    → only /run/log/journal
Storage=none        → journald does not store; forwarding only (if configured)

Runtime journals  = current boot, tmpfs, small by design
System journals   = on-disk, vacuumed by size and time
```

Vacuum is automatic. When caps are hit, *oldest* archived journals go first. That can look like “journalctl is broken” when it is actually doing its job.

Per-machine directories under `/var/log/journal/<machine-id>/` matter after a clone, template VM, or `machine-id` regeneration: you may be reading the wrong tree.

## Key Commands

```bash
# Where is the journal and how big is it?
journalctl --disk-usage
ls -ld /run/log/journal /var/log/journal
ls -l /var/log/journal/$(cat /etc/machine-id) 2>/dev/null

# Effective config (drop-ins included)
systemctl cat systemd-journald
systemctl show systemd-journald --property=FragmentPath
grep -Rnv '^#' /etc/systemd/journald.conf /etc/systemd/journald.conf.d 2>/dev/null

# Persistence check after reboot
journalctl --list-boots
journalctl -b -1 -n 20 --no-pager    # previous boot; fails if volatile

# Caps and vacuum
journalctl --vacuum-size=500M
journalctl --vacuum-time=14d
journalctl --verify                 # checksum scan; slow on large journals

# Apply config
systemctl restart systemd-journald
# creating the dir is the usual enable-persist trick with Storage=auto
mkdir -p /var/log/journal
systemctl restart systemd-journald
ls -ld /var/log/journal

# Forwarding / rate limits worth knowing exist
sysctl kernel.printk
# journald.conf: RateLimitIntervalSec=, RateLimitBurst=, ForwardToSyslog=, MaxLevelStore=
```

Useful `journald.conf` baseline for a general-purpose server:

```
[Journal]
Storage=persistent
SystemMaxUse=1G
SystemKeepFree=2G
RuntimeMaxUse=200M
MaxRetentionSec=14day
ForwardToSyslog=no
```

Tune `SystemMaxUse` to the host, not to a blog post. A 20G `/var` and `SystemMaxUse=8G` is how you page at 02:00.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Empty history after reboot | Volatile storage / missing `/var/log/journal` | `ls /var/log/journal`, `Storage=`, `--list-boots` |
| `/var` filling without obvious files | Journal + unrotated app logs | `journalctl --disk-usage`, `du -sh /var/log/*` |
| Only a few hours of history | Caps or vacuum too aggressive | `SystemMaxUse`, `MaxRetentionSec`, noisy units |
| `Permission denied` / nothing new in journal | Dir ownership, ACLs, SELinux | `ls -ldZ /var/log/journal`, audit log |
| Previous boot missing after clone | New `machine-id`, old journal dir left behind | Compare `/etc/machine-id` vs directory name |
| Apparent log loss under load | Rate limiting | `RateLimitBurst` / `RateLimitIntervalSec`; “suppressed N messages” in journal |
| `journalctl --verify` reports corruption | Crash mid-write, full disk, bad disk | Vacuum broken files; check storage health |
| Central logs fine, local journal tiny | `Storage=none` or tiny runtime cap | Config; confirm you are not looking at `/run` |

## Investigation Tips

- `journalctl --list-boots` is the fastest persistence test. One boot listed after weeks of uptime is a smell; one boot listed *after a reboot* is a design.
- Creating `/var/log/journal` without restarting journald (or without correct `systemd-journal` group ownership) does nothing useful.
- `SystemKeepFree` wins arguments with `SystemMaxUse`. If free space is below `SystemKeepFree`, journald will shrink even if it is under `SystemMaxUse`.
- Do not use vacuum as your only retention policy on a host that must support RCA. Cap size *and* keep a forwarder.
- After restore-from-backup of `/var`, fix ownership (`systemd-tmpfiles --create` or package defaults) before assuming logging is healthy.
- `ForwardToSyslog=yes` plus rsyslog reading the journal can duplicate messages. Pick one primary local consumer.
- Include `journalctl --disk-usage` in disk-full runbooks. People look at `du /var/log/*.log` and miss the journal directory.

## Related Notes

- [[journalctl Deep Dive]]
- [[journalctl Command Reference]]
- [[Logging Architecture]]
- [[logrotate]]
- [[rsyslog]]
- [[Disk Full Runbook]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> The most common “we have no logs for the crash” postmortem on cloud images is `Storage=auto` plus a missing `/var/log/journal` on a golden AMI that never created the directory.
