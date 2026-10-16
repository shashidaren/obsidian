# ZFS Operations

## Concept

ZFS is a combined volume manager and filesystem. A pool is built from vdevs (mirror, raidz1/2/3, or single disks). Datasets are the filesystem objects you mount, snapshot, and set properties on. Every block is checksummed; the pool can detect and, with redundancy, repair silent corruption.

Unlike LVM+ext4/XFS, the checksum, the RAID, and the filesystem are one layer. Snapshots are copy-on-write and essentially free until you start writing.

## Why it matters

- Silent disk corruption that LVM+ext4 would never notice becomes a checksum error you can act on.
- Snapshots + send/receive give you a practical replication and rollback story that does not require application freeze windows of the same length as an LVM snapshot.
- A degraded pool (one disk in a mirror or raidz) is still online. Ignoring it until the second failure is how people lose the pool.
- ZFS memory use (ARC) is aggressive by default. On a host that also runs databases or VMs this becomes the “why is my free memory zero” ticket.
- Importing a pool that was last seen on another host without care can create a split-brain or refuse to import.

## Mental Model

```
Disks / partitions
  └── vdev (mirror, raidzN, or single)
        └── pool (zpool)
              ├── dataset (filesystem)   zfs list
              ├── snapshot               zfs list -t snapshot
              ├── volume (zvol)          block device for VMs
              └── free space             pool free, not per-dataset until you set quotas

Checksum on every block
  → scrub walks the tree and repairs from redundancy if a checksum fails
```

Properties (compression, atime, quota, reservation, recordsize) are inherited and can be set per dataset. Most performance and space surprises are property or vdev-layout problems, not “ZFS is slow”.

## Key Commands

```bash
# Health first
zpool status
zpool status -v          # show individual checksum errors
zpool list
zfs list
zfs list -t snapshot

# Scrub (do this on a schedule)
zpool scrub <pool>
zpool scrub -s <pool>    # stop

# Snapshots and rollback
zfs snapshot <pool>/<dataset>@pre-change
zfs rollback <pool>/<dataset>@pre-change   # destroys newer snapshots
zfs destroy <pool>/<dataset>@oldsnap

# Send / receive (replication)
zfs send <pool>/data@snap | zfs receive backup/data
zfs send -i @prev @new | zfs receive …     # incremental

# Import after move / rescue
zpool import                 # see available
zpool import -f <pool>       # force if it thinks another host has it
zpool import -N <pool>       # import without mounting datasets

# Space and properties
zfs get all <pool>/<dataset> | grep -E 'compress|quota|reserv|recordsize|atime'
zfs set compression=lz4 <pool>/<dataset>
zfs set quota=100G <pool>/<dataset>
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `zpool status` DEGRADED | Disk failed or was removed; redundancy still holding | `zpool status`, replace the disk |
| Checksum errors climbing | Bad disk, bad cable, or RAM (ECC helps) | `zpool status -v`, smartctl, memtest |
| Pool will not import | Last host still “owns” it, or label damage | `zpool import`, `-f` only after you know the other host is dead |
| ARC eating all RAM | Default behavior; host also runs DB/VMs | `arc_summary` or `/proc/spl/kstat/zfs/arcstats`, limit via module param |
| Snapshot “disk full” | Snapshots holding old blocks; pool free is low | `zfs list -t snapshot`, destroy old ones |
| Send/receive stalls or errors | Network, or destination pool full / readonly | `zpool list` on both, `zfs get readonly` |
| Recordsize mismatch with DB | 128K default vs 8K/16K InnoDB pages | `zfs get recordsize`, set before creating the dataset |
| Boot pool missing after kernel update | zfs module not in initramfs | `lsinitrd`, dracut/mkinitcpio zfs hook |

## Investigation Tips

- `zpool status` is the first command. If it is not ONLINE or DEGRADED with a clear failed disk, stop and read before you import -f or destroy anything.
- Scrub on a schedule and alert on checksum or read/write errors. A pool that has never been scrubbed is an unknown.
- Snapshots are cheap until the workload is write-heavy. Monitor pool free space and snapshot list the same way you monitor LVM snapshot data_percent.
- ARC pressure looks like “no free memory” while the system is fine. Confirm with arcstats before you buy RAM or kill ZFS.
- When moving a pool, export cleanly on the old host (`zpool export`). Force-import only when you are certain the other side is powered off.
- For databases, create the dataset with the right recordsize *before* you put data on it. Changing it later does not rewrite existing blocks.
- zvols for VMs add another layer. Snapshot the zvol, not just the guest filesystem, if you want a consistent block-level rollback.

## Related Notes

- [[LVM Deep Dive]]
- [[mdadm Operations]]
- [[RAID Concepts]]
- [[SMART and Disk Health]]
- [[Filesystems and Mounts]]
- [[Thin Provisioning and Snapshots]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A mirror that had been DEGRADED for three weeks lost the second disk during a scrub. The pool was unrecoverable. “DEGRADED” is a ticket with a due date, not a status you live with.
- ARC on a 64 GB database host filled memory and the OOM killer started choosing poorly. Setting a module parameter for zfs_arc_max and rebooting made the memory graph boring again.
- I rolled back a dataset to fix a bad deploy and discovered the application had written newer snapshots that the rollback destroyed. Now the change window includes “list snapshots, confirm which one is the known-good, then rollback”.
- A pool refused to import after a motherboard swap because the old host’s cache file still claimed it. `zpool import -f` after confirming the old machine was off solved it; guessing earlier would have been worse.
