# XFS Repair and Metadata

## Concept

XFS is a journaling filesystem. Metadata changes are journaled; data is not (unless `data=journal` or specific mount options). `xfs_repair` rebuilds the filesystem from the journal and the allocation groups. It is not `fsck`; it does not prompt much and it expects the filesystem to be unmounted.

## Why it matters

- After an unclean shutdown or a hardware error, XFS usually replays the journal on mount and comes up clean. When it does not, `xfs_repair` is the tool.
- Running `xfs_repair` on a mounted filesystem (or while the journal is dirty in a way that needs a mount first) corrupts it.
- Large XFS volumes take hours to repair. You need the downtime window and a backup plan before you start.

## Mental Model

```
unclean unmount → journal dirty
    mount → journal replay (usually automatic) → clean
    if replay fails or forced → xfs_repair -L (zero log) or normal repair
```

`-n` is dry-run. `-L` zeros the log (loses the last transactions). Never `-L` unless the log is known corrupt and you accept the loss.

## Key Commands

```bash
# Is it clean? (must be unmounted for repair)
xfs_info /dev/mapper/vg-lv
mount | grep xfs
cat /proc/fs/xfs/stat   # or xfs_stats

# Dry run
xfs_repair -n /dev/mapper/vg-lv

# Real repair (unmounted!)
xfs_repair /dev/mapper/vg-lv

# If it complains about log
xfs_repair -L /dev/mapper/vg-lv   # last resort

# Check after
xfs_repair -n /dev/mapper/vg-lv
mount /dev/mapper/vg-lv /mnt && ls /mnt
```

Mount options that matter operationally: `inode64`, `logbsize`, `noatime`, `prjquota` / `pquota`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Mount fails “Structure needs cleaning” | dirty log or corruption | `dmesg`, try mount, then repair plan |
| `xfs_repair` says “filesystem has valuable metadata changes in a log” | journal not replayed | mount once (if possible) to replay, then unmount and repair |
| Repair takes many hours | large AG count or heavy fragmentation | `xfs_info`, plan window |
| After repair some files in `lost+found` | unlinked inodes | inspect lost+found, restore from backup if needed |
| Quota or project quota broken after repair | quota files not rebuilt | `xfs_quota`, remount with quota options |

## Investigation Tips

- Always try a normal mount first. XFS journal replay is the preferred recovery.
- Take an LVM snapshot or a block-level backup before `xfs_repair` on important data.
- `-n` first. Read the output. If it wants `-L`, understand that you are discarding the log.
- `xfs_repair` is single-threaded for many phases; large filesystems need patience and monitoring (`iostat`).
- After repair, run a full backup verification or at least `xfs_repair -n` again and check application-level consistency.
- `xfs_db` and `xfs_metadump` are for experts and support cases; do not experiment on production.

## Related Notes

- [[XFS Operations]]
- [[Filesystem Check and Repair]]
- [[LVM Deep Dive]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]
- [[Write Barriers and Ordered Data]]

## Personal Lessons Learned

- A host would not mount after a power loss. We ran `xfs_repair -L` immediately and lost the last few transactions of a database WAL. Mounting first would have replayed the journal cleanly. Now the runbook says “attempt mount, capture dmesg, only then repair”.
- Repair on a 40 TB volume ran for 9 hours. We had an LVM snapshot taken before starting, which saved us when the repair itself hit an I/O error on a bad sector.
