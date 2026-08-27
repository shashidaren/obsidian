# lsblk

## Concept

`lsblk` lists block devices in a tree: disks, partitions, LVM volumes, RAID, multipath, and loop devices. It shows the relationship between physical devices and the layers built on top of them.

## Why it matters

- Before any disk, partition, LVM, or filesystem work you must know what is actually present
- Prevents operating on the wrong device (the classic disaster)
- Quickly answers: which disk is this LVM volume on? Is this partition mounted? What is the model/serial?
- Essential when troubleshooting missing volumes, wrong mount points, or capacity issues

Never assume device names (`sda`, `nvme0n1`) are stable across reboots — always confirm with `lsblk` (and preferably by UUID/WWN).

## Mental Model

```
Physical disk
  └── partition(s)
        └── LVM PV → VG → LV
              └── filesystem (mounted or not)

Or: disk → RAID → partition → filesystem
Or: multipath device → partition → LVM → filesystem
```

`lsblk` walks this stack and prints it as a tree. Columns tell you size, type, mountpoint, and (with flags) UUID, model, and filesystem type.

## Key Commands

```bash
# Default tree view
lsblk

# Full detail: filesystem type, UUID, mountpoint, model
lsblk -f
lsblk -o NAME,SIZE,TYPE,FSTYPE,UUID,MOUNTPOINT,MODEL,SERIAL

# Include empty slots / all devices
lsblk -a

# JSON (great for scripts)
lsblk -J

# Only disks (no partitions)
lsblk -d

# Specific device
lsblk /dev/sda
lsblk -f /dev/mapper/vg-root

# Show dependency tree for one device
lsblk -s /dev/mapper/vg-data   # inverse tree (who depends on this)

# Sizes in bytes (scripting)
lsblk -b -o NAME,SIZE,TYPE
```

Useful columns: `NAME`, `SIZE`, `TYPE`, `FSTYPE`, `UUID`, `MOUNTPOINT`, `MODEL`, `SERIAL`, `WWN`, `TRAN` (transport: sata, nvme, iscsi…).

## Common Failure Modes & Symptoms

| Situation                            | What lsblk shows / helps with              | Next step                                      |
|--------------------------------------|--------------------------------------------|------------------------------------------------|
| “Where did my disk go?”              | Missing from tree, or TYPE=disk but no children | Check cables, HBA, multipath, `dmesg`          |
| Wrong disk targeted for wipe/format  | Confirm SIZE, MODEL, SERIAL, existing FSTYPE | Always double-check before `mkfs` / `dd`       |
| LVM volume not visible               | PV present but LV missing, or VG inactive  | `pvs`/`vgs`/`lvs`, `vgchange -ay`              |
| Mounted but not what you expected    | MOUNTPOINT column vs `/proc/mounts`        | See [[mount and findmnt]]                      |
| Capacity mismatch                    | SIZE of disk vs sum of partitions/LVs      | Alignment, residual partitions, thin pools     |
| Cloud/VM disk added but not seen     | No new device after attach                 | Rescan SCSI bus, check hypervisor attachment   |

## Investigation Tips

- Prefer identifying devices by UUID, WWN, or serial rather than by `sdX` name.
- After hot-adding a disk, you may need a SCSI rescan before it appears:  
  `echo "- - -" > /sys/class/scsi_host/host*/scan` (or the specific host).
- Combine with `lsblk -f` and `blkid` when building or debugging `/etc/fstab`.
- On multipath systems, look at the multipath device (`mpathX` or `/dev/mapper/...`), not the underlying paths.
- `lsblk -s` (inverse) is useful when you have an LV or mapper name and need to find the physical disk underneath.

## Related Notes

- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[mount and findmnt]]
- [[Filesystems and Mounts]]
- [[df and du Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
