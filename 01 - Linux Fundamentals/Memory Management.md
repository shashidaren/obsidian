# Memory Management

## Concept

Linux treats RAM as a cache that happens to also hold process memory. Free pages are wasted pages. The kernel fills them with page cache (file-backed pages), slab (dentries, inodes, network), and whatever else it can reclaim later.

The number that matters is **MemAvailable**: an estimate of how much the kernel can give out without going to swap. “Free” near zero with healthy MemAvailable is normal. Swap activity, reclaim stalls, compaction, and OOM are pressure. RSS of one process climbing forever is a leak. High VSZ with modest RSS is mappings, not use.

cgroups add a second memory world. A pod can OOM with the node still happy.

## Why it matters

- Pages of “used” that are cache will be reclaimed under demand. Killing processes because `free` looks low is how you create an incident from a non-event.
- Once anonymous pages spill to swap, latency becomes random. Throughput graphs can look fine while p99 dies.
- OOM killer is a last-ditch allocator failure, not a cleanup policy. If you needed it, capacity or a leak already lost.
- Databases, JVMs, and page cache fight over the same RAM. Leaving “the OS will figure it out” without a cache budget is how Postgres and the page cache starve each other.

## Mental Model

```
MemTotal
├── Anon / RSS          process heaps, stacks, tmpfs, mlock
├── File / page cache   file-backed; reclaimable unless dirty + stuck writeback
├── Buffers             block-device metadata, usually small
├── Slab                kernel objects; part reclaimable (SReclaimable)
├── Kernel / unreclaim  page tables, slub unreclaimable, reservations
└── Free                unused right now; not the health metric

MemAvailable ≈ Free + reclaimable cache/slab − watermarks / low reserves

Pressure signals (in order of “how bad”):
  MemAvailable falling toward working set
  kswapd active, allocstall / pgscan in vmstat/sar
  si/so non-zero in vmstat          → swapping
  compaction stalls, high %sys
  oom-kill in dmesg                 → allocator gave up
```

RSS is resident anonymous + file pages *this process* holds. PSS splits shared pages. VSZ is virtual mappings and is almost never the number you page someone for.

Dirty pages must be written back. A host can look “full of cache” and still stall if the backing disk cannot absorb writeback.

## Key Commands

```bash
# The honest headline
free -h
awk '/MemTotal|MemFree|MemAvailable|Buffers|Cached|Swap|Dirty|SReclaimable|AnonPages|Shmem/{print}' /proc/meminfo

# Who holds RSS
ps -eo pid,user,rss,vsz,cmd --sort=-rss | head -20
# smem is better if installed: PSS instead of over-counting shared

# Pressure over time
vmstat 1 10          # si/so, and under some versions the memory columns
sar -r 1 5           # if sysstat is there

# Reclaim / scan activity
grep -E 'pgscan|pgsteal|pswpin|pswpout|oom_kill' /proc/vmstat

# Per-cgroup (v2)
cat /sys/fs/cgroup/system.slice/<unit>/memory.current
cat /sys/fs/cgroup/system.slice/<unit>/memory.max
cat /sys/fs/cgroup/system.slice/<unit>/memory.events     # oom, oom_kill

# One process
cat /proc/<PID>/status | grep -E 'VmRSS|VmSize|VmSwap|RssAnon|RssFile|Threads'
cat /proc/<PID>/smaps_rollup          # compact per-mapping totals

# OOM history
dmesg -T | grep -i -E 'oom|killed process'
journalctl -k -g 'Out of memory'
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Free ≈ 0, MemAvailable healthy | Normal cache fill | Stop here; do not “free RAM” |
| MemAvailable collapsing, si/so > 0 | Real pressure, swapping | RSS leaders, leak vs undersize |
| One RSS climbs, rest flat | Leak or unbounded cache in-app | `ps` over time, heap/GC logs |
| High Cached, high Dirty, `%wa` | Writeback storm | `iostat`, disk latency, `Dirty` in meminfo |
| OOM of a cgroup, node MemAvailable OK | Limit too low or leak in the unit | `memory.events`, container limit |
| OOM of a small process, not the hog | Heuristic picked a low-`oom_score_adj` victim poorly — or the hog is a child | `oom_score`, parent tree |
| Huge VSZ, small RSS | Memory-mapped files / reserved heap | Ignore VSZ; look at RSS/PSS |
| Shmem / tmpfs huge | Files in `/dev/shm` or tmpfs | `df -h /dev/shm`; who writes there |
| Slab huge, dentries/inodes | Cache of a huge file tree | `slabtop`; usually reclaimable |

## Investigation Tips

- Graph **MemAvailable** and **swap I/O**, not MemFree. Alert on swap *activity* or available crossing a floor, not on “80% used”.
- Take two RSS snapshots ten minutes apart before you call a leak. Batch jobs allocate in cliffs.
- `echo 3 > /proc/sys/vm/drop_caches` is a diagnostic, not a fix. It throws away warm cache and can make the next minute worse. Do not put it in a cron.
- JVM `-Xmx` + direct buffers + page cache can overcommit the box even when the heap graph looks inside limits. Count *all* RSS of the process.
- For containers, `memory.max` is a hard wall. The kernel will reclaim then OOM-kill inside that cgroup. Node-level `free` will not warn you.
- `Dirty` stuck high with a dead NFS mount is a classic hang: writeback cannot complete, allocators stall, load average explodes.

## Related Notes

- [[Swap and OOM Killer]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[Processes and Threads]]
- [[File Descriptors]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A dashboard painted the box “95% memory used” every night. That was page cache after a backup. MemAvailable never dipped. We wasted a week planning a resize.
- The OOM victim was `sshd` once because a leaky worker had `oom_score_adj=-1000`. Protecting the hog is how you lose the management plane.
- I stopped using `free` without `-h` and without reading the *available* column. The first line of `free` without understanding buffers/cache is a footgun I have handed to juniors too many times.
