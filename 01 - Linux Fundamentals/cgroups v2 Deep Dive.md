# cgroups v2 Deep Dive

## Concept

cgroup v2 is the unified hierarchy under `/sys/fs/cgroup`. A process belongs to exactly one cgroup. Controllers (cpu, memory, io, pids, …) are enabled per subtree and enforce limits and accounting on that tree.

systemd, container runtimes, and Kubernetes all place workloads into this tree. The files you read (`memory.max`, `cpu.max`, `memory.events`) are the actual enforcement points.

## Why it matters

- An OOM kill with free RAM on the host is almost always a cgroup `memory.max` (or `memory.high`) event, not the global OOM killer.
- CPU throttling (`cpu.stat` `throttled_usec`) explains latency while the host looks idle.
- Mixing v1 and v2, or enabling controllers in the wrong place, makes limits appear to do nothing.
- PSI (Pressure Stall Information) is exposed per cgroup and is often the earliest signal of saturation.

## Mental Model

```
/sys/fs/cgroup/                  ← root (cgroup2fs)
  ├── system.slice/
  │     └── foo.service/          ← unit cgroup
  │           memory.max
  │           cpu.max
  │           memory.events
  └── user.slice/
        └── user-1000.slice/
```

Controllers are listed in `cgroup.controllers` and enabled for children via `cgroup.subtree_control`. A limit set on a parent applies to the whole subtree unless a child sets a tighter one.

Key files:

- `memory.max` / `memory.high` / `memory.current` / `memory.events`
- `cpu.max` (quota period) / `cpu.weight` / `cpu.stat`
- `io.max` / `io.stat`
- `pids.max` / `pids.current`

## Key Commands

```bash
# Hierarchy type
stat -fc %T /sys/fs/cgroup
# cgroup2fs = v2

# Process → cgroup
cat /proc/<pid>/cgroup
# 0::/system.slice/foo.service

# Limits and events for that cgroup
cat /sys/fs/cgroup/system.slice/foo.service/memory.max
cat /sys/fs/cgroup/system.slice/foo.service/memory.current
cat /sys/fs/cgroup/system.slice/foo.service/memory.events
cat /sys/fs/cgroup/system.slice/foo.service/cpu.max
cat /sys/fs/cgroup/system.slice/foo.service/cpu.stat

# systemd translation
systemctl show foo.service -p MemoryMax -p CPUQuota -p TasksMax -p IOAccounting

# Who is under pressure
find /sys/fs/cgroup -name memory.events -exec grep -H . {} \; | grep -v ': 0$'
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Process killed, host `free` shows RAM | `memory.max` reached; `oom_kill` in memory.events | cgroup path, `memory.events`, dmesg |
| Latency spikes, host CPU idle | `cpu.max` throttling | `cpu.stat` throttled_usec, `cpu.max` |
| “Cannot fork” / too many processes | `pids.max` | `pids.current` vs max |
| Limit change has no effect | Wrong cgroup, or subtree_control not enabled | re-read the live files for the PID |
| Mixed v1/v2 behaviour | Hybrid hierarchy or delegated controllers | `stat -fc %T`, mount table |
| I/O slower than expected inside a slice | `io.max` or parent weight | `io.stat`, `io.max` |
| systemd unit ignores MemoryMax= | Delegate= or controller not in subtree_control | systemctl show, cgroup.subtree_control |

## Investigation Tips

- Always start from the PID and read `/proc/<pid>/cgroup`, then the files inside that directory. Host-wide `free` or `top` will lie.
- `memory.events` `oom_kill` and `oom` counters are the definitive signal. A non-zero value means the cgroup, not the global killer, acted.
- CPU quota is `cpu.max` written as `$QUOTA $PERIOD` (microseconds). `throttled_usec` accumulating is the proof of throttling.
- After changing a unit file or a Kubernetes limit, confirm the running cgroup file actually changed. A failed rollout leaves the old limit in place.
- PSI files (`memory.pressure`, `cpu.pressure`, `io.pressure`) under the cgroup give early warning before hard limits fire. See [[Pressure Stall Information]].
- Do not move processes between cgroups by hand unless you understand the accounting consequences. Let systemd or the runtime own the tree.

## Related Notes

- [[Namespaces and cgroups]]
- [[Memory Pressure Runbook]]
- [[Pressure Stall Information]]
- [[systemd Units]]
- [[Resource Requests and Limits]]
- [[Swap and OOM Killer]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service was OOM-killed every few hours while the node had 40 GB free. `memory.events` showed `oom_kill 1` on its cgroup and `memory.max` was 2G. Raising the limit (after confirming the working set) stopped the kills; adding RAM to the node would not have helped.
- CPU latency alerts fired while `mpstat` showed idle cores. `cpu.stat` on the unit cgroup had millions of `throttled_usec`. The 100m limit was the cause.
- A hybrid v1/v2 node made `memory.max` appear under a different path than expected. `stat -fc %T /sys/fs/cgroup` and `findmnt` sorted out which hierarchy was actually enforcing.
