# Transparent Huge Pages

## Concept

Transparent Huge Pages (THP) let the kernel automatically promote 4 KiB pages to 2 MiB (or larger) pages without application changes. The goal is fewer TLB misses. The cost is allocation latency, memory fragmentation, and occasional stalls when the kernel tries to compact memory to form a huge page.

Controlled by `/sys/kernel/mm/transparent_hugepage/`.

## Why it matters

- Databases (especially MongoDB, Redis, some JVM workloads) historically saw latency spikes from THP compaction.
- Enabling or disabling THP system-wide can change application p99 latency by tens of milliseconds.
- madvise-based THP (or explicit hugetlbfs) is often safer than `always`.

## Mental Model

```
4 KiB pages → khugepaged / fault path tries to collapse into 2 MiB
  → success: fewer TLB misses
  → failure / compact: latency spike, or fall back to base pages

modes: always | madvise | never
```

`always` is aggressive. `madvise` only acts on regions the application marked. `never` disables THP.

## Key Commands

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag

# Current usage
cat /proc/meminfo | grep -i huge

# Per-process
cat /proc/PID/smaps | grep -i huge

# Temporarily change (until reboot)
echo never > /sys/kernel/mm/transparent_hugepage/enabled
# or
echo madvise > /sys/kernel/mm/transparent_hugepage/enabled
```

Persistent change is usually a systemd tmpfiles snippet or a tuned profile / kernel cmdline (`transparent_hugepage=never`).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Periodic latency spikes on DB | THP defrag / khugepaged | `enabled`, `defrag`, application docs |
| High compaction CPU | Aggressive THP + fragmented memory | `/proc/vmstat` compact_* , THP mode |
| Memory not returned after process exit | Huge pages still held | `HugePages_Total` in meminfo |
| Application recommends “disable THP” | Known bad interaction | Follow vendor guidance; prefer madvise if possible |

## Investigation Tips

- Check the current mode before blaming the application. `cat .../enabled`.
- Many modern databases want `madvise` or `never`. Confirm against the version you are running; advice from 2015 may be stale.
- If you disable THP, measure TLB miss rate (perf) and application latency before and after. The win is not guaranteed.
- `defrag` set to `defer+madvise` or `madvise` reduces the chance of synchronous compaction on the fault path.

## Related Notes

- [[Memory Management]]
- [[Memory Fragmentation]]
- [[NUMA and Memory Affinity]]
- [[Page Cache and Drop Caches]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Redis latency alert fired every few minutes. THP was `always` and khugepaged was compacting. Switching to `madvise` (Redis does not madvise huge pages by default) removed the spikes without a code change.
- On a memory-constrained VM, `always` THP caused allocation failures for 2 MiB pages that then fell back slowly. `never` was more predictable for that workload.
