# Filesystem Freeze for Consistent Backups

## Concept

`fsfreeze` (or the equivalent ioctl used by LVM, ZFS, and some backup agents) suspends writes to a filesystem so that a snapshot or block-level copy sees a consistent image. The freeze is held only for the duration of the snapshot creation; applications must tolerate a short stall.

## Why it matters

- Crash-consistent snapshots are not application-consistent. Databases can have torn pages or uncommitted WAL if you snapshot without a freeze or a database-level quiesce.
- Holding a freeze too long (slow snapshot, hung backup agent) stalls every writer and can trigger application timeouts or watchdog kills.
- Some filesystems and workloads (heavy writers, NFS clients) behave poorly under prolonged freeze.
- Cloud volume snapshots are often crash-consistent unless the guest explicitly freezes first.

## Mental Model

```
fsfreeze --freeze /mount
    → new writes block in the page cache / journal
    → create snapshot (LVM, ZFS, cloud API, etc.)
fsfreeze --unfreeze /mount
    → blocked writes proceed

Quiesce order for a database:
  1. database checkpoint / FLUSH TABLES WITH READ LOCK / etc.
  2. fsfreeze (or let the snapshot tool do it)
  3. snapshot
  4. unfreeze
  5. release database lock
```

The freeze is per-filesystem. A database that spans multiple mounts needs every mount frozen or a higher-level quiesce.

## Key Commands

```bash
# Freeze / unfreeze (requires util-linux)
fsfreeze --freeze /var/lib/pgsql
# ... take snapshot ...
fsfreeze --unfreeze /var/lib/pgsql

# Check if frozen (some kernels)
cat /sys/fs/<fstype>/<dev>/frozen 2>/dev/null || echo "no sysfs"

# LVM snapshot (freezes under the hood on many setups)
lvcreate -L 10G -s -n backup /dev/vg/data

# ZFS
zfs snapshot tank/data@backup
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Applications hang during backup | Freeze held too long | backup agent logs, `ps` D-state |
| Database corruption after restore | No quiesce, only crash-consistent snap | backup method, WAL/redo |
| fsfreeze fails “Device or resource busy” | Open files, NFS, or already frozen | `lsof`, `fuser`, nested mounts |
| Snapshot succeeds but restore fails | Freeze on wrong mount | confirm mount points vs data dirs |
| Cloud snap “consistent” but app broken | Guest never froze | cloud-init or agent freeze hook |

## Investigation Tips

- Time the freeze window. If snapshot creation takes more than a few seconds, investigate storage latency before blaming the application.
- For databases, prefer the database’s own backup tool (pg_basebackup, xtrabackup, RMAN) or an explicit quiesce over a raw fsfreeze when possible.
- After a hung freeze, `fsfreeze --unfreeze` from another session (or a reboot) is the recovery path. Do not kill -9 random processes while frozen.
- Test restore regularly. A snapshot that was taken while frozen is only useful if you have proven you can mount and recover from it.

## Related Notes

- [[Backup Strategy]]
- [[LVM Deep Dive]]
- [[ZFS Operations]]
- [[Database Backup and Restore]]
- [[Thin Provisioning and Snapshots]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A nightly LVM snapshot job started taking 40 seconds because the underlying storage was overloaded. PostgreSQL clients began seeing lock timeouts. We moved the snapshot to a quieter window and added a timeout that aborts the freeze if the snapshot does not complete in 10 seconds.
- Restoring a “consistent” cloud volume snapshot of a MySQL data directory produced a server that needed crash recovery every time. Adding an explicit `FLUSH TABLES WITH READ LOCK` + fsfreeze (or switching to xtrabackup) eliminated the recovery step.
