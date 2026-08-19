# top Deep Dive

## Concept

`top` (and its improved cousins `htop`/`btop`) gives a live, interactive view of processes, CPU, memory, and load. It is the first tool most admins reach for when a host “feels slow”.

## Why it matters

- Instant visibility into who is consuming CPU and memory right now
- Distinguishes user vs system vs iowait vs steal time
- Shows load average, uptime, and task counts in one screen
- Interactive sorting and filtering make it fast for triage

A single `top` snapshot is useful; watching it for 30–60 seconds is far more useful.

## Mental Model

```
top = live kernel process table + resource counters

Key lines at the top:
- load average (1/5/15 min) → demand for runnable work
- Tasks / Cpu(s) line → where time is spent
- Mem / Swap → pressure indicators

Process list = current consumers of CPU/memory
```

`%CPU` is per-core (can exceed 100% on multi-core). Load average is system-wide demand.

## Key Commands

```bash
# Classic top
top

# Better defaults: full command line, sort by CPU
top -c -o %CPU

# Batch mode (good for scripts / logging)
top -b -n 1 -o %CPU | head -30

# Focus on one process and its threads
top -H -p <PID>

# Update every 1 second, show only active processes
top -d 1 -i

# Useful interactive keys while top is running:
#   P  → sort by CPU
#   M  → sort by memory
#   T  → sort by time
#   1  → toggle per-CPU view
#   H  → toggle threads
#   c  → toggle full command line
#   k  → kill a process (use carefully)
#   q  → quit
```

Prefer `htop` or `btop` when available — colour, easier navigation, tree view, and better defaults.

## Common Failure Modes & Symptoms

| What you see in top              | Likely meaning                          | Next step                          |
|----------------------------------|-----------------------------------------|------------------------------------|
| One process at 100%+             | Runaway / busy loop / heavy worker      | Identify PID, check threads, logs  |
| Many processes sharing high CPU  | Traffic spike, shared library, or fan-out | Look at parent / service           |
| High `%wa` (iowait)              | Disk (or NFS) is the bottleneck         | Switch to iostat / vmstat          |
| High `%st` (steal)               | Hypervisor contention (VM)              | Check host / other VMs             |
| High load, low %CPU              | Waiting on I/O, locks, or network       | See [[High Load Low CPU]]          |
| Memory climbing, swap rising     | Memory pressure / leak                  | See Memory Pressure Runbook        |

## Investigation Tips

- Always watch for at least 20–30 seconds. Spikes are normal; sustained high usage is not.
- Press `1` to see per-CPU breakdown — helps spot single-core saturation.
- Use `-H` (threads) when a multi-threaded process is high; one bad thread can hide in the process total.
- Compare `%CPU` with load average. High load + low CPU usually means blocked tasks (I/O, locks).
- `top` samples; short-lived processes can be missed. Use `pidstat` or `perf` for finer detail.
- On containers/Kubernetes, remember the view is from the host (or the container’s cgroup limits).

## Related Notes

- [[High CPU Runbook]]
- [[ps Deep Dive]]
- [[pidstat Deep Dive]]
- [[vmstat Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
