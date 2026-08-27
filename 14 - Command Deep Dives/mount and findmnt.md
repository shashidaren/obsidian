# mount and findmnt

## Concept

`mount` attaches a filesystem to a directory in the tree. `findmnt` (from util-linux) shows what is currently mounted, from where, with which options, in a clear tree or table. Together they are the primary tools for understanding and managing the mount namespace.

## Why it matters

- “Disk full” on one path may be a different filesystem than you think
- Boot failures and service start failures are often bad `/etc/fstab` or missing mounts
- NFS/CIFS hangs, read-only filesystems, and bind mounts are diagnosed here first
- Before editing fstab or unmounting anything, you must know the real mount table

## Mental Model

```
Source (block device, UUID, network share, tmpfs…)
    → mount(2)
        → target directory in the VFS tree
            → options (rw/ro, noexec, _netdev, …)

findmnt reads the kernel mount table (and can compare to /etc/fstab).
mount both displays and performs mounts; prefer findmnt for inspection.
```

Persistent mounts live in `/etc/fstab` (or systemd `.mount` units). Runtime mounts disappear on reboot unless recorded.

## Key Commands

```bash
# Current mounts — prefer findmnt
findmnt
findmnt -D                    # df-like view with sources
findmnt /var                  # what is mounted at /var (or parent)
findmnt -T /var/log           # target path lookup
findmnt -S /dev/sda1          # by source
findmnt -t xfs,ext4           # by type
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS

# Compare kernel mounts to fstab
findmnt --verify
findmnt --fstab

# Classic mount listing
mount | column -t
cat /proc/mounts

# Mount by UUID or LABEL (preferred in fstab)
mount UUID=... /mnt/data
mount LABEL=backup /mnt/backup

mount -a                      # mount all in fstab (skips noauto)
mount -o remount,ro /
mount -o remount,rw /

# Unmount
umount /mnt/data
umount -l /mnt/data           # lazy (detach now, cleanup when busy ends)
umount -f /mnt/nfs            # force (use carefully, especially NFS)

# Bind and rbind
mount --bind /src /dst
mount --rbind /src /dst
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                                      |
|--------------------------------------|-------------------------------------------|---------------------------------------------------|
| Mount point empty / wrong data       | Not mounted, or wrong device mounted      | `findmnt /path`, `lsblk -f`                       |
| “Target is busy” on umount           | Open files, cwd, or nested mounts         | `lsof +f -- /path`, `findmnt -R /path`            |
| Boot hangs or emergency mode         | Bad fstab entry (wrong UUID, missing net) | `findmnt --verify`, comment out, `systemd-analyze`|
| NFS/CIFS mount hangs                 | Network, server, or credentials           | `_netdev` in fstab, soft/hard options, see NFS note |
| Filesystem suddenly read-only        | Journal error, remount-ro on error        | `dmesg`, `findmnt -o OPTIONS`, fsck planning      |
| Space full on `/` but `df` shows free elsewhere | Path is on root, not the big data mount | `findmnt -T /path`, `df -h /path`                 |

## Investigation Tips

- Always use `findmnt -T <path>` when diagnosing “which filesystem is this directory on?”
- For fstab changes: `findmnt --verify` then `mount -a` before rebooting.
- Prefer UUID or LABEL in fstab over `/dev/sdX` names.
- Lazy unmount (`-l`) is safer when a mount is stuck; force (`-f`) can cause data loss on network filesystems.
- systemd mount units and `RequiresMountsFor=` matter for service ordering — a unit can be “active” while its data directory is not yet mounted.
- Bind mounts and mount namespaces (containers) mean the same path can look different from host vs container.

## Related Notes

- [[Filesystems and Mounts]]
- [[lsblk]]
- [[Block Devices and Partitions]]
- [[df and du Deep Dive]]
- [[NFS Troubleshooting]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
