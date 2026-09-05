# top Deep Dive

## Concept

`top` is a live sampler of kernel accounting: run queue, per-CPU time breakdown, memory/swap, and a process list sorted by whatever you last asked for. It is the fastest “is this host on fire, and who is holding the match?” view.

It is *not* a tracer. Short-lived processes vanish between samples. `%CPU` is “share of the last interval”, not a lifetime average. Treat one screen as a hypothesis; watch 30–60 seconds before you act.

`htop`/`btop` are nicer to drive. Keep `procps-ng` `top` in muscle memory — it is on every rescue image.

## Why it matters

- Separates user time, kernel time, iowait, idle, and steal in one glance
- Load average on the header is demand; `%CPU` in the list is who is running *now*
- Per-CPU (`1`) is how you catch “one core at 100%, fifteen idle”
- Batch mode (`-b`) is the only form that belongs in a ticket or a log

If you only open `top` and sort by memory on a CPU incident, you will chase the wrong process.

## Mental Model

```
header
  loadavg  = tasks wanting to run (or uninterruptible) over 1/5/15 min
  Cpu(s)   = us / sy / ni / id / wa / hi / si / st
  Mem/Swap = used vs available vs cached; swap used is a pressure flag

process rows
  %CPU  = % of *one* core over the last refresh (can be >100% with threads)
  %MEM  = RSS / physical RAM, not VSZ
  TIME+ = accumulated CPU, not wall clock
  S     = R running, S sleeping, D uninterruptible I/O, Z zombie, T stopped
```

`wa` high → storage or NFS. `st` high → hypervisor took the vCPU. `sy` high with modest `us` → kernel work, spinlocks, or packet path. `si`/`hi` high → interrupt storm.

Load average counts runnable *and* uninterruptible (`D`) tasks. High load + mostly `id` is waiting, not compute.

## Key Commands

```bash
# Better first screen: full argv, CPU sort, 1s refresh
top -c -o %CPU -d 1

# Snapshot for a ticket (ignore the “since last boot” feel of a single sample)
top -b -n 1 -o %CPU | head -40
top -b -n 3 -d 1 -o %CPU | sed -n '/^top -/,$p'

# One PID and its threads (H = threads as rows)
top -H -p <PID> -c -d 1

# Idle processes hidden; useful on a box with thousands of sleepers
top -i -c -d 1

# Specific user
top -u postgres -c

# Threads of one service by name is a job for pidstat/ps; top filters by PID
pgrep -d, -x nginx | xargs -I{} top -b -n 1 -p {}
```

Interactive keys that matter:

| Key | Action |
|-----|--------|
| `1` | Per-CPU lines |
| `P` / `M` / `T` | Sort CPU / memory / TIME+ |
| `H` | Threads on/off |
| `c` | Full command line |
| `i` | Hide idle |
| `W` | Write `~/.toprc` (do this once on a jump host) |
| `k` / `r` | Kill / renice — last resort, not first |

Always use `-c` until you have confirmed the binary *and* its argv.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| One process ≥100% on one core | Busy loop, hot request path, GC, or missing index | `top -H -p PID`; logs; `perf top -p` if allowed |
| Many workers at 20–40% | Traffic or fan-out, not one runaway | Parent service, upstream QPS, connection count |
| High `%wa`, modest `%us` | Disk or NFS | `vmstat 1`, `iostat -xz 1` |
| High `%st` | Noisy neighbour / oversubscribed hypervisor | Host metrics, migrate or resize; you cannot fix steal in-guest |
| High load, low `%us+%sy`, high `id` | Blocked on I/O, locks, or remote FS | [[High Load Low CPU]] |
| RSS climbing, swap `si/so` in vmstat | Leak or undersized heap | [[Memory Pressure Runbook]] |
| `D` state stuck | Uninterruptible I/O (often NFS/iSCSI) | `ps -o wchan,stat`; `lsof`; storage path |
| Process missing from `top` | Died between samples or filtered | `pidstat 1`, audit logs, `perf record -a` |
| `%CPU` “too low” for the load | Waiting, not running; or cgroup throttle | `cpu.stat` throttled, `pidstat -w` |

## Investigation Tips

- Watch one full 1-second cycle after pressing `1`. A single core at 100% with `id` 90% on the summary line is still a latency incident.
- `%MEM` is RSS. A process with huge VSZ and small RSS is mapped, not necessarily leaking.
- `TIME+` growing fast while `%CPU` looks modest means you sampled a lull. Sort by `TIME+` only for “who has been expensive since start”, not “who is expensive now”.
- In containers, `top` inside the pod sees only that PID namespace; `top` on the node sees host PIDs and *node* CPU, not the container limit. Check `cgroup` CPU quota before you declare “idle”.
- Do not kill from inside `top` on a production box unless you already know the blast radius. Copy the PID, confirm with `ps -fp`, then use the service manager.
- `top` itself can look busy on a 128-CPU host if you refresh too fast with threads shown. That is the tool, not the workload.

## Related Notes

- [[High CPU Runbook]]
- [[High Load Low CPU]]
- [[ps Deep Dive]]
- [[pidstat Deep Dive]]
- [[vmstat Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The incident that taught me to press `1` was a Python process “at 8%” on a 16-core VM. One thread was pegged; p99 latency was terrible. Process `%CPU` lied because it was averaged across idle cores.
- I stopped trusting a single `top -b -n 1` pasted into Slack. The first sample after start is often a startup spike or an empty interval. Three samples one second apart is the minimum evidence.
- High steal in `top` sent us down an application rabbit hole for an hour. The hypervisor was live-migrating. `st` is infrastructure; treat it as such before you tune the JVM.
