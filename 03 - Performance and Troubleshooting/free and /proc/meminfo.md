# free and /proc/meminfo

## Concept

`free` is a summary of `/proc/meminfo`. The numbers that matter for “are we out of memory?” are `MemAvailable` and the swap activity, not the “used” column that includes page cache.

`/proc/meminfo` is the kernel’s accounting of every major page type: free, available, cache, buffers, dirty, writeback, anonymous, slab, and the various reclaimable vs unreclaimable splits.

`MemFree` is almost useless as a health metric. The kernel keeps free pages low on purpose so it can use RAM for cache.

## Why it matters

- Alerting on “memory used > 90%” pages people for healthy cache and hides real pressure.
- `MemAvailable` is the kernel’s own estimate of how much memory can be given to new allocations without swapping.
- A gap between `MemTotal` and the sum of the obvious fields is usually slab, kernel stacks, or ballooning (VMs).
- Dirty and Writeback tell you whether memory pressure is actually a storage problem (pages that cannot be written back).
- Container and cgroup limits are invisible in the host’s `free`. A unit can OOM while the host looks fine.

## Mental Model

```
MemTotal
  − MemFree          (truly unused)
  − Buffers / Cached / SReclaimable   (reclaimable cache)
  ≈ memory that is harder to get back

MemAvailable ≈ MemFree + reclaimable cache − watermarks
              (what a new allocation can probably get)

AnonPages / Active(anon) / Inactive(anon)   → swap candidates
Slab / SReclaimable / SUnreclaim            → kernel
Dirty / Writeback                           → waiting on storage
SwapTotal / SwapFree                        → already swapped
```

`free -h` “available” column is `MemAvailable`. Use that.

## Key Commands

```bash
free -h
free -h -s 1          # watch

# The raw numbers
cat /proc/meminfo
awk '/MemTotal|MemFree|MemAvailable|Buffers|Cached|Swap|Dirty|Writeback|AnonPages|Slab|SReclaimable|SUnreclaim|Committed_AS|CommitLimit/ {print}' /proc/meminfo

# Per-process
ps -eo pid,user,rss,cmd --sort=-rss | head
pidstat -r 1 3

# Pressure
cat /proc/pressure/memory
vmstat 1 5            # si/so

# cgroup (systemd)
systemctl status <unit> | head
cat /sys/fs/cgroup/system.slice/<unit>/memory.current 2>/dev/null
```

`Committed_AS` vs `CommitLimit` matters when overcommit is disabled (`vm.overcommit_memory=2`). Otherwise the kernel will hand out more virtual memory than RAM+swap.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Alert on high “used”, system fine | Cache counted as used | `MemAvailable`, Cached |
| MemAvailable low, Cached already small | Real pressure | RSS, PSI, swap |
| free looks OK, one service dies | cgroup / MemoryMax | unit memory.current, journal OOM |
| High Dirty / Writeback, stalls | Storage cannot absorb writes | iostat, [[Write Barriers and Ordered Data]] |
| Slab huge, userspace RSS modest | dentry/inode cache or leak in kernel | `slabtop` |
| Swap used but si/so = 0 | Old pages, not thrashing | `vmstat` over time |
| Committed_AS near CommitLimit | overcommit off, or leak of virtual memory | `vm.overcommit_memory` |
| Numbers disagree with monitoring | Agent counts differently | compare agent to `/proc/meminfo` |

## Investigation Tips

- Read `MemAvailable` first. If it is healthy, you are probably not in a memory incident.
- Then look at the top RSS processes and PSI. Cache is not the enemy; unreclaimable anonymous memory and unreclaimable slab are.
- Dirty + Writeback high while MemAvailable falls means the problem may be the disk or the network filesystem, not “need more RAM”.
- Inside a container, read `/proc/meminfo` and the cgroup files. They can tell different stories.
- `drop_caches` changes the numbers and destroys the working set. Capture `free` and `meminfo` before you do it.
- See [[Memory Pressure Runbook]] for the full triage order and [[Swap and OOM Killer]] for what happens next.

## Related Notes

- [[Memory Pressure Runbook]]
- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[Page Cache and Drop Caches]]
- [[Pressure Stall Information]]
- [[pidstat Deep Dive]]
- [[vmstat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A monitoring system alerted at 85% “memory used” for months. The boxes were healthy; they were just caching. Switching the alert to MemAvailable < 10% and PSI full eliminated the noise and caught the real leaks.
- Host `free` looked fine while a Java service hit its cgroup MemoryMax and restarted every few minutes. The host number was irrelevant; the cgroup was the limit that fired.
- High Dirty pages and falling MemAvailable turned out to be an NFS server that had stopped responding. The local box was not out of RAM; it was waiting to write back. iostat and the NFS mount stats explained it.
