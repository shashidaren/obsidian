# dm-cache and bcache

## Concept

dm-cache (device-mapper cache) and bcache both use a fast device to cache a slow one. dm-cache is configured via LVM or dmsetup and integrates with the device-mapper stack. bcache is a separate block driver with its own registration.

They solve the same problem with different operational models.

## Why it matters

- Dirty data on the cache device is unflushed writes. Losing the cache loses those writes.
- Configuration mistakes (mode, policy, origin size) are hard to unwind without downtime.
- Both can disappear after reboot if registration or LVM activation order is wrong.

## Mental Model

```
dm-cache:
  origin (slow) + cache (fast) + metadata
    → dmsetup table or lvconvert --type cache
      → appears as a logical volume

bcache:
  register backing + cache
    → /dev/bcacheN
```

Writeback vs writethrough is the same tradeoff in both.

## Key Commands

```bash
# dm-cache / LVM
lvs -o+cache_policy,cache_mode,cache_dirty_blocks
dmsetup status
lvconvert --type cache ...

# bcache (see [[bcache Operations]])
cat /sys/block/bcache0/bcache/cache_mode
cat /sys/block/bcache0/bcache/dirty_data
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Cache device missing | activation order or missing metadata | lvs, dmsetup, dmesg |
| Dirty blocks high, slow | writeback congestion | dirty_data, iostat |
| Cannot remove cache | dirty data or in-use | flush, unmount |
| Performance regression | cache thrashing | hit rate, policy |

## Investigation Tips

- Prefer LVM thin + cache only if you already live in LVM. bcache is often simpler for pure HDD+SSD.
- Always flush dirty data before hardware replacement.
- Test reboot after any cache setup change.

## Related Notes

- [[bcache Operations]]
- [[LVM Deep Dive]]
- [[Thin Provisioning and Snapshots]]
- [[I/O Schedulers and blk-mq]]
- [[SMART and Disk Health]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- dm-cache on an LVM volume looked convenient until a metadata repair required taking the volume offline. bcache’s explicit register made the failure mode clearer.
