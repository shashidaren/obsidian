# mount and findmnt

## Concept

`mount` attaches a filesystem to a directory in the VFS tree. `findmnt` (util-linux) is the inspection tool: it reads the kernel mount table and can compare it to `/etc/fstab`. Use `findmnt` to *see*; use `mount`/`umount` (or a systemd `.mount` unit) to *change*.

A path is not a disk. The same directory name can sit on root, on a bind mount, on NFS, or on a container mount namespace. `findmnt -T <path>` is how you stop guessing.

## Why it matters

- “Disk full” on `/var/lib` is a different problem if `/var` is its own filesystem
- Emergency mode after reboot is often one bad fstab line
- NFS/CIFS hangs, remount-ro events, and bind-mount surprises all show up here first
- Services can be “active” while the directory they write to is still the empty mount point on root

Never edit fstab and reboot to “see if it works”. Verify first.

## Mental Model

```
Source  (block dev, UUID, LABEL, NFS, tmpfs, overlay)
    → mount(2) + options (rw/ro, noexec, _netdev, defaults)
        → target directory (must already exist)
            → visible in this mount namespace

Persistence:
  /etc/fstab          → mount -a / systemd-fstab-generator
  *.mount units       → After=/Requires= ordering with services
  runtime-only mounts → gone at reboot
```

`findmnt` without arguments prints the tree for the current namespace. Inside a container that tree is not the host’s.

Trailing detail that bites: bind mounts hide whatever was in the target directory. The files are not deleted; they are shadowed until umount.

## Key Commands

```bash
# Inspection — prefer findmnt over parsing mount(8) output
findmnt
findmnt -D                          # df-like: source, size, used
findmnt -T /var/log                 # which mount owns this path?
findmnt -S /dev/sda1                # by source
findmnt -t xfs,ext4,nfs4
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS,AVAIL,USED
findmnt -R /mnt                     # recursive under a point (nested binds)

# Kernel table vs fstab
findmnt --fstab
findmnt --verify                    # catch bad UUIDs / missing targets before reboot

# Raw / classic
cat /proc/self/mountinfo            # namespace-accurate, richest kernel view
cat /proc/mounts
mount | column -t

# Mount by stable identifier (use these in fstab)
mount UUID=xxxxxxxx /mnt/data
mount LABEL=backup /mnt/backup
lsblk -f                            # UUID / LABEL / FSTYPE map

mount -a                            # all fstab entries except noauto
mount -o remount,ro /
mount -o remount,rw /
mount -o remount,noatime /var

# Unmount
umount /mnt/data
umount -l /mnt/data                 # lazy: detach now, release when last user leaves
umount -R /mnt                      # recursive (nested binds)
# umount -f                         # force; last resort on dead NFS, can lose writes

# Bind / rbind / move
mount --bind /src /dst
mount --rbind /src /dst             # include nested mounts under /src
mount --make-rprivate /dst          # stop propagation surprises (containers)
mount --move /old /new
```

Minimal fstab line worth copying:

```
UUID=...  /data  xfs  defaults,nofail,_netdev  0  2
```

`nofail` lets boot continue if the volume is missing. `_netdev` waits for the network. Neither is a substitute for a correct unit dependency.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Mount point empty / unexpected files | Not mounted, or bind shadowing the real tree | `findmnt -T /path`, `lsblk -f` |
| `target is busy` on umount | cwd, open FD, or nested mount | `lsof +f -- /path`, `findmnt -R /path`, `fuser -vm /path` |
| Emergency / rescue after reboot | Bad UUID, missing device, NFS without `_netdev` | `findmnt --verify`, comment the line, `journalctl -b -u initrd-fs` |
| NFS/CIFS mount hangs the shell | Hard mount + dead server | another tty; `umount -l`; see NFS note |
| Filesystem remounted read-only | Journal / barrier error | `dmesg`, `findmnt -o OPTIONS /path`, plan fsck |
| `/` full, data volume shows free | Path is still on root | `findmnt -T /var/lib/app`, `df -h /var/lib/app` |
| Service writes vanished on reboot | Wrote into empty mount point before unit mounted | `RequiresMountsFor=`, `.mount` Before= the service |
| Options you set are missing | fstab `defaults` overrode a remount, or helper ignored flags | `findmnt -o OPTIONS`; remount explicitly |

## Investigation Tips

- `findmnt -T` then `df -h` on that exact path. Do not `df` the parent and assume.
- After any fstab edit: `findmnt --verify && mount -a && findmnt` before you leave the session, let alone reboot.
- Prefer UUID or LABEL. `/dev/sdX` and `/dev/nvme0n1p2` reorder.
- Lazy unmount is the safe “get this path out of the tree” move. Force unmount on a network FS can discard uncommitted writes.
- systemd: `systemctl status mnt-data.mount` and `systemctl list-dependencies --after <service>` tell you whether the app waited for the volume.
- `mountinfo` fields include the mount ID and parent ID — that is how you see bind stacks and propagation.
- In containers, check mounts from the host with `nsenter -t <pid> -m findmnt` when the in-container view is incomplete.

## Related Notes

- [[Filesystems and Mounts]]
- [[lsblk]]
- [[Block Devices and Partitions]]
- [[df and du Deep Dive]]
- [[NFS Troubleshooting]]
- [[Disk Full Runbook]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An app “lost” a week of uploads because the NFS unit came up *after* the service. The process wrote into the empty local directory on root, filled `/`, and the real share mounted over the evidence. `RequiresMountsFor=/data` would have blocked the start.
- `umount -f` on a busy NFS export left the application with ESTALE on every open file. Lazy unmount plus restart of the writers was slower and actually finished.
- `findmnt --verify` caught a copied fstab UUID from another host. That check is cheaper than a 20-minute trip to the console.
