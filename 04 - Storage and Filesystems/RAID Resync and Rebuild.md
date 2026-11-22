# RAID Resync and Rebuild

## Concept

Resync (or rebuild) is the process of reconstructing data on a replacement or recovered member of a RAID array. For software RAID it is driven by the MD driver and visible in `/proc/mdstat`. For hardware RAID it is driven by the controller firmware.

During resync the array is still serving I/O, but every read or write contends with the rebuild traffic. Latency and throughput drop until the resync finishes or is throttled.

## Why it matters

- A degraded array is already one failure away from data loss. The rebuild is the window where a second failure is fatal (especially RAID 5/6).
- Rebuild I/O can saturate disks and make the application look “slow” even though no new user load was added.
- An unmonitored rebuild that stalls or crawls often means a dying survivor disk. You discover it when the second disk fails.
- Initramfs / controller cache policies interact with whether the array comes back degraded or fully rebuilt after a reboot.

Treat every degraded array as an incident until the rebuild completes and a scrub confirms the data.

## Mental Model

```
Degraded array
  → spare or replacement added
  → kernel/controller reads good members, writes reconstructed data to new member
  → progress in /proc/mdstat or controller CLI
  → array returns to [UU] / optimal

Speed is limited by:
  - slowest surviving disk
  - speed_limit_min / speed_limit_max (MD)
  - controller rebuild rate
  - concurrent application I/O
```

A write-intent bitmap (MD) makes crash recovery faster but does not change the full rebuild after a disk replacement.

## Key Commands

```bash
# Software RAID
cat /proc/mdstat
mdadm --detail /dev/md0
watch -n 2 cat /proc/mdstat

# Throttle or speed up (MD)
cat /sys/block/md0/md/sync_speed
echo 50000 > /sys/block/md0/md/sync_speed_min   # KB/s
echo 200000 > /sys/block/md0/md/sync_speed_max

# Hardware RAID (examples — vendor CLI varies)
# MegaCLI / storcli / ssacli / perccli
storcli /c0 show
storcli /c0/eall/sall show

# SMART on all members during rebuild
smartctl -a /dev/sdX
```

Record the start time, expected finish, and current speed in the ticket. A rebuild that slows over time is a warning.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Rebuild stuck at low % | Failing survivor, URE, or speed limit too low | SMART, `iostat`, dmesg, speed_limit |
| Rebuild finishes then array degrades again | New disk already bad, or cabling | SMART on the replacement, reseat |
| Application latency spikes during rebuild | Rebuild competing with production I/O | Throttle rebuild, move non-critical load, check iostat |
| Array missing after reboot mid-rebuild | Initramfs or controller did not auto-start | [[initramfs]], controller settings, `mdadm --assemble` |
| “Rebuild complete” but data corrupt | Silent corruption on a survivor that was not scrubbed | Run a scrub / consistency check after rebuild |
| Hardware RAID rebuild never starts | Hot spare not configured, or controller policy | Controller CLI, spare status |

## Investigation Tips

- Check SMART on every remaining member before and during the rebuild. A rising reallocated or pending sector count on a survivor means stop non-critical I/O and prepare for restore.
- Throttle the rebuild if application SLAs are at risk. A slower rebuild that finishes is better than an overloaded array that loses the second disk.
- After the rebuild reaches 100%, run a scrub or consistency check. “Optimal” does not mean “verified”.
- For root-on-RAID, confirm the initramfs contains mdadm and the array UUID before you reboot a host that is mid-rebuild.
- Hardware RAID rebuild speed is often set in the controller BIOS/CLI. Document the setting; a “fast” rebuild can starve the OS.
- See [[mdadm Operations]] and [[RAID Concepts]] for assembly and failure handling. This note is only the resync phase.

## Related Notes

- [[mdadm Operations]]
- [[RAID Concepts]]
- [[SMART and Disk Health]]
- [[iostat Deep Dive]]
- [[Disk I/O and Latency]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A RAID 6 rebuild that looked healthy at 40% started throwing UREs on a survivor. We restored from backup instead of finishing the rebuild and hoping. The second failure never came, but the data was already suspect.
- I once left a rebuild at full speed overnight on a database host. The next morning the application team opened a “sudden latency” ticket. Throttling would have been invisible to them and still finished before business hours.
