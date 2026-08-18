# Memory Management

## Concept
Linux treats RAM as a shared resource used for:
- **Anonymous memory** (process heaps, stacks, etc.)
- **Page cache** (file contents)
- **Kernel structures** (slab, dentries, inodes, etc.)

The kernel aggressively uses free memory for caching. **Low “free” memory is normal** and does not by itself mean the system is under pressure.

## Why it matters
What actually matters for performance and stability is:
- How much memory is still **available** (can be reclaimed quickly)
- Whether the system is **swapping**
- Whether applications are experiencing allocation latency or OOM events

## Mental Model

```
Total RAM
├── Used by processes (RSS / anonymous)
├── Page cache + Buffers          ← can usually be reclaimed
├── Slab / kernel                 ← sometimes reclaimable
└── Truly free
```

**MemAvailable** (from `/proc/meminfo` or `free -h`) is the best single number to watch. It estimates how much memory is available for new allocations without swapping.

## Key Commands

```bash
# High-level view
free -h

# Detailed breakdown
cat /proc/meminfo

# Top memory consumers (RSS)
ps -eo pid,user,rss,cmd --sort=-rss | head -20

# Human-readable
ps -eo pid,user,rss,cmd --sort=-rss | awk 'NR==1{print; next} {printf "%s\t%s\t%.1f MB\t%s\n", $1,$2,$3/1024,$4}' | head -15

# Watch memory pressure over time
vmstat 1
watch -n1 free -h
```

## Common Failure Modes & Symptoms

| Symptom                        | Likely cause                          | First checks                     |
|--------------------------------|---------------------------------------|----------------------------------|
| High memory usage, system slow | True pressure or heavy swapping       | `free -h`, `vmstat`, OOM logs    |
| One process growing steadily   | Memory leak                           | `ps` over time, application logs |
| OOM killer triggered           | Allocation failed under pressure      | `dmesg`, `journalctl -k`         |
| High cache, low free           | Normal behaviour                      | Check MemAvailable, not free     |

## Investigation Tips

- Always look at **MemAvailable**, not just “free”.
- Correlate with swap activity (`si`/`so` in `vmstat`).
- Check for OOM events even if the system is currently stable.
- For containers / cgroups, also look at memory.current and memory.max.

## Related Notes

- [[Swap and OOM Killer]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
