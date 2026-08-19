# vmstat Deep Dive

## Concept

`vmstat` (virtual memory statistics) gives a compact, system-wide time series of processes, memory, swap, I/O, system activity, and CPU. It is excellent for spotting trends that a single `top` snapshot can miss.

## Why it matters

- Reveals whether the system is CPU-bound, memory-bound, or I/O-bound
- Shows runnable vs blocked processes (key for “high load, low CPU”)
- Exposes swapping and context-switch rates
- One of the fastest ways to get a 30-second health snapshot

## Mental Model

```
vmstat columns (simplified):

r   = runnable processes (want CPU)
b   = blocked processes (waiting on I/O usually)
swpd / free / buff / cache  = memory picture
si / so  = swap in / swap out
bi / bo  = blocks in / out (disk)
in / cs  = interrupts / context switches
us / sy / id / wa / st  = CPU breakdown
```

High `r` → CPU demand. High `b` → I/O wait. Non-zero `so` → swapping (bad under pressure).

## Key Commands

```bash
# One summary line (since boot) + then 1-second samples
vmstat 1

# 5 samples at 1-second interval
vmstat 1 5

# Wider output (some versions)
vmstat -w 1 5

# With timestamps (useful for correlating with logs)
vmstat -t 1 10

# Disk-focused view (if available)
vmstat -d 1 5

# Slab info (advanced)
vmstat -s          # event counters since boot
```

Ignore the first line of output — it is averages since boot and often misleading.

## Common Failure Modes & Symptoms

| Pattern in vmstat                          | Meaning                              | Typical next tool          |
|--------------------------------------------|--------------------------------------|----------------------------|
| `r` consistently > number of CPUs          | CPU saturation                       | top / pidstat / perf       |
| `b` elevated, high `wa`                    | I/O bottleneck                       | iostat, iotop              |
| `so` > 0 and rising under load             | Swapping — memory pressure           | free, sar -r, OOM logs     |
| Very high `cs` (context switches)          | Possible lock contention or noisy wakeups | pidstat -w, perf           |
| High `st` (steal)                          | Hypervisor / noisy neighbour         | Check host metrics         |
| `r` high, `us`+`sy` low, `id` high         | Tasks runnable but not running? (rare, check) | —                          |

## Investigation Tips

- Run `vmstat 1` for at least 10–20 seconds during the problem. Trends matter more than any single sample.
- Correlate `b` and `wa` with `iostat` — vmstat tells you there is I/O pressure; iostat tells you which device.
- `si`/`so` should be near zero on a healthy system with enough RAM. Any sustained swapping under load is a red flag.
- High context switches (`cs`) with moderate CPU can indicate thrashing or excessive process wake-ups.
- Combine with `uptime` and `top` for a complete first picture.

## Related Notes

- [[top Deep Dive]]
- [[iostat Deep Dive]]
- [[pidstat Deep Dive]]
- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[High Load Low CPU]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
