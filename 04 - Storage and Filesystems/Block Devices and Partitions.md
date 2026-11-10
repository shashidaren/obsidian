# Block Devices and Partitions

## Concept

Block devices are the kernel’s abstraction for disks, SSDs, NVMe namespaces, multipath devices, and loop devices. Partitions are slices of a block device described by a partition table (GPT or MBR). The kernel creates `/dev/sdX`, `/dev/nvmeXnY`, `/dev/mapper/...` nodes and the corresponding `/sys/block` entries.

Naming is not stable across reboots or hardware changes. Use `/dev/disk/by-id`, `by-path`, `by-uuid`, or LVM/device-mapper names.

## Why it matters

- Wrong device identification is the fastest way to destroy data.
- Multipath, NVMe namespaces, and cloud volumes all change how the “disk” appears.
- Partition alignment, 4K sectors, and residual GPT/MBR signatures cause mount and LVM surprises.

## Mental Model

```
physical/virtual disk or namespace
  → kernel block device (/dev/nvme0n1, /dev/sda, /dev/mapper/mpatha)
      → partition table (GPT)
          → partitions (/dev/nvme0n1p1)
              → LVM PV / filesystem / raw
```

`lsblk` shows the tree. `blkid` shows filesystem and partition UUIDs.

## Key Commands

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID,MODEL,SERIAL,TRAN
blkid
cat /proc/partitions

# Partition table
sgdisk -p /dev/nvme0n1
# or
parted /dev/nvme0n1 print

# Wipe signatures (destructive — confirm serial first)
# wipefs -a /dev/nvme0n1p1

# Rescan after hot-add
echo 1 > /sys/class/block/sda/device/rescan   # SCSI
# NVMe: usually appears automatically; otherwise nvme or PCI rescan
```

See [[lsblk Deep Dive]], [[NVMe Operations]], [[Device Mapper Multipath]].

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Device name changed after reboot | Enumeration order | by-id / by-path, fstab UUID |
| “wrong fs type” or mount fails | Stale partition table, wrong device | `blkid`, `lsblk -f`, dmesg |
| LVM sees duplicate PVs | Multipath + raw path both visible | `multipath -ll`, filter in lvm.conf |
| Disk “missing” after hot-add | No rescan, missing driver | `dmesg`, rescan, `lsblk` |
| Alignment warnings, slow 4K | Partition not 1 MiB aligned | `parted align-check`, recreate if possible |
| Cloud volume not appearing | Attachment delay, wrong instance | hypervisor console, `lsblk`, udev |

## Investigation Tips

- Always identify by serial or WWN before any write. `lsblk -o NAME,SERIAL,MODEL` or `nvme list`.
- `lsblk -f` + `blkid` is the minimum paste for storage tickets.
- If both `/dev/sda` and `/dev/mapper/mpatha` exist, you are probably seeing the raw path and the multipath device. Use only the multipath device.
- After replacing a disk, check that the old GPT signature is gone (`wipefs`) before creating a new PV or filesystem.
- fstab should use UUID= or LABEL=, never `/dev/sdX`.

## Related Notes

- [[lsblk Deep Dive]]
- [[NVMe Operations]]
- [[Device Mapper Multipath]]
- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[fstab and Mount Options]]
- [[SMART and Disk Health]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A rescue environment mounted the wrong multipath member and fsck’d it. The array was degraded for the rest of the weekend. `multipath -ll` and “only touch /dev/mapper” is now a hard rule in runbooks.
- An fstab entry with `/dev/sdb1` survived a disk replacement that reordered devices. The host booted into emergency mode. UUID conversion took five minutes once we were in the rescue shell.
