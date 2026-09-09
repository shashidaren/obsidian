# LVM Deep Dive

## Concept

LVM sits between raw disks and filesystems. Physical volumes (PVs) are pooled into a volume group (VG). Logical volumes (LVs) are carved from that pool and presented as block devices (`/dev/<vg>/<lv>` or `/dev/mapper/<vg>-<lv>`). Filesystems, swap, and raw database devices live on LVs.

The point of LVM is not cleverness. It is resize, snapshot, and move operations without re-partitioning the disk.

## Why it matters

- Almost every RHEL-family and many Ubuntu servers you inherit are LVM-rooted. Disk-full tickets end in `lvextend` + `xfs_growfs` / `resize2fs`.
- Cloud “we grew the disk” is incomplete until the PV, VG, LV, *and* filesystem all grow. Operators stop after the first of those four steps constantly.
- Shrinking, converting, or deleting the wrong LV is one of the few storage commands that can destroy data in seconds.
- Snapshots look free until they fill the VG and freeze or corrupt the origin LV.

Treat LVM as a ledger: every byte lives in exactly one place (free VG space, an LV, or a snapshot). If the ledger does not add up, stop and look before you write.

## Mental Model

```
Cloud/hardware disk     (provider size)
  └── partition / whole disk
        └── PV            pvcreate / pvdisplay
              └── VG      pool of extents (PE, usually 4 MiB)
                    ├── LV  /dev/vg/root     → filesystem
                    ├── LV  /dev/vg/var
                    ├── snapshot LV (COW against an origin)
                    └── FREE extents         ← this is what lvextend spends
```

Rules that prevent most disasters:

- Grow: disk → PV → VG → LV → filesystem (in that order).
- Shrink: filesystem first, then LV. Never the other way. Have a backup.
- `lvextend -r` / `lvresize -r` can grow the filesystem in one shot. Prefer explicit two-step until you trust the environment.
- Thin pools and cache LVs are extra failure domains. Do not invent them on a box that only needed a bigger `/var`.

Activation: LVs are not visible until the VG is active (`vgchange -ay`). After a restore, a new SAN LUN, or a cloned VM, “the disk is there but `/dev/mapper` is empty” is an activation problem, not a missing volume.

## Key Commands

```bash
# Picture of the stack
pvs; vgs; lvs
lsblk -f
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID
pvdisplay -C; vgdisplay -C; lvdisplay -C

# Free space that actually matters
vgs -o vg_name,vg_size,vg_free,vg_extent_size
lvs -o lv_name,vg_name,lv_size,lv_attr,origin,data_percent

# After the cloud disk grew: make LVM see the new bytes
# (whole-disk PV)
echo 1 > /sys/class/block/sda/device/rescan   # device name varies; virtio/nvme differ
pvresize /dev/sda                             # or /dev/sda2 if partitioned
vgs                                           # VG free should increase

# Grow an LV, then the filesystem
lvextend -L +20G /dev/vg00/var
lvextend -l +100%FREE /dev/vg00/var           # spend all remaining VG free
xfs_growfs /var                               # XFS: grow by mountpoint
resize2fs /dev/vg00/var                       # ext4: grow by device or mount

# Combined grow (review first)
lvextend -r -L +20G /dev/vg00/var

# Add a new disk into the pool
pvcreate /dev/sdb
vgextend vg00 /dev/sdb

# Snapshots (classic thick)
lvcreate -L 10G -s -n var_snap /dev/vg00/var
lvs -a
# merge or drop when done; they consume VG space as origin writes continue
lvremove /dev/vg00/var_snap

# Activation after clone / restore / new host
vgscan
vgchange -ay
lvscan

# Reduce (dangerous). Filesystem shrink FIRST.
# ext4 only for practical shrink; XFS does not shrink.
umount /mnt/data
e2fsck -f /dev/vg00/data
resize2fs /dev/vg00/data 50G
lvreduce -L 50G /dev/vg00/data
```

Attributes in `lvs` (`lv_attr`) tell you state: `o` origin, `s` snapshot, `t` thin, `-wi-ao----` is a normal open written-to LV. Learn to glance at that column.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `lvextend` “insufficient free space” | VG is full even if the VM disk grew | `pvs` / `vgs`; did you `pvresize`? |
| `df` still 100% after `lvextend` | Filesystem not grown | `lsblk`, `xfs_info` / `tune2fs -l`, then growfs |
| New cloud disk size not in `pvs` | Hypervisor grew disk; guest PV not resized | Rescan SCSI/virtio; `pvresize` |
| `/dev/mapper` empty after reboot or clone | VG not activated; PV filter; duplicate VG UUID | `vgscan`, `vgchange -ay`, `dmesg` |
| Snapshot LV 100% `data_percent` | COW overflow; origin can go read-only or I/O error | Drop or merge snapshot; never leave them “for later” |
| `device-mapper: remove ioctl failed: Device or resource busy` | Still mounted or held open | `lsblk`, `findmnt`, `lsof`, `dmsetup info` |
| Boot to emergency shell, root LV missing | initramfs missing LVM hooks or wrong VG name | `rd.lvm.vg=`, `ls /dev/mapper` in emergency |
| Thin pool `data` or `metadata` full | Thin provisioning overcommit caught up | `lvs -a`; extend thin pool *immediately* |
| Two hosts see the same VG | Shared disk / cloned image, split-brain risk | Never activate RW on two nodes without a cluster |

## Investigation Tips

- Always print `pvs`, `vgs`, `lvs`, and `lsblk -f` before you type a write command. Confirm the *name* of the LV you are about to change.
- Cloud order of operations: provider disk → guest sees new size (`lsblk`) → `pvresize` → `vgs` free grows → `lvextend` → filesystem grow → `df` agrees.
- Root-on-LVM plus a full `/` is recoverable from a live image or emergency shell. Practise `vgchange -ay` and `xfs_growfs /` once on a lab box.
- Snapshots are for short, planned work (backup freeze, package test). They are not a backup strategy. Monitor `data_percent`.
- `filter` in `/etc/lvm/lvm.conf` can hide multipath parents or duplicate PVs. If a PV “vanishes”, read the filter before you `pvcreate` anything.
- Cloning VMs duplicates VG/LV UUIDs. `vgimportclone` / `vgchange -u` exists for a reason. Activating two clones on the same SAN fabric is how you corrupt both.
- Reducing XFS is not a thing. If `/var` is XFS and too big, add a new LV and migrate data. Do not look for a shrink flag.
- Record the exact commands in the change ticket. The next disk-full at 02:00 will be the same VG with a different name.

## Related Notes

- [[Block Devices and Partitions]]
- [[Filesystems and Mounts]]
- [[XFS Operations]]
- [[ext4 Operations]]
- [[Disk Full Runbook]]
- [[df and du Deep Dive]]
- [[lsblk]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once grew a cloud volume, confirmed `lsblk` showed the new size, and closed the ticket. `df` was unchanged. The PV had not been `pvresize`d. Four-step checklist now lives in the runbook: disk, PV, LV, filesystem.
- A “temporary” LVM snapshot left on a database VG filled during a batch job. The origin went I/O error. Snapshots need an owner, a size that can absorb the write rate, and a destroy-by date.
- `lvextend -l +100%FREE` on the wrong LV silently spent every spare extent the host had. The next service that needed a grow had to wait for a new disk. Name the LV out loud before you hit enter.
- A cloned template brought two hosts up with the same VG UUID on shared storage. Both activated. That is not an LVM bug; that is an inventory bug. Treat cloned images as radioactive until UUIDs are unique.
