# Write Barriers and Ordered Data

## Concept

A write barrier (or cache flush) forces data to stable storage before the operation that depends on it is considered complete. Filesystems use barriers (or explicit flushes) so that journal commits, directory updates, and `fsync` actually reach the media in the required order.

Without them a crash can leave the filesystem inconsistent even if the journal claims the transaction completed. With them, a slow or lying disk cache turns into latency.

## Why it matters

- Disabling barriers (`barrier=0`, `nobarrier`) on a device with a volatile write cache is how people get silent corruption after power loss.
- A disk or controller that ignores flush commands (`hdparm -W`, some RAID controllers, some cloud volumes) makes the filesystem believe data is safe when it is not.
- Database `fsync` and filesystem journal commits both rely on the same mechanism. If the storage lies, both lie.
- High `await` on a journal device is often barrier traffic, not random application I/O.

If you are tuning for latency and someone suggests turning barriers off, demand the power-loss test results first.

## Mental Model

```
Application write + fsync
    → filesystem orders the journal commit
    → issues a barrier / FLUSH / FUA
    → device cache must drain to stable media
    → only then is the syscall allowed to return

Device with volatile cache + barriers disabled
    = "completed" writes that vanish on power loss
Device that ignores FLUSH
    = same outcome, harder to see
```

`/proc/mounts` and `findmnt -o OPTIONS` show whether the filesystem was mounted with barriers. `hdparm -I` and controller management tools show write-cache policy.

## Key Commands

```bash
# Current mount options
findmnt -o TARGET,OPTIONS /var
grep -E 'barrier|nobarrier' /proc/mounts

# Device write cache (when hdparm works)
hdparm -W /dev/sda
hdparm -I /dev/sda | grep -i 'write cache'

# Force a test (destructive on the cache, not the data if barriers work)
# Prefer vendor tools or a controlled power-loss test in a lab

# Latency that may be barriers
iostat -x 1
# high await on a journal LV or the device that holds the journal
```

Common mount options:

- ext4: `barrier` (default), `nobarrier` (dangerous without battery-backed cache)
- XFS: barriers on by default; `nobarrier` exists and is equally dangerous
- `data=ordered` (ext4 default) vs `data=journal` vs `data=writeback`

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Corruption after power loss, journal replay looks clean | barriers off or device ignored flush | mount options, controller cache policy |
| High fsync latency, iostat await spikes | barriers + slow cache flush | `iostat -x`, filesystem journal location |
| Works on one array, corrupts on another | different write-cache / BBU status | controller logs, `hdparm -W` |
| Cloud volume "fsync is cheap" then data loss | volume ignores or delays flushes | provider docs, test with power-off |
| `nobarrier` set years ago "for speed" | forgotten tuning | `/proc/mounts`, fstab |

## Investigation Tips

- Read the actual mount options from `/proc/mounts`, not from fstab. A remount or an initramfs can differ.
- On hardware RAID, confirm the battery-backed or flash-backed cache is healthy and that the controller is actually using it. A failed BBU often disables the cache or changes policy.
- Cloud block devices vary. Some honour flushes, some batch them, some document that `fsync` is not crash-consistent across certain failure modes. Test or read the current provider note.
- Moving the journal to a separate fast device reduces barrier latency for the data device but does not remove the requirement for correct ordering.
- `data=writeback` can be faster and is less safe on crash. Know which you are running before you change it under pressure.
- After any storage change (controller firmware, cache policy, new volume type), re-validate with a controlled crash test if the data matters.

## Related Notes

- [[Filesystems and Mounts]]
- [[ext4 Operations]]
- [[XFS Operations]]
- [[Disk I/O and Latency]]
- [[LVM Deep Dive]]
- [[SMART and Disk Health]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A mail spool corrupted after a UPS failure. The array had `nobarrier` because a benchmark years earlier showed 15% better throughput. The BBU had been failed for months; nobody noticed because the filesystem never complained until the power event.
- High `await` on an XFS data volume turned out to be journal commits waiting on flushes to a slow SATA journal device. Moving the journal to SSD dropped the tail latency without disabling safety.
- A cloud provider’s "high IOPS" volume documented that flushes were asynchronous. The application’s `fsync` returned quickly and the replica diverged after a host crash. We switched volume types rather than trusting the syscall.
