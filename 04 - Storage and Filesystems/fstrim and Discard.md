# fstrim and Discard

## Concept

SSDs and thin-provisioned volumes need to know which blocks are no longer in use so they can reclaim them. `discard` (online, via mount option or `fstrim` continuous) or periodic `fstrim` tells the device. Without it, write amplification rises and thin volumes stay thick.

Most distributions ship a weekly `fstrim.timer`. Continuous discard (`discard` mount option) is usually worse for latency on consumer SSDs and unnecessary on many enterprise arrays.

## Why it matters

- A thin LVM or cloud volume that never sees TRIM stays at high water mark. You pay for capacity you deleted.
- Write performance degrades over months on SSDs that never get discard.
- A badly timed `fstrim` on a busy database volume can cause a latency spike while it runs.
- Some storage arrays ignore or rate-limit TRIM. The host still issues it.

## Mental Model

```
filesystem deletes a file
    → blocks marked free in the FS
    → fstrim or discard mount option sends TRIM/UNMAP to the device
    → device reclaims the space (SSD erase blocks, or thin volume shrinks)

fstrim.timer  →  weekly fstrim -a   (safe default for most hosts)
discard mount option  →  every delete issues TRIM  (higher latency risk)
```

`lsblk -D` shows whether the device advertises discard support.

## Key Commands

```bash
# Does the device support it?
lsblk -D
cat /sys/block/<dev>/queue/discard_max_bytes

# Manual trim of one mount (can take minutes; I/O impact)
fstrim -v /var/lib/pgsql

# All mounted filesystems that support it
fstrim -av

# Timer status
systemctl status fstrim.timer
systemctl list-timers fstrim.timer

# Mount options
findmnt -o TARGET,OPTIONS /var
```

Do not run `fstrim` on a volume that is under heavy write load if you can schedule it. The timer exists for a reason.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Thin volume or cloud disk stays large after deletes | no TRIM reaching the device | `lsblk -D`, timer enabled, array supports UNMAP |
| Latency spike every Sunday night | weekly fstrim on a data volume | `systemctl status fstrim`, move the timer or exclude the mount |
| `fstrim` says "not supported" | device or filesystem does not advertise discard | `lsblk -D`, FS type (some need specific options) |
| Continuous discard slows deletes | `discard` mount option on a busy SSD | remove the option; rely on the timer |
| Space not reclaimed on LVM thin | thin pool needs `issue_discards` or manual trim | LVM thin config, `lvs` data% |
| After enabling, nothing changes for hours | trim is asynchronous on the device | wait, or check array metrics |

## Investigation Tips

- Check the timer before you assume discard is happening. Many minimal images do not enable it.
- On database hosts, prefer the weekly timer over the `discard` mount option. The latency of online discard is measurable.
- Cloud volumes (EBS, etc.) often benefit from periodic trim for thin provisioning billing. Confirm with the provider whether TRIM is honoured.
- `fstrim -v` prints the number of bytes trimmed. Zero bytes usually means the FS already told the device, or nothing was free.
- LUKS and dm layers pass discard only if configured (`allow-discards` in crypttab). Otherwise the trim stops at the encryption layer.
- Do not run `fstrim` as a "fix" during an active incident unless you have evidence the device is out of erase blocks and you can tolerate the I/O.

## Related Notes

- [[Disk I/O and Latency]]
- [[SMART and Disk Health]]
- [[LUKS and Disk Encryption]]
- [[Filesystems and Mounts]]
- [[Thin Provisioning and Snapshots]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A thin-provisioned data volume billed at 2 TB after the application had deleted 800 GB. The `fstrim.timer` was disabled in the image. Enabling it and running once dropped the reported usage the next day.
- I disabled the timer on a latency-sensitive Postgres host after a weekly spike correlated with the fstrim run. Manual trim during the maintenance window was the compromise.
