# bcache Operations

## Concept

bcache is a block-layer cache that uses a fast device (SSD) as a write-back or write-through cache for a slower device (HDD or slower SSD). It appears as a single `/dev/bcacheN` device. Unlike dm-cache it is purpose-built for this role and has its own superblock and metadata.

The important operational facts are: the cache and backing device must be registered in the right order, dirty data lives only on the cache until it is flushed, and a missing cache device with dirty data is a data-loss event unless you have a detached superblock or a backup.

## Why it matters

- Write-back mode gives large sequential write gains but turns a cache SSD failure into potential data loss.
- Registration order and udev races are the most common reason a bcache device disappears after reboot.
- Dirty data on the cache must be flushed before you can safely detach or replace the SSD.
- Performance collapses if the cache is full of dirty data and the backing device cannot keep up (writeback congestion).

## Mental Model

```
application write
  → bcache device
       → (writeback) land on cache SSD, ack immediately
       → background writeback to backing HDD
  → (writethrough) write both, ack after backing completes
```

`/sys/block/bcache0/bcache/` contains the live state: cache mode, dirty data, congestion thresholds, and the ability to force a flush.

## Key Commands

```bash
# List bcache devices and their state
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
cat /sys/block/bcache0/bcache/cache_mode
cat /sys/block/bcache0/bcache/dirty_data
cat /sys/block/bcache0/bcache/state

# Register devices (order matters)
echo /dev/sdX > /sys/fs/bcache/register
echo /dev/sdY > /sys/fs/bcache/register

# Force writeback of dirty data before maintenance
echo 0 > /sys/block/bcache0/bcache/writeback_running   # pause
# or wait for dirty_data to drop
watch -n 5 cat /sys/block/bcache0/bcache/dirty_data

# Detach cache (only when clean or you accept data loss)
echo 1 > /sys/block/bcache0/bcache/detach

# Stats
cat /sys/block/bcache0/bcache/stats_total/*
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| bcache device missing after reboot | registration race or missing udev rule | `dmesg`, `/sys/fs/bcache` |
| Writes hang, dirty_data not falling | backing device slow or congested | `dirty_data`, `iostat` on backing |
| Cache SSD failed, device read-only | dirty data, no cache | `state`, dmesg |
| Performance worse than raw HDD | cache thrashing or writeback stall | cache hit rate, dirty data |
| `detach` refused | dirty data present | flush first |
| Device shows as `bcache` but no filesystem | never formatted or superblock mismatch | `bcache-super-show` |

## Investigation Tips

- Always check `dirty_data` before any maintenance on the cache device. If it is non-zero, you have unflushed writes.
- Registration is not persistent by itself. Most distros use a udev rule or an init script; confirm it ran (`journalctl -b | grep bcache`).
- Write-back is the performance mode; write-through is the safe mode. Changing mode does not flush existing dirty data.
- `bcache-super-show /dev/sdX` tells you whether a device has a bcache superblock and whether it is cache or backing.
- If the cache device is gone and you have no backup of dirty data, the backing device may still be mountable in degraded mode but recent writes are lost.

## Related Notes

- [[Thin Provisioning and Snapshots]]
- [[I/O Schedulers and blk-mq]]
- [[iostat Deep Dive]]
- [[SMART and Disk Health]]
- [[Device Mapper Multipath]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A host came up without its bcache device because the SSD registered after the HDD and the udev rule only fired once. Adding an explicit `echo ... > register` in a oneshot unit fixed the race.
- I tried to replace a cache SSD while `dirty_data` was 12 GB. The detach failed. Waiting for writeback (with the application paused) took 40 minutes; the alternative was data loss.
- Write-back looked great in benchmarks and terrible in production when the HDD could not absorb the writeback stream. Congestion thresholds had to be lowered.
