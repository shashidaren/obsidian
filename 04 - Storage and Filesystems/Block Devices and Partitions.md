# Block Devices and Partitions

## Concept

Linux presents storage as block devices: whole disks, partitions, NVMe namespaces, virtio volumes, multipath maps, MD RAID, and LVM logical volumes. Everything that stores bytes — filesystems, swap, raw database devices — sits on this stack. You do not format, grow, or wipe anything until you can draw the stack for *this* host.

## Why it matters

- Device names (`sda`, `nvme0n1`, `xvd`) are not stable identities. The wrong name in `wipefs` or `dd` is a career event.
- Capacity tickets ("disk is 100%", "resize did nothing") are usually a missed layer: cloud volume grew, partition did not, or filesystem did not.
- Boot, initramfs, and fstab all key off UUID/PARTUUID/LABEL. Change the table without updating those and the next reboot is an emergency shell.

## Mental Model

```
Identity:   by-id / WWN / serial / cloud vol id     (stable)
Name:       /dev/sdX  /dev/nvmeXnY  /dev/vdX        (not stable)

Stack (walk this every time):

  Physical disk or cloud volume
        → partition table (GPT preferred; MBR legacy)
        → partition(s)  and/or  whole-disk PV
              → MD RAID / multipath (optional)
                    → LVM PV → VG → LV   (optional)
                          → filesystem or raw device
                                → mount point / swap
```

NVMe uses namespaces (`nvme0n1`) and partitions (`nvme0n1p1`). Virtio and Xen have their own names. Multipath hides several `/dev/sd*` paths behind one `/dev/mapper/mpath*`.

Always identify by UUID, PARTUUID, WWN, or `/dev/disk/by-id/`, never by `sdX` in fstab, scripts, or tickets.

## Key Commands

```bash
# Live stack
lsblk -f
lsblk -o NAME,SIZE,TYPE,FSTYPE,UUID,MOUNTPOINT,MODEL,SERIAL,WWN,TRAN
lsblk -t                    # topology / alignment hints
lsblk -s /dev/mapper/vg-data

# Stable names
ls -l /dev/disk/by-id/ /dev/disk/by-uuid/ /dev/disk/by-partuuid/
blkid

# Partition tables
fdisk -l
sfdisk -d /dev/nvme0n1      # dump (scriptable)
parted /dev/nvme0n1 print
gdisk -l /dev/nvme0n1       # GPT specifics, protective MBR

# Kernel + hardware
cat /proc/partitions
dmesg -T | grep -iE 'sd[a-z]|nvme|I/O error|offline'
smartctl -a /dev/sdX
nvme smart-log /dev/nvme0

# Who holds the device
lsblk -o NAME,MOUNTPOINT
lsof +f -- /dev/sdX1
dmsetup ls --tree

# After attaching a new volume (guest SCSI rescan)
echo "- - -" > /sys/class/scsi_host/host0/scan
# NVMe usually appears without this; virtio depends on the hypervisor
```

Grow sequence that people skip steps of:

1. Grow the cloud volume / physical LUN  
2. Rescan so the guest sees the new size (`lsblk`)  
3. Grow the partition (`growpart` / `parted resizepart`) if not whole-disk  
4. `pvresize` if LVM  
5. `lvextend`  
6. `resize2fs` or `xfs_growfs`  
7. Confirm with `lsblk` *and* `df -h`

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Device gone after reboot | Name shuffle, detach, failed path | `lsblk`, `dmesg`, by-id, cloud console |
| "Device or resource busy" | Mounted, LVM/MD member, qemu/db holding it | `lsblk`, `dmsetup ls`, `lsof` |
| Size wrong after "resize" | Stopped at volume or partition layer | Compare cloud size → `lsblk` → `df` |
| Emergency mode on boot | fstab UUID no longer exists | `blkid`, `/etc/fstab`, initramfs |
| I/O errors in dmesg | Dying disk, cable, controller, flaky path | SMART, multipath `-ll`, `dmesg` |
| Duplicate UUID after clone | Disk/VM cloned bit-for-bit | `blkid`; change UUID before dual-mount |
| Partition overlap / leftover table | Old MBR + new GPT, or stale RAID superblock | `wipefs -n /dev/X` (report only) first |
| Multipath "missing disk" | Using a single path `/dev/sdX` instead of mapper | `multipath -ll` |

## Investigation Tips

- Start every storage change with `lsblk -f` and a screenshot / paste into the ticket. That is your rollback map.
- `wipefs -n` is the non-destructive way to see leftover signatures. Omit `-n` only when you intend to erase them.
- Alignment: modern tools default to 1 MiB. Weird start sectors show up as poor I/O on some arrays; `lsblk -t` and `parted` alignment-check help.
- Cloud: map the console volume id to `by-id` (`nvme-Amazon_Elastic_Block_Store_vol...`, Azure/GCP equivalents). Do not guess `sdb` vs `sdc`.
- After partition edits on the boot disk, rebuild initramfs and confirm GRUB/kernel root= still points at a UUID.
- Keep a one-page stack diagram for each critical host (disk → part → vg → lv → fs → mount). The 3 a.m. you will thank the afternoon you.

## Related Notes

- [[lsblk]]
- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[mount and findmnt]]
- [[df and du Deep Dive]]
- [[RAID Concepts]]
- [[Disk I/O and Latency]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> I have watched a "quick wipe of the extra disk" hit `sdb` after a rescan reordered names. `lsblk -o NAME,SIZE,SERIAL,MODEL` would have shown it was the data disk. Serial first, command second.
>
> Cloud volume resized, ticket closed, `df` unchanged. The partition and XFS were never grown. Treat resize as a six-step checklist, not one console click.
