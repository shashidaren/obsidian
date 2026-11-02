# SMART and Disk Health

## Concept

SMART (Self-Monitoring, Analysis and Reporting Technology) is the disk’s own health telemetry: reallocated sectors, pending sectors, temperature, CRC errors, and (on NVMe) percentage used and critical warnings. `smartctl` reads it; `smartd` watches it.

## Why it matters

- A disk can pass `smartctl -H` and still be dying. The attribute table is what matters.
- Pending or reallocated sectors on a RAID member are a countdown to a failed rebuild.
- CRC errors are usually the cable, backplane, or HBA, not the media. Replacing the disk does not fix them.
- Cloud and many virtual disks expose no useful SMART. Guest latency and the provider’s volume metrics are the signal there.

## Mental Model

```
media error
    → disk tries to remap
        → Reallocated_Sector_Ct increases (success)
        → Current_Pending_Sector increases (not yet remapped)
            → next write may remap or fail

interface error (CRC)
    → path problem (cable, expander, HBA)
    → not a reason to RMA the disk first
```

## Key Commands

```bash
smartctl -a /dev/sda
smartctl -x /dev/sda          # includes logs
smartctl -t long /dev/sda
smartctl -H /dev/sda          # overall health (insufficient alone)
nvme smart-log /dev/nvme0
smartd -q show
journalctl -u smartd -n 50
```

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
- [[Ceph Operational Basics]]

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
