# lsblk Deep Dive

## Concept

`lsblk` lists block devices and their hierarchy: disks, partitions, LVM logical volumes, md RAID, device-mapper targets, and the mount point (if any). It is the fastest way to answer “what is this filesystem sitting on?”

It reads sysfs and does not require the device to be mounted.

## Why it matters

- A full filesystem is often a full LVM thin pool, a full RAID member, or a full underlying disk — `df` alone does not show the stack.
- After a hot-add or multipath event, `lsblk` shows whether the kernel sees the new path or the new device.
- Mount options, UUID, and filesystem type are available in one command for the ticket.
- It is the starting point before you run `blkid`, `pvdisplay`, `mdadm`, or `multipath -ll`.

If you only run `df -h`, you will miss the layer that is actually full or failed.

## Mental Model

```
NAME   MAJ:MIN RM SIZE RO TYPE  MOUNTPOINT
sda      8:0    0  100G  0 disk
├─sda1   8:1    0    1G  0 part  /boot
└─sda2   8:2    0   99G  0 part
  └─luks 253:0    0   99G  0 crypt
    └─vg-root 253:1  0   50G  0 lvm   /
```

TYPE tells you the layer: `disk`, `part`, `lvm`, `crypt`, `md`, `mpath`, `rom`. The tree shows parentage. `RO` = 1 means read-only (snapshot, protection, or failure).

## Key Commands

```bash
# Everyday view
lsblk
lsblk -f          # FSTYPE, UUID, LABEL, MOUNTPOINT
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID

# Wider, with model and serial (useful for inventory)
lsblk -o NAME,SIZE,TYPE,MODEL,SERIAL,MOUNTPOINT

# Specific device
lsblk /dev/sda
lsblk -f /dev/mapper/vg-root

# Show holders (who is using this device)
lsblk -s /dev/sda2

# JSON for scripts
lsblk -J
```

Pair with:

```bash
blkid
findmnt
df -hT
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Device missing after hot-add | Not rescanned, or multipath not updated | `lsblk`, `echo 1 > /sys/class/block/sdX/device/rescan` |
| Filesystem full, underlying thin pool full | Thin provisioning | `lsblk`, `lvs -o+data_percent` |
| Mount point empty in `lsblk -f` | Not mounted, or different namespace | `findmnt`, `mount` |
| TYPE `mpath` or `dm-` unexpected | Multipath or encryption | `multipath -ll`, `lsblk -f` |
| Size smaller than expected | Partition table, LVM, or snapshot | Tree view, `pvs`/`lvs` |
| `RO` flag set | Snapshot, protection, or hardware | `lsblk`, `blockdev --getro` |

## Investigation Tips

- Start with `lsblk -f` on any storage ticket. The tree is the map.
- UUID and LABEL survive renames; device names (`sda` vs `sdb`) do not. Prefer UUID in fstab.
- In a container, `lsblk` may see only the devices the runtime passed in. Host and guest views differ.
- After adding a disk, if it does not appear, rescan the bus before you declare the hardware dead.
- `lsblk` does not show filesystem free space. That is `df`. It shows the block-device stack.

## Related Notes

- [[Filesystems and Mounts]]
- [[LVM Deep Dive]]
- [[LUKS and Disk Encryption]]
- [[mdadm Operations]]
- [[Device Mapper Multipath]]
- [[df and du Deep Dive]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “disk full” was a thin pool at 100% while the filesystem still had space reported by an old `df` cache. `lsblk` + `lvs` showed the real constraint.
- After a multipath failover, one path disappeared from `lsblk`. The application kept running because the other path was healthy; the missing path was the early warning.
- I now paste `lsblk -f` into every storage ticket before I paste `df`.
