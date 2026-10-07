# Device Mapper Multipath

## Concept

Device-mapper multipath presents several paths to the same SAN LUN (or similar shared disk) as one block device, typically `/dev/mapper/mpath*` or `/dev/mapper/<wwid>`. `multipathd` watches path health and fails I/O from a dead path to a live one. The WWID is the identity. `/dev/sdX` is just one path and will change.

LVM, filesystems, and applications belong on the multipath map, never on a single path.

## Why it matters

- Using `/dev/sdb` for a PV or mount on a multipathed LUN splits I/O, confuses LVM, and breaks the moment that path disappears.
- `queue_if_no_path` keeps I/O queued when all paths are dead. Processes sit in D state instead of failing fast. That is sometimes correct and sometimes how a host hangs a failover.
- A blacklisted local disk that is actually a LUN (or a LUN that is not blacklisted and is a local disk) is a classic build error. Both fail later, not at install time.
- Path loss is often fabric, HBA, or zoning, not "the disk died". Replacing a LUN because one path flapped wastes a change window.

## Mental Model

```
Host HBA ports
    └── paths /dev/sdX  /dev/sdY  (same WWID, different path)
            └── multipath map /dev/mapper/mpatha
                    └── LVM PV → VG → LV → filesystem

Path groups:
  active/active     all paths in one group, I/O spread (ALUA / most modern arrays)
  active/passive    one group active; standby used on failure
Policy and checker live in /etc/multipath.conf (or multipath.conf.d)
```

`multipath -ll` is the picture: WWID, size, features, path groups, and each path's state (`active`, `failed`, `faulty`). If a path is missing there, the host does not see it — look at `lsblk`, `dmesg`, and the fabric before you edit conf.

Local disks, install media, and sometimes internal RAID virtual disks must be blacklisted so multipath does not claim them. Match on vendor/model or WWID, not on `sdX`.

## Key Commands

```bash
# The map you should actually use
multipath -ll
multipath -v2
ls -l /dev/mapper/
lsblk -o NAME,SIZE,TYPE,WWN,SERIAL,VENDOR,MODEL,MOUNTPOINT

# Daemon and config
systemctl status multipathd
multipathd show paths
multipathd show maps
multipathd show config          # compiled config, after defaults

# Reload after a reviewed conf change
multipath -t                    # syntax / dry view of devices
systemctl reload multipathd

# Force a path recheck (device names from multipath -ll)
multipathd reconfigure
# fail/reinstate a path only when you mean to
# multipathd fail path sdb
# multipathd reinstate path sdb

# LVM must see the map, not each path
pvs
grep -n filter /etc/lvm/lvm.conf
ls -l /dev/disk/by-id/
```

`user_friendly_names` (`mpatha`) is convenient and unstable across reinstalls. WWID names are ugly and survive. Pick one and use it in fstab and LVM filters consistently.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| One path failed, map still up | Single fabric/HBA/cable fault | `multipath -ll`, which HBA, switch port |
| All paths failed, I/O hung | Array or zoning loss; queue_if_no_path | App D state, multipath features line |
| Duplicate PVs, LVM warnings | PV created on a path and on the map | `pvs -a`, LVM filter, `dmsetup ls --tree` |
| Map missing after reboot | multipathd disabled, or conf blacklist wrong | unit status, `multipath -ll`, initramfs |
| Local disk became mpath | Blacklist too narrow | `multipath -ll` on non-SAN disks |
| LUN not multipathed | Blacklist too wide, or only one path visible | `lsblk`, zoning, `lsscsi` |
| Size wrong on the map | LUN grown; map not resized | array size, `multipathd resize map`, then PV |
| Boot cannot find root map | multipath not in initramfs | [[initramfs]], `lsinitrd \| grep multipath` |

## Investigation Tips

- Start with `multipath -ll` and `lsblk`. If the filesystem sits on `/dev/sdX` and that disk has siblings with the same WWID, you are on the wrong node. Migrate to the map in a planned window.
- One failed path is a fabric ticket. All paths failed is a storage or zoning ticket. Do not start with a filesystem check.
- LVM filter should accept `/dev/mapper/` and reject the underlying paths (`/dev/sd*` that are multipath members). A filter that rejects the map is how VGs vanish after reboot. See [[LVM Deep Dive]].
- `queue_if_no_path` vs `no_path_retry`: know which this host uses before you interpret a hung database. Queuing hides the outage from the app until paths return — or until the queue is flushed.
- Resize order: array grows LUN → host sees new size on paths → `multipathd resize map` → `pvresize` on the map → `lvextend` → filesystem. Skipping the map resize leaves LVM blind.
- Root-on-multipath needs the multipath module in the initramfs and the same conf the host uses. Rebuild after conf changes that affect boot.
- Friendly names can swap when a LUN is added. Alias by WWID in `multipath.conf` if operators need stable `mpath` names.

## Related Notes

- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[initramfs]]
- [[Filesystems and Mounts]]
- [[SMART and Disk Health]]
- [[Virtualization Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A PV on `/dev/sdb` survived until a switch maintenance failed that path. The map was healthy; the VG was not, because LVM had activated the path. The filter and the mount now both name the mapper device.
- `queue_if_no_path` turned a 30-second fabric blip into a 20-minute database stall. Apps never saw an error, so the failover never ran. Know the feature line before you call the array "fine".
- Friendly name `mpatha` on two hosts was not the same WWID after a LUN add. Aliases are now pinned to WWID in conf, and the ticket template asks for WWID, not the friendly name.
