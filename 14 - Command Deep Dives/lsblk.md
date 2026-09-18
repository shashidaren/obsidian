# lsblk

## Concept

`lsblk` prints the block layer as a tree: physical disks, partitions, RAID, multipath, LVM, loop, and the filesystem sitting on top. It answers “what storage objects exist, how they stack, and where they are mounted?” without you assembling `fdisk`, `pvs`, and `df` by hand.

Device names (`sda`, `nvme0n1`, `dm-2`) are *labels of convenience*. They move after a bus rescan, a firmware change, or a cloud detach/attach. Identity is UUID, WWN, or serial.

## Why it matters

- Every destructive storage command (`mkfs`, `wipefs`, `dd`, `lvremove`, `parted`) needs a confirmed target
- “Disk disappeared” vs “disk is there but the VG is inactive” vs “partition is there but unmounted” are different incidents; the tree tells you which
- Cloud and SAN environments constantly remap names; `lsblk -o NAME,SIZE,SERIAL,WWN,UUID,MOUNTPOINT` is how you stay honest
- Capacity tickets start here: is `/data` even on the 2 TB volume you just bought?

If you skip `lsblk` and trust `/dev/sdb` from last week, you will eventually format the wrong disk.

## Mental Model

```
disk          TYPE=disk     (sda, nvme0n1, xvdf)
  partition   TYPE=part
    raid      TYPE=raid*
    mpath     TYPE=mpath    (/dev/mapper/mpathX)
    lvm       TYPE=lvm      (VG-LV)
      fs      FSTYPE + MOUNTPOINT
```

Read top-down to see what a disk became.  
Read bottom-up (`lsblk -s /dev/mapper/vg-data`) to see what a volume sits on.

Empty `MOUNTPOINT` means “exists, not in the namespace you asked about” — which may still be mounted in another mount namespace (container).

## Key Commands

```bash
# Default tree
lsblk

# The inspection line worth aliasing
lsblk -o NAME,SIZE,TYPE,FSTYPE,UUID,MOUNTPOINT,MODEL,SERIAL,WWN,TRAN

# Filesystem-oriented view
lsblk -f

# Inverse tree: physical disk under this LV
lsblk -s /dev/mapper/vg-data

# Disks only (no children)
lsblk -d -o NAME,SIZE,MODEL,SERIAL,TRAN,ROTA

# JSON for scripts
lsblk -J -o NAME,SIZE,TYPE,FSTYPE,UUID,MOUNTPOINT

# Bytes, no pretty units
lsblk -b -o NAME,SIZE,TYPE

# One device
lsblk -f /dev/nvme0n1
lsblk /dev/mapper/vg-root

# Include empty / kernel devices you usually hide
lsblk -a
```

`TRAN` is the transport (`sata`, `nvme`, `iscsi`, `usb`). `ROTA=0` is SSD/NVMe. Pair with `lsblk -t` when you care about alignment and scheduler.

## Common Failure Modes & Symptoms

| Situation | What lsblk shows | Next step |
|-----------|------------------|-----------|
| “Where did the disk go?” | Missing TYPE=disk | Cable/HBA/`dmesg`, multipath, cloud attach, SCSI rescan |
| About to `mkfs` | Confirm SIZE, SERIAL, FSTYPE empty or expected | Abort if FSTYPE or MOUNTPOINT is populated |
| LV missing | PV/part present, no `lvm` child | `pvs`/`vgs`/`lvs`, `vgchange -ay` |
| Mounted on the wrong path | MOUNTPOINT not what fstab claims | [[mount and findmnt]], UUID in fstab |
| Capacity “missing” | Disk SIZE ≠ sum of children | Leftover partition, unextended PV, thin pool metadata |
| Two names for one disk | `mpath` plus underlying `sd*` | Use the multipath node only |
| New cloud volume invisible | No new disk after attach | Rescan; virtio vs NVMe device name change |
| Looks mounted, `df` disagrees | Different mount namespace | `findmnt -T` on host *and* in container |

## Investigation Tips

- Alias something like `lsblk -o NAME,SIZE,TYPE,FSTYPE,UUID,MOUNTPOINT,SERIAL` on every jump host.
- After hot-add: `echo "- - -" > /sys/class/scsi_host/hostN/scan` for the right host, or the vendor equivalent. NVMe often just appears.
- Never put `/dev/sdX` in fstab or automation. UUID or `/dev/disk/by-id/…` only.
- On multipath, `lsblk` on the underlying path is how you accidentally wipe a live LUN. Operate on `/dev/mapper/mpath*`.
- `lsblk -s` plus `pvs -o+pv_used,pv_free` is the fastest “why can I not extend this LV?” pair.
- Loop devices (`/dev/loop*`) clutter the tree on systems that snap-pack packages. Filter with `-e 7` if they drown the signal.

## Related Notes

- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[mount and findmnt]]
- [[Filesystems and Mounts]]
- [[df and du Deep Dive]]
- [[RAID Concepts]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst page I was on started with `mkfs.xfs /dev/sdb` because last week `sdb` was the new empty disk. After a rescan it was the database. `lsblk -o NAME,SIZE,SERIAL,FSTYPE,MOUNTPOINT` takes five seconds and is cheaper than a restore.
- Cloud “I attached a 500 GB volume” tickets are usually “attached, not visible” or “visible, not mounted, not in fstab”. `lsblk` splits those in one look.
- Inverse tree (`-s`) is how I finally stopped guessing which physical disk a thin LV lived on during a disk replacement.
