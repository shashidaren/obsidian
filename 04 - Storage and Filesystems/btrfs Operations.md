# btrfs Operations

## Concept

btrfs is a copy-on-write filesystem with built-in checksums, snapshots, subvolumes, and online resize. A subvolume looks like a directory but is a separate filesystem root that can be snapshotted independently. Snapshots are cheap because they share extents until something is written.

It is not a drop-in replacement for ext4/XFS in every workload. The CoW design and metadata patterns have different failure modes and performance characteristics.

## Why it matters

- Snapshots give you a consistent point-in-time view for backups or “undo this deploy” without a second full copy of the data.
- Checksums detect silent corruption that ext4/XFS will happily return.
- Subvolumes let you isolate `/var/log` or a database data directory so a snapshot of the root does not freeze the database, and vice versa.
- Online balance and device replace are useful for software RAID-like setups, but a full disk during a balance is a classic outage.

## Mental Model

```
Physical devices
  → filesystem (UUID)
    → subvolumes (subvolid, mounted independently)
      → snapshots (read-only or read-write CoW copies of a subvolume)

Write path:
  data + metadata checksummed → new extents written → old extents remain until no snapshot references them

Key tools:
  btrfs filesystem / subvolume / device / balance / scrub / check
```

A snapshot is not a backup until it is copied somewhere else. Deleting the only copy of a subvolume deletes the data.

## Key Commands

```bash
# What is mounted and which subvol
findmnt -t btrfs
btrfs filesystem show
btrfs subvolume list /mnt

# Create / snapshot
btrfs subvolume create /mnt/subvol
btrfs subvolume snapshot /mnt/subvol /mnt/snap
btrfs subvolume snapshot -r /mnt/subvol /mnt/snap-ro

# Space and usage
btrfs filesystem df /mnt
btrfs filesystem usage /mnt

# Health
btrfs scrub start /mnt
btrfs scrub status /mnt
btrfs device stats /mnt

# Balance (reclaim space after deletes, or change RAID profile)
btrfs balance start -dusage=50 /mnt   # only data chunks < 50% full

# Rescue
btrfs check --readonly /dev/...
mount -o degraded,rescue /dev/... /mnt
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| ENOSPC with `df` showing free space | Metadata exhaustion or unallocated chunks | `btrfs filesystem df`, balance |
| Very slow deletes or snapshots | Too many snapshots, fragmentation | `btrfs subvolume list`, count |
| Checksum errors in dmesg | Disk problem or RAM | `btrfs device stats`, scrub, [[SMART and Disk Health]] |
| Mount fails after unclean shutdown | Log tree issue | `btrfs check`, rescue mount |
| Snapshot “eats” space unexpectedly | CoW on a large file that is rewritten | qgroups or just `btrfs filesystem du` |
| Balance never finishes | Disk too full to allocate new chunks | free space, cancel and free space first |
| Subvolume not visible after reboot | Not in fstab / mount unit | `findmnt`, fstab subvol= option |

## Investigation Tips

- `btrfs filesystem df` and `usage` are more honest than `df`. Look at metadata vs data and unallocated.
- A full disk during a balance is dangerous. Cancel (`btrfs balance cancel`), free space, then resume. Never start a balance on a nearly full filesystem without a plan.
- Snapshots are not free when the workload rewrites the same files (databases, VM images). Consider `nodatacow` or a separate subvolume for those workloads.
- Scrub is the way to verify checksums. Schedule it; do not wait for the first checksum error in production.
- After a failed balance or device failure, `btrfs device stats` and `btrfs filesystem show` tell you which device is missing or has errors before you touch `btrfs check`.
- Mount options that matter: `subvol=`, `compress=zstd`, `nodatacow`, `discard=async`. Document them; defaults have changed across kernel versions.

## Related Notes

- [[Filesystems and Mounts]]
- [[SMART and Disk Health]]
- [[Disk Full Runbook]]
- [[LVM Deep Dive]]
- [[ext4 Operations]]
- [[XFS Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A database volume on btrfs with hundreds of snapshots became unusable for deletes. Moving the data directory to its own subvolume with no snapshots (and taking filesystem-level snapshots of everything else) fixed both the performance and the backup story.
- ENOSPC with 40% free space was metadata. A filtered balance (`-musage=30`) recovered the filesystem without a full balance that would have taken days.
- I once snapshotted a VM image subvolume, then the hypervisor rewrote the image. The snapshot ballooned to nearly the size of the original. CoW + random writes is expensive; `nodatacow` or a raw device is safer for that workload.
