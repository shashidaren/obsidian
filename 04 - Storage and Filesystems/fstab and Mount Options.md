# fstab and Mount Options

## Concept

`/etc/fstab` is the static table of filesystems the system should mount at boot (and that `mount -a` will process). Each line names a device (preferably by UUID or label), a mount point, a type, options, and two integers: dump frequency and fsck pass order.

Mount options control behaviour that is hard to change later without a remount or reboot: barriers, atime, quotas, errors=remount-ro, nofail, x-systemd.* flags, etc.

systemd-fstab-generator turns fstab into mount units. A bad fstab line can stall boot or leave a dependency unsatisfied.

## Why it matters

- The wrong device in fstab (or a missing `nofail`) turns a disk failure into a boot hang.
- `defaults` hides important choices. Databases and mail queues care about `barrier` / `nobarrier`, `atime` / `noatime`, and `discard`.
- Automatic fsck (pass field 1 or 2) on a multi-terabyte volume can extend an outage by hours.
- Cloud and virtualisation often change the underlying device name. UUID or `/dev/disk/by-id` survives that; `/dev/sdc` does not.
- A mount that fails silently (`nofail` missing, or `x-systemd.device-timeout` too short) leaves an application writing to the wrong filesystem — usually the root volume — until it fills.

## Mental Model

```
fstab line
  → systemd-fstab-generator
      → *.mount unit
          → dependency of local-fs.target (unless nofail / noauto)

Fields:
  device   mountpoint   type   options   dump   pass
  UUID=…   /data        xfs    defaults,noatime,nofail   0   0

pass:
  0 = never fsck at boot
  1 = root, first
  2 = others, after root

Special options:
  nofail          do not fail boot if this mount fails
  noauto          do not mount at boot (mount -a skips it)
  x-systemd.requires= / x-systemd.after=   extra ordering
  _netdev         wait for network (NFS, iSCSI, etc.)
```

`mount -a` only processes lines that are not `noauto`. A running system can have mounts that are not in fstab (manual `mount`, autofs, container volumes).

## Key Commands

```bash
# What is actually mounted vs what fstab asked for
findmnt
findmnt -s          # from fstab
findmnt -T /data    # the mount that covers this path
cat /etc/fstab
lsblk -f
blkid

# Test a line without rebooting
mount -a            # or mount /data
systemctl status data.mount   # the generated unit
journalctl -u data.mount -b

# Remount with new options (when supported)
mount -o remount,noatime /data

# Generate a UUID line
blkid /dev/mapper/vg-data
# UUID=… /data xfs defaults,noatime,nofail 0 0
```

Prefer `UUID=` or `PARTUUID=` or `/dev/disk/by-id/…` over kernel names. LVM logical volumes are already stable (`/dev/mapper/vg-lv`).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Boot hangs on a mount | Device missing, no `nofail` | console, `journalctl -b -u *.mount` |
| Application wrote to root instead of /data | Mount failed, directory was empty on root | `findmnt /data`, `df` |
| fsck runs for hours at boot | pass=1 or 2 on a large volume | fstab pass field |
| Options “ignored” after edit | Need remount or reboot; or generator cache | `findmnt -o OPTIONS`, daemon-reload |
| NFS/iSCSI mount fails early | Missing `_netdev` | fstab, network-online.target |
| Device name changed after reboot | Used `/dev/sdX` | switch to UUID or by-id |
| `mount -a` does nothing | Line is `noauto` or already mounted | `findmnt -s` |
| Quota or project options missing | Not in fstab, only set manually | compare `findmnt` vs fstab |

## Investigation Tips

- `findmnt -T /path` answers “which filesystem am I actually on?” when an application is writing to the wrong place.
- After editing fstab, `systemctl daemon-reload` so the generator rebuilds the mount units. Then `systemctl status <mountpoint>.mount`.
- `nofail` is correct for non-critical data volumes and for anything that might be absent (external disks, optional SAN). It is wrong for the root filesystem.
- Large data volumes: set pass to 0 and schedule `xfs_repair -n` / `e2fsck -n` yourself. See [[Filesystem Check and Repair]].
- `_netdev` (or `x-systemd.after=network-online.target`) for anything that needs the network. Without it the mount races and fails.
- Cloud images sometimes ship an fstab that references a device that only exists on the original instance. Check it after every image or disk attach.
- Options like `discard` (TRIM) and `nobarrier` have performance and durability consequences. Do not cargo-cult them; see [[Write Barriers and Ordered Data]] and [[fstrim and Discard]].

## Related Notes

- [[Filesystem Check and Repair]]
- [[XFS Operations]]
- [[LVM Deep Dive]]
- [[Write Barriers and Ordered Data]]
- [[fstrim and Discard]]
- [[iSCSI Operations]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A database volume failed to mount because the SAN LUN was late. There was no `nofail` and no `_netdev`. Boot dropped to emergency. Adding both and a longer `x-systemd.device-timeout` turned it into a delayed but successful boot.
- An application filled the root filesystem because `/var/lib/pgsql` was a directory on root; the intended XFS mount had failed earlier and nobody noticed. `findmnt` would have shown it immediately.
- I left pass=2 on a 20 TB volume. The next kernel update triggered a multi-hour fsck. Pass is now 0 everywhere except root, and we run read-only checks on a schedule.
