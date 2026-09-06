# XFS Operations

## Concept

XFS is a journaling filesystem built for large files, parallel I/O, and online growth. It is the default on RHEL-family systems and common on big data, VM image, and database volumes.

What XFS is *not*: a shrink-friendly filesystem. There is no supported online (or even offline-but-simple) shrink. Capacity planning happens *before* you carve the LV.

Metadata lives in allocation groups (AGs). That is why `xfs_repair` and `xfs_info` talk about AGs, and why a single corrupted AG can take a huge volume offline.

## Why it matters

- Growing a volume is a two-step operation: grow the block device / LV, then `xfs_growfs` on the *mount point*
- A dirty XFS that will not mount usually wants `xfs_repair` on an *unmounted* device, not a hopeful remount
- `ENOSPC` on XFS can be data space, metadata/inode reservation, or a full log — `df -h` alone is not enough
- Quotas, reflink, and `allocsize` surprises show up as “why is this write stalling?” tickets

Most XFS outages are operational: forgot to grow the FS, ran repair while mounted, or filled the volume with files that never get unlinked.

## Mental Model

```
block device / LV
        ↓
   XFS superblock + AGs
        ↓
   journal (internal log, usually)
        ↓
   data extents + inodes (dynamic)
        ↓
   mount point  ←  xfs_growfs talks to *this*
```

Grow path:

```
cloud disk / SAN LUN larger
    → grow PV (pvresize) if LVM
    → lvextend
    → xfs_growfs /mount          # not the device node
```

XFS inodes are allocated dynamically. You can still exhaust them on a tiny FS with millions of tiny files, but it is less common than on a small ext4 formatted with a conservative inode ratio.

## Key Commands

```bash
# What is this filesystem?
findmnt -no FSTYPE,SOURCE,OPTIONS /data
xfs_info /data                    # must be mounted

# Space and metadata
df -hT /data
df -i /data
xfs_quota -x -c 'report -h' /data   # if quotas are on

# Grow after the LV/disk is already larger
lsblk /dev/mapper/vg-data
lvextend -L +50G /dev/mapper/vg-data     # or -l +100%FREE
xfs_growfs /data                         # uses mount point

# Freeze for consistent snapshots (LVM/cloud snapshot)
xfs_freeze -f /data
# ... take snapshot ...
xfs_freeze -u /data

# Integrity — UNMOUNTED device only
umount /data
xfs_repair -n /dev/mapper/vg-data        # dry run
xfs_repair /dev/mapper/vg-data

# Last-resort salvage (destroys the log; data risk)
# xfs_repair -L /dev/mapper/vg-data

# Dump / restore (not a substitute for real backups)
xfsdump -l 0 -f /backup/data.xfsdump /data
xfsrestore -f /backup/data.xfsdump /restore-target
```

`xfs_fsr` (defrag) exists. On modern SSDs it is rarely worth the I/O; measure fragmentation with `xfs_db` before you run it in production.

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks |
|---------|---------------|--------------|
| `df` still 100% after `lvextend` | Forgot `xfs_growfs` | `xfs_info` block count vs `lsblk` size |
| `xfs_growfs: not a mounted XFS` | Aimed at the device node, or wrong FS | `findmnt`; pass the mount point |
| Will not mount, log/journal errors | Unclean shutdown, bad disk | `journalctl -b`; `xfs_repair -n` unmounted |
| `Structure needs cleaning` | Kernel refused a dirty FS | Unmount, repair, *then* mount |
| Writes stall, `df` not full | Metadata reservation, quotas, or log | `df -i`, `xfs_quota`, `dmesg` |
| `No space left` with free GiB | Inode / project quota / ENOSPC on metadata | `df -i`, quota report |
| Repair “fixed” nothing / worse | Repair run while mounted | Never; take an offline copy first |
| Cannot shrink | Not supported | New smaller LV + copy, or restore |

## Investigation Tips

- `xfs_info /mount` prints AG count, block size, and current size. Compare that to `lsblk` / `lvs` after a disk expansion.
- Kernel XFS messages in `dmesg` (`xfs_log`, `corruption`, `shut down`) mean stop writing. Remounting read-write over a shut-down XFS is how you turn a recoverable volume into a restore.
- `-L` (zero the log) is a last resort after a copy or snapshot exists. It can lose recent transactions.
- Online `xfs_growfs` is safe and fast. Shrinking is a migration project, not a flag.
- For consistent cloud snapshots of a busy XFS volume: `xfs_freeze -f`, snapshot, `xfs_freeze -u`. Skipping freeze gives you a crash-consistent disk, not a filesystem-consistent one.
- If `df` and `du` disagree, that is not an XFS-specific bug — see [[df and du Deep Dive]] and `lsof +L1`.

## Related Notes

- [[ext4 Operations]]
- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[Block Devices and Partitions]]
- [[Disk Full Runbook]]
- [[Inodes]]
- [[Disk I/O and Latency]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have watched people extend an LV three times during an incident and still have a full mount. `xfs_growfs` is the step that is easy to skip because `lsblk` already looks bigger.
- The only time I used `xfs_repair -L` without a snapshot first, we lost the tail of a queue that the app thought it had fsynced. Freeze or snapshot, then repair.
- A “corrupt XFS” on a VM was the virtual disk thinning out from under us. Repair kept failing until the hypervisor storage was healthy. Fix the device before you blame the filesystem.
