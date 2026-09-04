# Filesystems and Mounts

## Concept

A filesystem is the on-disk structure (ext4, XFS, …). A mount is the kernel attaching that structure to a path in the VFS tree. Until a filesystem is mounted, its data is not reachable at a path — and a path can only show one filesystem’s content at a time (bind mounts and overmounts complicate that).

`/etc/fstab` and systemd `.mount` units are how mounts survive reboot. The live truth is the kernel mount table (`findmnt`, `/proc/self/mountinfo`).

## Why it matters

- “Disk full on `/`” is often a forgotten separate `/var` or `/data` that never mounted
- Boot hangs and emergency.target are frequently a hard-required fstab line for a missing or remote volume
- NFS/CIFS, LUKS, and LVM failures present as mount failures even when the block device is fine
- Resize, fsck, and dump operations require knowing whether the FS is mounted, and where

Never edit fstab without knowing how you will enter rescue if the next boot disagrees.

## Mental Model

```
Block device / UUID / network export / tmpfs
        → mount(2)
            → target path in VFS
                → options (rw, noexec, _netdev, nofail, …)

Persistent sources:
  /etc/fstab
  systemd .mount units (and generators that turn fstab into units)

Inspection:
  findmnt          kernel view (preferred)
  mount            classic list
  /proc/mounts     what the kernel has
  findmnt --fstab  what is configured
  findmnt --verify config vs reality
```

Order at boot: local filesystems → remote (after network) if `_netdev` is set. Without `_netdev`, a missing NFS server can stall boot for a long time.

## Key Commands

```bash
# What is mounted, and on which device?
findmnt
findmnt -D
findmnt -T /var/lib/mysql          # which FS owns this path?
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS,UUID

# Config vs live
findmnt --fstab
findmnt --verify
cat /etc/fstab

# Mount / remount
mount UUID=… /data
mount -a                          # all fstab entries (respects noauto)
mount -o remount,ro /
mount -o remount,rw /
mount --bind /src /dst

# Unmount
umount /data
umount -l /data                   # lazy: detach now, clean up when busy ends
umount -f /mnt/nfs                # force (dangerous on some network FS)

# Identity of the volume
blkid
lsblk -f

# Busy mount diagnosis
lsof +f -- /data
fuser -vm /data
findmnt -R /data                  # nested mounts under the path
```

fstab fields (simplified): `source` `target` `fstype` `options` `dump` `pass`.

Critical options:
- `nofail` — boot continues if this mount fails (use for non-root data)
- `_netdev` — wait for network; required for NFS/CIFS in fstab
- `noauto` — `mount -a` skips; you mount deliberately
- `ro`, `noexec`, `nosuid`, `nodev` — hardening / policy
- `x-systemd.device-timeout=` — shorten or lengthen wait

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Path empty or “wrong” data | Not mounted; overmount; wrong device | `findmnt -T path`, `lsblk -f` |
| Boot → emergency / rescue | fstab entry required and failed | `journalctl -b -p err`, comment line, `nofail` |
| `mount: target is busy` | Open files, cwd, or child mount | `lsof +f -- path`, `findmnt -R path` |
| NFS hang on boot | Missing `_netdev` or long timeout | fstab options, network-online.target |
| Filesystem remounted ro | Error policy, journal issue | `dmesg`, `findmnt -o OPTIONS`, plan fsck |
| Space full on `/` despite big disk | Big disk never mounted at expected path | `findmnt -T`, `df -h` both paths |
| UUID not found after clone | Duplicate or changed UUID | `blkid`, re-UUID before dual mount |
| systemd says mounted, app sees empty | Mount unit ordered after app | `RequiresMountsFor=`, unit dependencies |

## Investigation Tips

- `findmnt -T <path>` is the first command when capacity or content looks wrong. `df -h <path>` is the second.
- After any fstab change: `findmnt --verify` then `mount -a` *before* reboot. Still plan a console for the first reboot.
- Prefer `UUID=` or `LABEL=` in fstab. `/dev/sdX` is a future outage.
- Root and `/boot` should almost never get `nofail`. Data volumes should almost always get it (plus monitoring that the mount is present).
- Lazy unmount (`-l`) is the practical answer to busy mounts in emergencies; then find the holder. Forced unmount of network FS can corrupt application state.
- Containers and chroots have their own mount namespaces. Host `findmnt` is not the whole story inside a pod.
- systemd mount units generated from fstab appear as `data.mount` for `/data`. `systemctl status data.mount` is valid debugging.

## Related Notes

- [[mount and findmnt]]
- [[Block Devices and Partitions]]
- [[df and du Deep Dive]]
- [[LVM Deep Dive]]
- [[NFS Troubleshooting]]
- [[Disk Full Runbook]]
- [[ext4 Operations]]
- [[XFS Operations]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The costliest mount incident I own was an fstab NFS line without `_netdev` on a fleet image. Every host waited minutes on every reboot until someone noticed the pattern in the serial console.
- `df -h /` and `df -h /var/lib/docker` disagreeing is almost always “docker’s disk never mounted and we wrote to the root filesystem overlay path”. `findmnt -T` ends the debate.
- I refuse to ship an fstab change without `nofail` on non-root mounts *and* a check that alerts when `findmnt -T` does not show the expected source.
