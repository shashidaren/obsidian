# Page Cache and Drop Caches

## Concept

The page cache is the kernel’s file-backed memory. Reads populate it; writes dirty it until writeback. Free RAM is filled with cache because empty pages are wasted pages. `MemAvailable` already accounts for how much of that cache can be reclaimed.

`drop_caches` throws the cache away. It is a diagnostic hammer, not a capacity tool.

## Why it matters

- Operators still “free memory” with `echo 3 > /proc/sys/vm/drop_caches` and then wonder why the next backup or database query is slow.
- A host can show high “used” memory that is almost entirely clean cache and still be healthy.
- Dirty cache that cannot be written back (dead NFS, full disk, stalled device) stalls allocators and raises load average even when CPU is idle.
- Applications that memory-map large files (databases, VMs) share the page cache with the rest of the system. Dropping it forces them to re-fault from disk.

## Mental Model

```
read() or mmap fault
  → page not present
      → allocate page, read from storage
          → page enters cache (clean)

write()
  → page becomes dirty
      → writeback (pdflush/kworker) later
          → page clean again, still cached

drop_caches:
  1 = pagecache
  2 = dentries + inodes
  3 = both
  (does not touch dirty pages or anonymous memory)
```

Reclaim under pressure does the same thing as a partial drop, but only for clean pages the kernel chooses, and only when it needs the RAM.

## Key Commands

```bash
# How much is cache vs available
free -h
grep -E '^(Cached|Buffers|Dirty|Writeback|MemAvailable)' /proc/meminfo

# What is dirty and waiting
cat /proc/meminfo | grep -E 'Dirty|Writeback'

# Diagnostic only — never cron this
sync
echo 3 > /proc/sys/vm/drop_caches
# then re-check free / MemAvailable and application latency

# Writeback pressure
sar -r 1 5
vmstat 1 5          # bi/bo, and wa if combined with iostat
iostat -xz 1 5
```

See also `vm.dirty_*` sysctls for how aggressively the kernel writes dirty pages.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `free` shows almost no free RAM, system fine | Normal cache fill | MemAvailable, stop |
| After drop_caches, latency spikes | Working set was in cache | Application metrics, iostat |
| Load high, CPU low, Dirty stuck | Writeback cannot complete | Dirty in meminfo, NFS/mount state, disk errors |
| Database “slow after maintenance” | Someone dropped caches | History of the echo command, sar |
| OOM while Cached looks large | Dirty + anonymous pressure, or unreclaimable | meminfo breakdown, cgroup events |
| Backup slows the host for hours | Sequential read evicts useful cache | iostat, consider ionice / cache advice |

## Investigation Tips

- Read MemAvailable and the Dirty/Writeback lines before you touch drop_caches. If MemAvailable is healthy, the cache is doing its job.
- `drop_caches` requires a prior `sync` if you want dirty pages considered; even then it only drops clean pages. Dirty pages stay until writeback finishes.
- Use it once, in a maintenance window, to answer “is this slowness cache-cold or something else?” Then leave it alone.
- Sequential backup or rsync of a large tree will evict other cache. That is expected. If it hurts production, throttle the backup or give the working set a cgroup memory floor where possible.
- In containers the page cache is usually host-global (unless using a private mount namespace with special options). Dropping on the host affects every container.
- Combine with [[Dirty Writeback and vm.dirty]] when Dirty is the large number, not Cached.

## Related Notes

- [[Memory Management]]
- [[Dirty Writeback and vm.dirty]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[Swap and OOM Killer]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A runbook contained `echo 3 > /proc/sys/vm/drop_caches` as a “memory cleanup” step. It ran every night before peak. The database’s buffer cache was cold at 09:00 every day. Removing the line was the entire fix.
- High Cached + high load was a stalled NFS mount. Dirty pages could not be written; the kernel could not reclaim. drop_caches did nothing useful because the pages were dirty. Fixing the mount did.
- I now treat any suggestion to cron drop_caches as a signal to look at the real pressure metric (MemAvailable, PSI, or cgroup memory.events) instead.
