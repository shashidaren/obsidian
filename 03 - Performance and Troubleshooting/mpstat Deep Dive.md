# mpstat Deep Dive

## Concept

`mpstat` (from sysstat) reports per-CPU (and per-softirq/interrupt) time breakdowns. It is the tool that turns “CPU is high” into “one core is saturated, the others are idle” or “steal is the problem, not the application”.

Unlike `top`, it is easy to run in a bounded, timestamped, pasteable form and it is already on most servers that have sysstat.

## Why it matters

- Per-CPU view catches hot cores that process-level `%CPU` averages hide.
- `%steal` (`%st`) is visible immediately — noisy-neighbour or oversubscribed hypervisor.
- Softirq and hardirq columns point at packet or storage interrupt storms before you open `perf` or `ethtool`.
- Historical `sar -P ALL` uses the same counters; `mpstat` is the live version.

If you only look at the aggregate CPU line, you will miss a single-thread bottleneck.

## Mental Model

```
CPU  %usr %nice %sys %iowait %irq %soft %steal %guest %gnice %idle
```

- `%usr` / `%sys` — application vs kernel.
- `%iowait` — CPU idle while a process was in uninterruptible I/O (not “disk is slow” by itself).
- `%irq` / `%soft` — interrupt and softirq time.
- `%steal` — hypervisor took the vCPU. Guest cannot fix this by tuning.
- `%idle` — remaining.

`mpstat -P ALL` shows every CPU. A summary line at the bottom is the average. Sustained 100% on one CPU with the others near idle is a latency incident even if the average looks fine.

## Key Commands

```bash
# Live, 1-second samples, all CPUs
mpstat -P ALL 1 10

# Just the summary (faster to scan)
mpstat 1 5

# Interrupts and softirqs (when in/cs explode in vmstat)
mpstat -I SUM 1 5
mpstat -I CPU 1 5

# Historical (same counters as sar)
sar -P ALL -f /var/log/sa/sa08
```

First line of a live run is since boot on some versions; subsequent lines are the interval. Prefer a few samples over a single snapshot.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| One CPU at 100%, others idle | Single-threaded hot path, lock, or affinity | `top -H`, `perf top`, `taskset` |
| `%steal` high | Hypervisor contention or live migration | Host metrics, do not retune guest first |
| `%iowait` high, `%usr` low | Storage or NFS | `iostat -xz`, `vmstat` `b` column |
| `%soft` or `%irq` high | NIC or storage interrupt storm | `ethtool -S`, `mpstat -I`, irqbalance |
| Average CPU looks fine, p99 terrible | Hot core or scheduler imbalance | `mpstat -P ALL` |
| Numbers do not match `top` | Different interval or boot average | Explicit `1` interval, ignore first line |

## Investigation Tips

- Always run `mpstat -P ALL` at least once during a CPU incident. The average line is not enough.
- Correlate high `%steal` with `vmstat` `st` and the hypervisor. Guest tuning will not help.
- `%iowait` is not a disk utilisation metric. Pair it with `iostat` `await` and `util`.
- On a 64-CPU host, pipe to `less` or sample a few seconds; the output is wide.
- `sar -P ALL` is the historical version. If you needed it after the fact, the collector must have been running.

## Related Notes

- [[top Deep Dive]]
- [[vmstat Deep Dive]]
- [[sar and sysstat]]
- [[pidstat Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[irqbalance and Interrupt Affinity]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “CPU at 40%” ticket was one core pegged by a single Python thread. `mpstat -P ALL` showed it in the first sample; process `%CPU` had averaged it across idle cores.
- High `%steal` during a migration looked like application regression. Checking the hypervisor first would have ended the call.
- I now default to `mpstat -P ALL 1 5` whenever `top` shows elevated CPU but no obvious single process.
