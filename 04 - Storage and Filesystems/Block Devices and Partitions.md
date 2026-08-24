# Block Devices and Partitions

## Concept

Linux presents storage as block devices (`/dev/sdX`, `/dev/nvmeXnY`, `/dev/vdX`, multipath devices, etc.). These may be whole disks, partitions, RAID members, LVM physical volumes, or already-formatted filesystems. Understanding the stack is mandatory before any resize, wipe, or migration.

## Why it matters

- Almost every storage incident starts with “which device is this?” and “what sits on top of it?”
- Wrong device in a command can destroy data
- Partition tables, alignment, and device naming (`sd` vs `nvme` vs by-id) affect every higher layer (LVM, filesystem, mounts)

## Mental Model

```
Physical disk / cloud volume
        ↓
Partition table (GPT / MBR) or whole-disk use
        ↓
Partitions or MD RAID / multipath
        ↓
LVM PV → VG → LV   (optional)
        ↓
Filesystem (ext4, XFS, …) or raw use (DB, etc.)
        ↓
Mount point
```

Always walk the stack from bottom to top (or top to bottom) before changing anything.

## Key Commands

```bash
# Overview of block devices
lsblk -f
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID,MODEL

# More detail / topology
lsblk -t
lsblk -p

# Kernel view and by-id links (preferred for scripts)
ls -l /dev/disk/by-id/
ls -l /dev/disk/by-uuid/
cat /proc/partitions

# Partition tables
fdisk -l
gdisk -l /dev/sdX
parted /dev/sdX print

# SMART / health (when available)
smartctl -a /dev/sdX
nvme smart-log /dev/nvme0

# Who is using a device
lsof +f -- /dev/sdX1
fuser -vm /dev/sdX1
```

Prefer `/dev/disk/by-id/` or UUID/LABEL in configs and scripts — `/dev/sdX` names can change across reboots.

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                              |
|--------------------------------------|-------------------------------------------|-------------------------------------------|
| Device missing after reboot          | Naming change, cable, cloud detach        | `lsblk`, `dmesg`, cloud console           |
| “Device or resource busy”            | Mounted, held by LVM/MD, or process open  | `lsblk`, `lsof`, `dmsetup ls`             |
| Wrong size after resize              | Partition not grown, or FS not grown      | `lsblk`, `parted`, then `resize2fs`/`xfs_growfs` |
| Boot failure after partition change  | UUID/LABEL changed, initramfs stale       | `blkid`, GRUB, initramfs                  |
| I/O errors in dmesg                  | Failing disk, cable, controller           | `smartctl`, `dmesg -T \| grep -i error`   |
| Duplicate UUID after clone           | Cloned disk/volume without unique UUID    | `blkid`, change UUID before mounting both |

## Investigation Tips

- Start with `lsblk -f`. It shows the live stack in one view.
- Before any destructive command (`fdisk`, `wipefs`, `dd`, `pvcreate`) re-confirm the device with size, model, and existing filesystem/UUID.
- Cloud volumes often appear as `/dev/nvme*` or `/dev/xvd*`; always map from the cloud console ID to the guest device.
- After partition or size changes, remember both the partition table *and* the filesystem must be updated.
- Keep a record of the storage stack for critical hosts (disk → partition → LVM → FS → mount).

## Related Notes

- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[df and du Deep Dive]]
- [[RAID Concepts]]
- [[Disk I/O and Latency]]
- [[lsblk]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
