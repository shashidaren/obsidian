# LVM Deep Dive

## Concept

**LVM** (Logical Volume Manager) adds a flexible layer between physical disks and filesystems:

```
Physical Volumes (PVs)  →  Volume Group (VG)  →  Logical Volumes (LVs)  →  Filesystem
```

This lets you resize, snapshot, and move storage more easily than with plain partitions.

## Why it matters

Most production Linux servers use LVM.  
Resizing a filesystem almost always involves the LV underneath it.  
Mistakes in LVM operations can lead to data loss, so a clear mental model is essential.

## Mental Model

```
Disk / Partition
└── Physical Volume (PV)
    └── Volume Group (VG)          ← pool of storage
        ├── Logical Volume 1 (LV)  ← appears as /dev/vgname/lvname
        ├── Logical Volume 2
        └── Free space in VG
```

The filesystem sits on top of the LV.  
You normally extend the LV first, then grow the filesystem.

## Key Commands

```bash
# Overview
pvs
vgs
lvs

# Detailed view
pvdisplay
vgdisplay
lvdisplay

# What is mounted where
lsblk
df -hT

# Free space in a volume group
vgdisplay <vgname> | grep Free
```

### Common safe operations

```bash
# Extend an LV (add 10G from free space in the VG)
lvextend -L +10G /dev/<vg>/<lv>

# Extend LV to use all remaining free space
lvextend -l +100%FREE /dev/<vg>/<lv>

# Then grow the filesystem (example for XFS and ext4)
xfs_growfs /mountpoint          # XFS
resize2fs /dev/<vg>/<lv>        # ext4
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Cannot extend LV                     | No free space in VG                       | `vgs`, `vgdisplay`               |
| Filesystem still full after lvextend | Forgot to grow the filesystem             | `df -h`, run xfs_growfs/resize2fs|
| LV not visible after reboot          | Activation issue                          | `lvscan`, `vgchange -ay`         |
| “Device is busy” when reducing       | Filesystem or mounts still using it       | `lsof`, `fuser`, unmount first   |

## Investigation Tips

- Always check `pvs / vgs / lvs` together.
- Never shrink an LV without shrinking the filesystem first (and having a backup).
- Snapshots are useful but consume space from the VG — monitor them.
- On cloud VMs the physical disk may need to be expanded at the provider level before the PV can be grown.

## Related Notes

- [[Block Devices and Partitions]]
- [[Filesystems and Mounts]]
- [[XFS Operations]]
- [[ext4 Operations]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
