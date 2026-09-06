# ext4 Operations

## Concept

ext4 is the default on Debian/Ubuntu and still common on older RHEL-family hosts. It is a journaling filesystem with a relatively fixed inode table (chosen at `mkfs` time) and first-class offline `fsck`.

Unlike XFS, ext4 *can* shrink, but only with the filesystem unmounted and after `resize2fs` has already shrunk the FS *before* you shrink the LV. That order is easy to reverse and expensive to undo.

## Why it matters

- `resize2fs` targets the *device*, `xfs_growfs` targets the *mount point* — mixing the two is a weekly ticket
- Inode count is largely decided at format. A 50G volume that will hold 20 million session files needs a different `-i` / `-N` than a VM image store
- `fsck` on a multi-terabyte ext4 is a maintenance window, not a quick reboot option
- `errors=remount-ro` (common default) turns a metadata problem into a sudden read-only root — apps fail in confusing ways

## Mental Model

```
mkfs.ext4 decides:
  block size, inode ratio, journal size, features (64bit, metadata_csum, ...)

runtime:
  journal → metadata (and optionally data=journal)
  inode table is mostly static
  resize2fs grows or shrinks the *filesystem* on the block device
```

Grow (online, if the kernel supports it — it does on modern distros):

```
lvextend -L +10G /dev/vg/lv
resize2fs /dev/vg/lv          # device node, not mount point
```

Shrink (offline only):

```
umount /data
e2fsck -f /dev/vg/lv
resize2fs /dev/vg/lv 80G      # new *smaller* FS size first
lvreduce -L 80G /dev/vg/lv    # then the LV
mount /data
```

Get that order wrong and you cut the LV out from under live metadata.

## Key Commands

```bash
# Identify
findmnt -no FSTYPE,SOURCE,OPTIONS /
tune2fs -l /dev/sda2 | egrep 'Filesystem volume|Inode count|Free inodes|Block count|Filesystem features|Last mounted'

# Space
df -hT /
df -i /

# Grow after LV/disk expansion
lvextend -l +100%FREE /dev/vg/root
resize2fs /dev/vg/root

# Check / repair — unmounted, or force a check at next boot for root
e2fsck -n /dev/vg/data                 # read-only check
e2fsck -f /dev/vg/data                 # force
# Root: tune2fs -C 1 -c 1 /dev/sdX && reboot   # last resort style; prefer rescue

# Reserved blocks (default 5% for root-reserved)
tune2fs -l /dev/sda2 | grep 'Reserved'
tune2fs -m 1 /dev/sda2                 # drop reserved to 1% on a big data disk

# Labels and UUIDs — what fstab should use
blkid /dev/vg/data
tune2fs -U random /dev/vg/data         # only with a plan to update fstab

# Create with more inodes (example: lots of small files)
mkfs.ext4 -i 4096 /dev/vg/sessions
```

`debugfs` can inspect a live or offline FS. Treat write-mode `debugfs` as surgery.

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks |
|---------|---------------|--------------|
| `df` full after `lvextend` | Forgot `resize2fs` | `tune2fs -l` block count vs `lsblk` |
| `resize2fs: Bad magic` | Not ext4, or wrong device | `blkid`, `findmnt` |
| Read-only mount out of nowhere | Journal / metadata error, `errors=remount-ro` | `dmesg`, `mount` options |
| `No space left` with free GiB | Inode exhaustion or reserved blocks | `df -i`, `tune2fs -l` reserved |
| Boot drops to emergency shell | Root fsck failed | journal from previous boot, `fsck` in rescue |
| Shrink made the VG sad | `lvreduce` before `resize2fs` | Restore from backup; do not guess |
| Painfully slow `fsck` | Multi-TB volume, no maintenance window | Plan offline; consider XFS for new big volumes |

## Investigation Tips

- Always pair `df -h` with `df -i` on ext4. The inode table does not grow like XFS.
- 5% reserved on a 2T data disk is 100G the app cannot use. That is intentional on `/` (so root can still write logs); it is usually wrong on `/data`.
- `mount -o remount,rw` on a volume the kernel remounted ro hides the cause. Read `dmesg` first.
- For root filesystem growth on LVM: grow is online. For root *repair*, use a rescue image. Do not `e2fsck` a mounted root and hope.
- Feature flags matter when you move disks between old kernels (`metadata_csum`, `64bit`). `tune2fs -l` before you attach an old volume to a new AMI.

## Related Notes

- [[XFS Operations]]
- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[Block Devices and Partitions]]
- [[Inodes]]
- [[df and du Deep Dive]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Ubuntu AMIs that look “full” at 95% on a 30G root are often just reserved blocks plus journal plus `/var/log`. Check `tune2fs` reserved before you panic-extend.
- I once `lvreduce`d first on a “simple shrink”. `resize2fs` then refused, and repair could not invent the blocks I had already given back to the VG. Backup, then shrink FS, then LV.
- Session stores on ext4 formatted with default inode ratio die at ~20% disk used. `df -i` is the first command, not `du`.
