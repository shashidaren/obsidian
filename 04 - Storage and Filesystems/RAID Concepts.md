# RAID Concepts

## Concept

RAID (Redundant Array of Independent Disks) combines multiple disks into one logical device to gain redundancy, performance, or both. Levels differ in how they stripe, mirror, or parity-protect data. Software RAID (mdadm), hardware RAID controllers, and filesystem-level schemes (ZFS, Btrfs) all implement variants of the same ideas.

## Why it matters

- RAID is about **availability and performance**, not backup. A deleted file or corrupted filesystem is gone on every RAID level
- Degraded arrays (failed disk not yet replaced) run without redundancy — a second failure can mean total loss
- Rebuilds are stressful: heavy I/O, longer windows of vulnerability, and sometimes silent performance collapse
- Misreading “RAID is healthy” in a controller GUI while the OS sees read errors is a classic trap

Know whether you are on mdadm, a hardware controller, or a volume manager that sits on top of RAID.

## Mental Model

```
Common levels (simplified):

RAID 0  stripe          → speed, zero redundancy (any disk fails → total loss)
RAID 1  mirror          → 1:1 copy, simple, 50% capacity
RAID 5  stripe + parity → 1 disk fault tolerant, capacity n-1
RAID 6  stripe + 2 parity → 2 disk fault tolerant, capacity n-2
RAID 10 mirrors + stripe → good performance + redundancy, 50% capacity

States that matter operationally:
  clean / optimal     → full redundancy
  degraded            → running with failed member(s)
  recovering/rebuild  → resync in progress (vulnerable + slow)
  failed              → array not usable
```

Write hole, battery-backed cache (hardware), and consistency after power loss are controller-specific concerns.

## Key Commands

```bash
# Linux software RAID (mdadm)
cat /proc/mdstat
mdadm --detail /dev/md0
mdadm --examine /dev/sdX          # superblock on a member

# Assemble / stop (careful)
mdadm --assemble --scan
mdadm --stop /dev/md0

# Mark failed and remove a disk (example)
mdadm --fail /dev/md0 /dev/sdc1
mdadm --remove /dev/md0 /dev/sdc1

# Add a replacement and let rebuild run
mdadm --add /dev/md0 /dev/sdd1
watch -n 5 cat /proc/mdstat

# Hardware RAID — vendor tools (examples; install controller utilities)
# MegaCLI / storcli (Broadcom/LSI), ssacli (HPE), perccli, etc.
storcli /c0 /vall show
storcli /c0 /eall /sall show
# Always prefer the vendor tool + OS smartctl for the physical disks

# SMART on underlying disks (when visible)
smartctl -a /dev/sdX
smartctl -t long /dev/sdX

# I/O during rebuild (expect high util)
iostat -xz 1
```

Persistent mdadm config is typically `/etc/mdadm.conf` or `/etc/mdadm/mdadm.conf`; update after array changes and refresh initramfs when the root device depends on md.

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| Array degraded                       | Disk failed or kicked out                  | `/proc/mdstat`, `mdadm --detail`, controller log  |
| Rebuild stuck or very slow           | Bad replacement disk, I/O errors, throttle | dmesg, smartctl, mdadm detail, iostat             |
| Read errors / URE during rebuild     | Second disk failing while degraded         | Stop non-critical I/O; prioritise replacement     |
| Performance collapse                 | Degraded mode, failed BBWC, rebuild        | Array state, controller cache policy              |
| “Disk missing” after reboot          | Cabling, backplane, failed spin-up         | Controller event log, reseat, smartctl            |
| Split brain / wrong assemble order   | mdadm assembled incomplete set             | `--examine` all members; assemble explicitly      |
| Data loss after “RAID repair”        | Rebuilding from wrong disk / forced assemble | Never force without understanding superblocks   |

## Investigation Tips

- Treat degraded as an **incident**: schedule replacement and rebuild; do not wait for a convenient window if RPO is tight.
- Monitor rebuild percentage and estimated time; large arrays can take many hours. Limit host I/O if rebuild priority is starving production (md: `sync_speed_min/max`).
- For hardware RAID, the OS often sees a single LUN — smartctl on `/dev/sdX` may only talk to the virtual disk. Use the controller CLI for physical disk health.
- Confirm backups before any destructive mdadm or controller “recreate” operation. RAID rebuild is not a restore.
- After disk replacement, verify the array returns to clean/optimal and that monitoring still alerts on degraded state.
- Document slot ↔ serial number mapping; “replace the third disk” is ambiguous under pressure.

## Related Notes

- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
