# Disk Full Runbook

**Purpose**: Quickly diagnose and safely recover from filesystem full conditions (blocks or inodes).

**When to use**: Application errors about "No space left on device", services failing to write logs/data, `df` showing 100%, or alerts on disk usage.

---

## 1. Quick Triage (30–60 seconds)

```bash
# Overall picture
df -hT
df -i

# Which filesystem is full?
df -hT | awk '$5+0 >= 90 || $5 == "Use%"'

# Recent large writes / deleted-but-open files
lsof +L1 2>/dev/null | head -20
```

**Key questions to answer immediately**:
- Is it **blocks** (`df -h`) or **inodes** (`df -i`)?
- Which mount point?
- Is the space reclaimable (logs, temp, deleted files still held open)?

---

## 2. Distinguish the three common failure modes

| Failure Mode              | Symptom                          | Primary commands                     |
|---------------------------|----------------------------------|--------------------------------------|
| Block exhaustion          | `df -h` shows 100%               | `du -xhd1`, `ncdu`, `find`           |
| Inode exhaustion          | `df -i` shows 100%, `df -h` OK   | `find /path -xdev -type f \| wc -l` |
| Deleted files still open  | `df -h` high, `du` lower         | `lsof +L1`, `lsof \| grep deleted`  |

---

## 3. Investigation Steps

### 3.1 Block space exhaustion

```bash
# Find the biggest directories on the full filesystem (replace /var)
du -xhd1 /var 2>/dev/null | sort -hr | head -20

# More interactive (if available)
ncdu -x /var

# Find large files modified recently
find /var -xdev -type f -size +100M -mtime -7 -exec ls -lh {} \; 2>/dev/null | sort -k5 -hr | head -20

# Common culprits
du -sh /var/log/* /var/lib/docker/* /tmp/* /var/cache/* 2>/dev/null | sort -hr
```

### 3.2 Inode exhaustion

```bash
# Confirm
df -i

# Find directories with huge numbers of files
find /var -xdev -type d -exec sh -c 'echo $(find "$1" -maxdepth 1 -type f | wc -l) "$1"' _ {} \; 2>/dev/null | sort -nr | head -20

# Typical causes: millions of small files in /var/spool, /var/lib/php/sessions, mail queues, container layers, etc.
```

### 3.3 Deleted files still held open

```bash
# Files that are deleted but still open by a process
lsof +L1

# Or
lsof 2>/dev/null | grep deleted

# Space will only be freed when the process closes the file or is restarted
```

---

## 4. Safe Remediation (ordered by safety)

### Immediate safe actions

1. **Rotate / clean logs** (almost always safe):
   ```bash
   # Force logrotate
   logrotate -f /etc/logrotate.conf

   # Truncate a huge log without deleting the file (safe while process holds it)
   truncate -s 0 /var/log/huge.log
   # or
   > /var/log/huge.log
   ```

2. **Clean package caches**:
   ```bash
   # Debian/Ubuntu
   apt-get clean
   # RHEL/CentOS/Rocky
   dnf clean all
   # or
   yum clean all
   ```

3. **Clear temporary files**:
   ```bash
   find /tmp -type f -atime +7 -delete 2>/dev/null
   find /var/tmp -type f -atime +7 -delete 2>/dev/null
   ```

4. **Docker / container related** (very common):
   ```bash
   docker system df
   docker system prune -af --volumes   # careful in production
   # or more selective
   docker image prune -a
   docker container prune
   ```

5. **Deleted but open files**:
   - Identify the process: `lsof +L1`
   - Restart the service **only if** it is safe:
     ```bash
     systemctl restart <service>
     ```

### Actions that require more care

- Moving or deleting large application data → take a backup/snapshot first if possible.
- Expanding the filesystem / LVM → only after confirming root cause and having a rollback plan.
- Killing processes holding deleted files → last resort.

---

## 5. Verification

```bash
df -hT
df -i

systemctl status <service>
journalctl -u <service> -n 50 --no-pager
```

**Success criteria**:
- Filesystem usage back to a safe level (usually < 85–90%)
- Application can write again
- No new "No space left on device" errors

---

## 6. Prevention & Follow-up

- Alert on disk **and** inode usage (80% / 90% thresholds).
- Ensure logrotate is configured and working for all major logs.
- For containers: use log drivers with size limits or a proper logging stack.
- Consider separate filesystems for `/var/log`, `/var/lib/docker`, and application data.
- Document the root cause.

---

## Related Notes

- [[df and du Deep Dive]]
- [[Inodes]]
- [[lsof Deep Dive]]
- [[logrotate]]
- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]

---

## Personal Lessons Learned

> Add real incidents here later, for example:
> - 2025-xx-xx: Docker overlay2 filled /var because of uncontrolled image pulls
> - Truncating logs with `>` is safer than `rm` when the process still has the file open
