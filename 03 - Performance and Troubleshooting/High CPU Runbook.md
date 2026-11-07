# High CPU Runbook

## Concept

High CPU means one or more cores are spending most of their time in user (`%us`) or system (`%sy`) mode. Load average may or may not be high. The first job is to decide whether a single process is hot, whether the kernel is hot, or whether the load is actually I/O or steal. This note is the high-CPU path; the high-load-low-CPU path is [[High Load Low CPU]].

## Why it matters

- Adding CPU does nothing if the hot process is single-threaded or stuck in a tight loop.
- Kernel time (`%sy`) high with low user time often means softirqs, spinlocks, or a driver.
- Steal time (`%st`) means the hypervisor is the problem; guest-side tuning cannot fix it.
- Sampling the wrong process wastes the first half-hour of the incident.

## Mental Model

```
High CPU reported
    → mpstat -P ALL 1 5
        → one core 100% → single-threaded or pinned
        → all cores high %us → userspace work
        → high %sy → kernel / softirq / lock
        → high %st → hypervisor
        → high %wa → not this note (see High Load Low CPU)
```

`top` / `htop` show the process; `perf top` or a short `perf record` shows the function. Do not start with a full flame graph on a production database unless you have already confirmed it is the right process and you can afford the overhead.

## Key Commands

```bash
# Is it really CPU?
uptime
mpstat -P ALL 1 5
vmstat 1 5

# Who is hot?
top -H -b -n 1 | head -30
ps -eo pid,ppid,pcpu,pmem,stat,wchan:16,args --sort=-pcpu | head
pidstat 1 5

# Per-thread if needed
top -H -p <PID>

# Kernel side
perf top -g
# or short sample (careful in prod)
perf record -g -p <PID> -- sleep 10
perf report

# Softirqs
cat /proc/softirqs
mpstat -I SCPU 1 5
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| One core 100%, others idle | Single-threaded hot loop or affinity | `mpstat -P ALL`, `taskset` |
| All cores high `%us` | Real work or busy loop | `top`, `perf top` |
| High `%sy`, low `%us` | Softirqs, locks, or driver | `/proc/softirqs`, `perf top` |
| High `%st` | Host oversubscribed | hypervisor metrics; do not tune guest |
| CPU high only in container | Quota or noisy neighbour | `cpu.stat` throttled periods |
| Sudden spike then gone | Cron, backup, or GC | `journalctl` around the time, `sar` |
| Load high but CPU low | Not this note | [[High Load Low CPU]] |

## Investigation Tips

- `mpstat -P ALL` before you believe “CPU is high”. One pegged core plus fifteen idle cores still averages to “moderate”.
- Identify the PID, then decide whether you need a stack. `perf top` is usually enough to see if it is in userspace crypto, a GC, or a kernel function.
- Do not `strace` a production database or a busy JVM without a clear hypothesis and a short timeout. The overhead can become the outage.
- Steal (`%st`) is not fixable inside the guest. Escalate to the hypervisor or cloud provider.
- cgroup CPU quota produces high CPU *inside* the container while the node looks idle. Check `throttled` periods before you resize the node.
- If the hot process is a known batch job, confirm it is supposed to be running now. Many “high CPU” pages are a backup or a report that started on schedule.
- Capture `ps`, `mpstat`, and a short `perf` or `pidstat` into the ticket before you kill anything. The evidence disappears with the process.

## Related Notes

- [[High Load Low CPU]]
- [[CPU Scheduling and Load Average]]
- [[mpstat Deep Dive]]
- [[perf and Flame Graphs]]
- [[Steal Time and Hypervisor Accounting]]
- [[Softirqs and NAPI]]
- [[CPU Isolation and Affinity]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first high-CPU page I owned was a single Java thread pegged at 100% on one core. `mpstat -P ALL` made that obvious; we had been looking at the average.
- I once spent twenty minutes in `perf` on a host that was 40% steal. The guest was innocent. The hypervisor was live-migrating other VMs.
- A “runaway process” turned out to be a legitimate analytics job that had been scheduled for that hour for months. Checking the cron and systemd timer history would have ended the call in two minutes.
