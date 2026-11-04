# Filesystem Check and Repair

## Concept

fsck (and its filesystem-specific cousins: e2fsck, xfs_repair, btrfs check) verifies and, when asked, repairs on-disk metadata. It is not a data-recovery tool for deleted files, and it is not safe to run against a mounted writable filesystem.

XFS in particular refuses to repair a mounted volume; you unmount or boot from rescue media.

## Why it matters

- A dirty journal or metadata inconsistency after a crash can remount the filesystem read-only or prevent mount entirely.
- Running repair on a mounted filesystem (or on the wrong device) can destroy data that was still recoverable.
- Automatic fsck at boot (the pass field in fstab) can turn a short outage into a multi-hour one on a large volume.
- “fsck fixed it” is not the end of the incident. You still need to know why the metadata was inconsistent and whether application data is coherent.

## Mental Model

```
unmount (or boot rescue / rd.break)
  → confirm you have the right device (blkid, lsblk)
      → read-only check first
          → repair only if the check demands it and you have a backup plan
              → mount
                  → application-level consistency check

ext4: e2fsck -n (check) then e2fsck -f -y (repair)
XFS:  xfs_repair -n (check) then xfs_repair (repair); never on a mounted FS
btrfs: btrfs check --readonly first; repair is last resort
```

The journal replay that happens on a normal mount after a clean shutdown is not a full fsck. A full check walks all metadata.

## Key Commands

```bash
# Identify
lsblk -f
blkid
findmnt -T /data          # must not be the live mount if you plan to repair

# ext4 / ext3
e2fsck -n /dev/mapper/vg-data          # read-only check
e2fsck -f -y /dev/mapper/vg-data       # force check and auto-repair (unmounted)

# XFS
xfs_repair -n /dev/mapper/vg-data      # check only
umount /data
xfs_repair /dev/mapper/vg-data         # repair (unmounted)
# if it complains about a dirty log:
xfs_repair -L /dev/mapper/vg-data      # zero the log — last resort, can lose recent writes

# btrfs
btrfs check --readonly /dev/mapper/vg-data
# repair mode is dangerous; prefer backup + recreate when possible

# After repair
mount /data
dmesg -T | tail
# then application checks (DB recovery, etc.)
```

fstab pass field: 0 = never, 1 = root (first), 2 = others. Large data volumes are often 0 with monitoring instead.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Remounted read-only after crash | Journal or metadata error | dmesg, plan unmount + check |
| Mount fails with “structure needs cleaning” | XFS or ext needs repair | xfs_repair -n or e2fsck -n from rescue |
| fsck runs for hours at boot | Large volume, pass=1 or 2 | fstab pass field, consider 0 + scheduled check |
| xfs_repair refuses to run | Filesystem still mounted | findmnt, umount or rescue boot |
| Repair “succeeds”, files missing or corrupt | Metadata fixed, data blocks were already bad | backups, application recovery |
| “Bad magic number” | Wrong device, or superblock damaged | blkid, try backup superblock (ext) |

## Investigation Tips

- Always start with a read-only check (`-n` / `--readonly`). The output tells you whether repair is even required.
- Confirm the device with `blkid` and `lsblk -f` immediately before the repair command. Restoring from the wrong LV is a career-limiting move.
- For XFS, `-L` (zero log) discards transactions that had not been checkpointed. Use it only when the alternative is an unmountable volume and you accept the data loss.
- Root filesystem repair normally requires rescue media or `rd.break` + switch to the real root unmounted. Do not try to fsck `/` from a running system.
- After any repair, do not declare victory until the application has run its own recovery (database crash recovery, file-level checksums, etc.).
- Large volumes: a full check can take hours and generate heavy IO. Schedule it; do not let an unexpected boot-time fsck become the outage.
- Snapshot or backup first when the data is valuable and the volume still mounts read-only.

## Related Notes

- [[Filesystems and Mounts]]
- [[ext4 Operations]]
- [[XFS Operations]]
- [[btrfs Operations]]
- [[Rescue and Emergency Targets]]
- [[Linux Boot Process]]
- [[LVM Deep Dive]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An automatic fsck on a 40 TB XFS volume at boot turned a five-minute kernel update into a six-hour outage. The pass field is now 0 on every large data volume; we schedule checks.
- xfs_repair -L was used because the volume would not mount. We lost about 30 seconds of writes. The database’s own recovery handled it. We still documented the exact window in the ticket.
- I once almost repaired the wrong multipath device because I used `/dev/sdc` instead of the mapper name. `lsblk -f` and reading the UUID back stopped me. Use stable names.
