# Memory Fragmentation

## Concept

Physical memory can become fragmented even when free pages exist. The buddy allocator keeps free pages in power-of-two orders (4 KiB, 8 KiB, …). After long uptime, large contiguous blocks disappear. High-order allocations (THP, DMA, certain kernel structures, some network buffers) then fail or stall while the kernel tries to compact.

Fragmentation is not “out of memory”. MemAvailable can look healthy while `compact_stall` and `allocstall` climb.

## Why it matters

- Transparent Huge Pages and some device drivers need contiguous physical pages. Fragmentation makes THP collapse or allocation stall.
- Compaction is CPU- and lock-heavy. It shows up as elevated `%sys` or latency spikes with no obvious user process.
- Long-running hosts (months of uptime, heavy page cache churn) are the usual victims. A reboot “fixes” it until the next cycle.
- Containers and cgroups do not isolate physical contiguity. One host’s fragmentation affects every pod.

## Mental Model

```
Buddy allocator free lists:
  order 0: 4 KiB pages   (plenty)
  order 1: 8 KiB
  ...
  order 9: 2 MiB        (often empty after weeks)
  order 10: 4 MiB

Allocation of order N needs a free block of that size.
If none exists → try reclaim/compaction → stall or fail.

Signals:
  /proc/buddyinfo     free counts per order per zone
  /proc/vmstat        compact_stall, compact_fail, allocstall
  dmesg               "page allocation failure" for order > 0
```

Compaction moves movable pages to free higher-order blocks. It is not free; it contends with normal reclaim.

## Key Commands

```bash
# Free blocks by order (look at higher orders)
cat /proc/buddyinfo

# Compaction and stall counters
grep -E 'compact_|allocstall|pgmigrate' /proc/vmstat

# Current THP status and defrag policy
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag

# Trigger compaction (diagnostic only)
echo 1 > /proc/sys/vm/compact_memory

# Per-node if NUMA
numastat -m
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `page allocation failure` order > 0, MemAvailable OK | Fragmentation | `buddyinfo`, `compact_stall` |
| Latency spikes, `%sys` high, no CPU hog | Compaction stalls | `vmstat` compact counters, `perf` |
| THP collapse or “khugepaged” busy | Cannot find 2 MiB blocks | `buddyinfo` order 9, THP defrag |
| After weeks of uptime, random stalls | Gradual fragmentation | uptime + `buddyinfo` trend |
| DMA / GPU / RDMA allocation fails | Device needs contiguous | dmesg order, zone DMA/DMA32 |
| Compaction makes load worse | Concurrent reclaim + migrate | temporary disable defrag |

## Investigation Tips

- Compare `buddyinfo` higher orders (order 8+) before and after the incident window. Absolute free pages matter less than contiguous blocks.
- `echo 1 > /proc/sys/vm/compact_memory` is a test, not a permanent fix. Watch latency while it runs.
- Prefer fixing the consumer (disable THP for the workload, increase `vm.min_free_kbytes` carefully, or schedule a reboot) over constant compaction.
- In NUMA systems check per-node `buddyinfo`. One node can be fragmented while another is fine.
- Page cache and anonymous pages are both movable; unreclaimable kernel allocations are not. High unreclaimable slab reduces compaction success.

## Related Notes

- [[Memory Management]]
- [[Transparent Huge Pages]]
- [[NUMA and Memory Affinity]]
- [[Kernel Slab Memory]]
- [[Memory Pressure Runbook]]
- [[Performance Investigation Framework]]

## Personal Lessons Learned

- A database host with 40 % MemAvailable still logged order-9 allocation failures. THP defrag was set to `always`; switching the workload to `madvise` and a controlled reboot cleared the stalls.
- We watched `compact_stall` climb for two hours before any user-visible latency. Graphing the vmstat counters earlier would have given a warning.
- Rebooting “fixed” a mysterious latency problem three times. The fourth time we captured `buddyinfo` and recognised the pattern. Uptime policy became part of the capacity plan.
