# SMART and Disk Health

## Concept

SMART (Self-Monitoring, Analysis and Reporting Technology) is the disk's own health telemetry: reallocated sectors, pending sectors, temperature, interface CRC errors, media wear, and self-test results. `smartctl` (smartmontools) reads it. NVMe exposes the same idea through the NVMe SMART log, not the ATA attribute table.

SMART tells you the media or the path is sick. It does not tell you the filesystem is consistent, and a green "PASSED" does not mean the disk is safe to ignore.

## Why it matters

- Latency tickets and "random" I/O errors often start as pending or reallocated sectors days earlier.
- A RAID rebuild that hits an uncorrectable sector on the surviving member is how a degraded array becomes a restore.
- Hardware RAID and some USB/SAS bridges hide or lie about SMART. "The controller says optimal" is not a disk health check.
- UDMA CRC / Interface CRC errors are usually cable, backplane, or HBA — replacing the disk does nothing.

Treat a rising pending-sector count as an incident, not a graph to watch.

## Mental Model

```
Application error / slow fsync
    → filesystem / md / LVM
        → block device the OS can see
            → physical disk (or a path to it)
                → SMART / NVMe log on that disk

Attribute classes that change decisions:
  Reallocated_Sector_Ct     sectors already remapped (rising = dying)
  Current_Pending_Sector    waiting to be rewritten or remapped (UREs waiting)
  Offline_Uncorrectable     confirmed unreadable
  UDMA_CRC_Error_Count      link errors (cable/backplane/HBA), not media
  Temperature_Celsius       thermal throttling and early death
  Wear_Leveling / Media_Wearout / Percentage Used   SSD/NVMe life
```

`smartctl -H` is a vendor summary bit. Read `-a` / `-x` (or `nvme smart-log`) before you trust it. A disk can report PASSED with non-zero pending sectors.

Self-tests: short (minutes) catches electronics and a sample of media; long (hours) walks the surface and can surface pending sectors. Do not start a long test on a disk already in a production rebuild unless you mean to add load.

## Key Commands

```bash
# Identity and full report
smartctl -i /dev/sda
smartctl -a /dev/sda
smartctl -x /dev/sda          # includes logs, often more useful than -a
smartctl -H /dev/sda          # summary only; not sufficient

# NVMe (namespace node, not a partition)
nvme list
nvme smart-log /dev/nvme0
nvme error-log /dev/nvme0
smartctl -a /dev/nvme0        # smartmontools often works too

# SCSI/SAS behind a controller: may need a device type
smartctl -d sat -a /dev/sda
smartctl -d scsi -a /dev/sda
# MegaRAID/HPE examples (device numbers are vendor-specific — confirm first)
smartctl -d megaraid,0 -a /dev/sda
smartctl -d cciss,0 -a /dev/sda

# Self-tests
smartctl -t short /dev/sda
smartctl -t long /dev/sda
smartctl -l selftest /dev/sda
smartctl -X /dev/sda          # abort a running test

# What the host already saw
dmesg -T | grep -iE 'I/O error|sense|medium error|offline|reset'
journalctl -k -g 'I/O error|medium error' --since today
```

`smartd` (from the same package) should be running and mailing or logging on attribute changes. A one-off `smartctl` during an incident is not monitoring.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Pending sector count > 0 | Unreadable sectors not yet remapped | `smartctl -a`; plan replacement; do not rebuild onto a suspect spare |
| Reallocated count climbing | Media is failing; remap pool is being spent | Trend, not a single snapshot; replace |
| PASSED but CRC errors rising | Cable, backplane, expander, or HBA | Reseat/replace path; do not RMA the disk first |
| `smartctl` open failed | Device type wrong, RAID hiding disks, or permissions | `-d`, controller CLI, run as root |
| NVMe `critical_warning` non-zero | Spare, temperature, reliability, or read-only flag | `nvme smart-log`; percentage used |
| Latency spikes, SMART "fine" | Path, array, noisy neighbour, not media | [[Disk I/O and Latency]], multipath, controller |
| Long test fails at a specific LBA | Localized media damage | Replace; fsck will not heal the disk |
| Hardware RAID "optimal" | Virtual disk status, not member SMART | Vendor CLI plus `smartctl -d` |

## Investigation Tips

- Capture `smartctl -x` (or `nvme smart-log`) into the ticket before you pull the disk. The replacement will not have this history.
- Compare serial from `smartctl -i` with the slot label. "Replace disk 3" without a serial is how the wrong drive gets pulled.
- Pending sectors plus a degraded RAID is a restore-readiness problem. Confirm backups before the rebuild starts hammering the sick member.
- CRC errors that reset after a cable reseat were never a disk failure. Write that down so the next person does not swap the same disk again.
- SSD/NVMe: watch percentage used and available spare, not reallocated sectors alone. A drive can go read-only with spare exhausted.
- Cloud ephemeral disks and many virtual disks have no meaningful SMART. Guest `await` and the provider volume metrics are the health signal there.
- Do not run `badblocks` destructively on a disk you still need. SMART long test plus vendor tools are the usual path.

## Related Notes

- [[Block Devices and Partitions]]
- [[RAID Concepts]]
- [[mdadm Operations]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[Device Mapper Multipath]]
- [[Backup Strategy]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A controller tile stayed green while `Current_Pending_Sector` sat at 8 for a week. The rebuild then died on a URE. Pending sectors are now a page, not a footnote.
- I swapped a disk for CRC errors twice. The third time the backplane slot was the fault. Interface errors mean the path until proven otherwise.
- `smartctl -H` PASSED closed a ticket that `-a` would have kept open. Summary bits are for `smartd`. Humans read the attribute table.
