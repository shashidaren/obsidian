# CPU Scheduling and Load Average

## Concept

The Linux scheduler decides which runnable tasks get CPU time.  
**Load average** is the average number of tasks that are either:
- Runnable (waiting for CPU), or
- In uninterruptible sleep (usually waiting for I/O)

over the last 1, 5 and 15 minutes.

It is **not** the same as CPU utilization percentage.

## Why it matters

High load average with low CPU % often means the system is stuck on I/O (disk, NFS, network), not that you need more CPU cores.  
Misreading load average is one of the most common troubleshooting mistakes.

## Mental Model

```
Load Average ≈ (tasks waiting for CPU) + (tasks in uninterruptible I/O wait)
```

- Load of 1.00 on a single-core system = fully busy
- Load of 4.00 on a 4-core system = fully busy
- Load significantly higher than number of CPUs = saturation / queuing

## Key Commands

```bash
# Classic view
uptime
cat /proc/loadavg

# Better real-time view
htop          # look at load and per-CPU bars

# Breakdown of what is using CPU
mpstat -P ALL 1 5

# See runnable vs blocked
vmstat 1 5
# r = runnable, b = blocked (uninterruptible)
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely meaning                        | First checks                  |
|--------------------------------------|---------------------------------------|-------------------------------|
| High load + high %CPU                | True CPU saturation                   | `top`, `mpstat`, process list |
| High load + low %CPU + high %wa      | I/O wait (disk / NFS / network)       | `iostat`, `vmstat`, `iotop`   |
| High load + many processes in D state| Processes stuck in uninterruptible sleep | `ps aux | awk '$8 ~ /D/'`   |
| Load rising slowly over hours/days   | Memory pressure → swapping or leak    | `free`, `vmstat`              |

## Investigation Tips

- Always compare load average against the number of CPUs (`nproc`).
- Use `vmstat` or `mpstat` to separate CPU time from I/O wait.
- Processes in **D** state (uninterruptible sleep) contribute to load but use almost no CPU.
- In containers/VMs also check steal time (`%st`).

## Related Notes

- [[High CPU Runbook]]
- [[High Load Low CPU]]
- [[Processes and Threads]]
- [[vmstat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
