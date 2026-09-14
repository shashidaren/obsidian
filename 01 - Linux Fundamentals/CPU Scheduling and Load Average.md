# CPU Scheduling and Load Average

## Concept

The CFS scheduler (and, on newer kernels, EEVDF) decides which *runnable* tasks get a CPU. Load average is not utilization. It is the exponentially decayed average number of tasks that wanted a CPU *or* were stuck in uninterruptible sleep (`D` / TASK_UNINTERRUPTIBLE), over 1 / 5 / 15 minutes.

`uptime` reporting `load 8.00` on an 8-vCPU box does not mean “100% busy compute”. It means “on average eight tasks were either running, waiting to run, or blocked in D”. Those are different incidents.

Nice, cgroups CPU quota, and hypervisor steal all change *who gets time*. They do not change the fact that load counts waiters.

## Why it matters

- Misreading load as “need more cores” is the most expensive first guess in ops.
- High load + high `%id` is usually I/O, NFS, locks, or a dying disk — not a CPU buy.
- Per-CPU view matters more than the all-CPU average. One pegged core with 15 idle cores still wrecks a single-threaded request path.
- Containers lie twice: the guest sees host load if you look at the node, and `top` inside the pod does not see the quota that is throttling it.

## Mental Model

```
/proc/loadavg
  1.23  2.01  1.87  3/412  22841
  |     |     |     |      `— last PID
  1m    5m    15m   running/total threads

A task contributes to load when:
  R  — on a runqueue or currently executing
  D  — uninterruptible wait (disk, NFS, some locks)

A task does NOT contribute when:
  S  — interruptible sleep (most apps most of the time)
  Z  — zombie
  T  — stopped

nproc                    = capacity in cores
load / nproc             = rough saturation ratio
mpstat %us+%sy           = actual compute
mpstat %wa               = waiting on block I/O
mpstat %st               = hypervisor stole the vCPU
vmstat r                 = runqueue length *right now*
vmstat b                 = currently in D
```

Rule of thumb: load ≫ `nproc` *and* `%us+%sy` high → CPU saturation. Load ≫ `nproc` *and* `%id` high → waiters. Always split those two before you scale.

Nice (`-20`..`19`) is relative among *this host's* CFS tasks. A niced batch job still burns a core. Real isolation is a cgroup `cpu.max` quota, not nice.

## Key Commands

```bash
# Capacity vs demand
nproc
uptime
cat /proc/loadavg

# Runnable vs blocked *this second*
vmstat 1 10
# r = runqueue, b = blocked D, us/sy/id/wa/st as usual

# Per-CPU; never trust the rolled-up line alone
mpstat -P ALL 1 5

# Who is runnable or stuck
ps -eo pid,tid,user,stat,psr,pcpu,wchan:20,comm,args --sort=-pcpu | head -30
ps -eo pid,stat,wchan:20,comm | awk '$2 ~ /D/'

# Scheduler / throttle clues
grep -E 'nr_running|nr_uninterruptible' /proc/stat
# cgroup v2 throttle (on the node, find the scope first)
cat /sys/fs/cgroup/system.slice/<unit>/cpu.stat 2>/dev/null
cat /sys/fs/cgroup/$(awk '/cpu.max/{print}' /proc/<PID>/cgroup | cut -d: -f3)/cpu.stat 2>/dev/null

# Steal and guest view on a VM
grep -E 'cpu |ctxt|intr' /proc/stat
# %st lives in top / mpstat; you cannot fix it in-guest
```

`htop` is fine for a human. For a ticket, paste `uptime`, `mpstat -P ALL 1 3`, and `vmstat 1 5`.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Load ≈ nproc, `%us+%sy` high | True CPU saturation | `top -H`, `mpstat -P ALL`, hot code path |
| Load ≫ nproc, `%id` high, `%wa` high | Disk / NFS waiters counted in load | `iostat -xz 1`, `ps` D-state, `wchan` |
| Load ≫ nproc, `%id` high, `%wa` low | D-state that is *not* block I/O (NFS hang, some mutexes) | `ps -eo stat,wchan,cmd`; storage path; `echo w > /proc/sysrq-trigger` only if allowed |
| Load rising, `%st` climbing | Hypervisor oversubscribe or live migration | Host metrics; stop tuning the app |
| One CPU 100%, summary idle | Single-thread bottleneck | `top` key `1`; `psr` column |
| App latency high, host load low | Quota throttle, lock, or remote wait | `cpu.stat` `throttled_time`; app traces |
| Load high after cron / backup | Batch vs latency collision | nice/ionice is weak; isolate with cgroup or another host |
| Load 15m high, 1m already down | Incident is over; don't reboot “to clear load” | 15m is a trailing average |

## Investigation Tips

- Always write `load / nproc` in the ticket. “Load is 12” is meaningless without core count.
- Watch 1m vs 5m vs 15m. Rising 1m with falling 15m is a new event. The opposite is a hangover.
- `vmstat r` is the instant runqueue. If `r` is 0–2 and load is 40, the load is D-state history, not compute.
- `wchan` on D-state processes tells you *which wait*. `rpc_wait` / `nfs` vs `io_schedule` vs `md` vs `D` on a hung lock are different runbooks.
- In Kubernetes, node load includes every pod. Pod CPU `%` in `kubectl top` is against the *request/limit world*, not against `nproc`. Check `throttled_usec` before you add replicas for “CPU”.
- Softirq (`%si`) storms look like system time. That is packet path or NIC, not “the Java process is slow”.

## Related Notes

- [[High CPU Runbook]]
- [[High Load Low CPU]]
- [[Processes and Threads]]
- [[top Deep Dive]]
- [[vmstat Deep Dive]]
- [[pidstat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once ordered a larger instance because load was “24 on a 4-core box”. `vmstat b` was 20 and `%wa` was 70. The volume was a dying magnetic disk. New cores would have done nothing.
- A “low CPU” API outage was 100% of *one* core. The summary line said 6% user. Pressing `1` in `top` is cheaper than a war room.
- cgroup throttling produced perfect-looking host idle and terrible p99. Host load average is the wrong dashboard for a quota-limited pod.
