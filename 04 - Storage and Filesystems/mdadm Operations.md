# mdadm Operations

## Concept

mdadm manages Linux software RAID: arrays of member devices exposed as `/dev/mdN` or `/dev/md/<name>`. The kernel MD driver does the mirror, stripe, or parity. mdadm assembles, fails, adds, and records the array. The concepts live in [[RAID Concepts]]; this note is the operational path.

An array is a set of superblocks that agree. Assembling the wrong subset is how you get a clean-looking device with old data.

## Why it matters

- Degraded is already an incident. The second disk failure during a RAID 5 rebuild is a restore.
- `/etc/mdadm.conf` (or `/etc/mdadm/mdadm.conf`) and the initramfs decide whether root-on-MD comes back after reboot. A working array today is not a bootable array.
- `--create` on disks that already have an array writes a new superblock. It is not "assemble, but louder".
- Rebuild and resync saturate the disks. Application latency during a rebuild is often the array, not the deploy.

## Mental Model

```
Member disks (superblock at 1.2 end, or 0.90/1.0 start — version matters)
    └── MD array /dev/md0 or /dev/md/data
            └── filesystem, LVM PV, or LUKS

States in /proc/mdstat:
  [UU]     both members up (RAID1 example)
  [U_]     degraded
  recovery / resync    rebuild in progress, % and finish ETA
  bitmap                write-intent bitmap speeds resync after crash
```

Metadata 1.2 (default) stores the superblock near the end. 1.0 stores it at the start and is sometimes used when the array itself must look like a raw filesystem from offset 0. Do not mix versions on a whim. `mdadm --examine` shows the version and event count.

The member with the highest event count is the newest. Assembling without looking at event counts is how a stale disk wins.

## Key Commands

```bash
# State
cat /proc/mdstat
mdadm --detail /dev/md0
mdadm --examine /dev/sda1          # every member, including the "failed" one
mdadm --detail --scan              # lines suitable for mdadm.conf

# Fail, remove, add (example)
mdadm --manage /dev/md0 --fail /dev/sdc1
mdadm --manage /dev/md0 --remove /dev/sdc1
# replace the disk, partition to match, then:
mdadm --manage /dev/md0 --add /dev/sdd1
watch -n 5 cat /proc/mdstat

# Assemble explicitly when --scan might grab the wrong set
mdadm --assemble /dev/md0 /dev/sda1 /dev/sdb1
mdadm --assemble --scan

# Stop (unmount and deactivate LVM on it first)
mdadm --stop /dev/md0

# Persist and make bootable
mdadm --detail --scan >> /etc/mdadm.conf    # review; do not blindly append dupes
# Debian/Ubuntu:
update-initramfs -u
# RHEL-like:
dracut -f

# Rebuild throttle (kernel interface; names vary by array)
cat /sys/block/md0/md/sync_speed
cat /proc/sys/dev/raid/speed_limit_min
cat /proc/sys/dev/raid/speed_limit_max
```

Mail or a monitoring check on `/proc/mdstat` is part of the setup. An array that degrades silently will be found during the second failure.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `[U_]` in mdstat | Member failed or not assembled | `mdadm --detail`, `--examine` on each disk, dmesg |
| Rebuild stuck at 0% or crawling | Failing spare, URE, or speed limits | SMART on remaining members, `iostat`, speed_limit |
| Array missing after reboot | conf or initramfs stale; members renamed | `--examine`, assemble by device, rebuild initramfs |
| Two arrays claim the same name | Autodetect plus conf, or a foreign disk | `--examine` UUIDs; stop the wrong one |
| `--create` "succeeded" and data is gone | New superblock over old array | Restore. This is not a repair step |
| Split brain after both sides wrote | Event counts diverged | Do not assemble both blindly; pick from backups / events |
| Boot emergency, root MD absent | initramfs has no mdadm, or UUID mismatch | [[initramfs]], `lsinitrd \| grep mdadm` |
| I/O errors only on one member | That disk or its path | SMART, cabling, then fail the member |

## Investigation Tips

- `--examine` every member, including ones the controller already marked failed, before you assemble or add. Record UUID, events, and state in the ticket.
- Degraded plus pending sectors on a survivor: stop non-critical I/O, confirm the backup, then rebuild. See [[SMART and Disk Health]] and [[RAID Concepts]].
- Update mdadm.conf and the initramfs in the same change as the array. Otherwise the next reboot is the real change.
- A write-intent bitmap makes crash recovery faster. It does not protect against a second disk failure.
- Reshape (`--grow` level or device count) is a planned, backed-up operation. It is not how you fix a degraded array.
- Foreign disks (moved from another host) can auto-assemble and steal a name. Examine UUID before you let `--scan` run on a rescue image.
- Hardware RAID is not mdadm. If `lsblk` shows one LUN and no `md`, use the controller CLI. Do not `mdadm --create` on a hardware RAID virtual disk.

## Related Notes

- [[RAID Concepts]]
- [[SMART and Disk Health]]
- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[initramfs]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `--assemble --scan` on a rescue USB picked up a spare disk from a decommissioned array and ignored the newer member still in the chassis. Event counts on `--examine` are mandatory now.
- I left a degraded RAID 1 over a weekend because the mirror "still served traffic". The second disk threw pending sectors on Monday. Degraded means the spare is already ordered.
- The array was healthy and the reboot still dropped to an emergency shell. mdadm.conf had the array; the initramfs did not. Config without a rebuild is a note to yourself, not a boot path.
