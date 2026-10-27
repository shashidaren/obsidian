# Pressure Stall Information

## Concept

Pressure Stall Information (PSI) reports how much time tasks spent stalled waiting for CPU, memory, or I/O over recent windows (some / full / 10s / 60s / 300s). It is exposed under `/proc/pressure/` and via cgroup controllers.

Unlike load average, PSI distinguishes *productive delay* from *contention*. A task that is runnable but waiting for a CPU shows CPU pressure. A task blocked in reclaim or thrashing shows memory pressure even if `si`/`so` is zero because anonymous pages are being scanned hard.

## Why it matters

- Load average mixes runnable and D-state threads; PSI isolates the resource that is actually scarce
- Memory pressure can be severe while free memory still looks fine (reclaim of cache, direct reclaim stalls)
- Container CPU quota throttling produces CPU pressure inside the cgroup while the node looks idle
- I/O pressure surfaces before `%util` or await hit "red" thresholds on multi-queue devices
- Alerting on PSI `some avg10` catches the onset of saturation earlier than load or wait%

## Mental Model

```
/proc/pressure/cpu
  some avg10=0.00 avg60=0.00 avg300=0.00 total=0

"some"  = at least one task stalled
"full"  = all non-idle tasks stalled (CPU has no "full")

avg10 / avg60 / avg300 = percentage of time in the window
total                  = cumulative microseconds of stall
```

CPU pressure is usually the easiest to interpret. Memory pressure `some` rising while `full` stays low means reclaim is working but expensive. `full` rising means the system is thrashing. I/O pressure tracks queueing and device saturation; it is not the same as `%wa`.

PSI is per-cgroup on cgroup v2. The node-level numbers are the aggregate; the service cgroup numbers are what the application actually experienced.

## Key Commands

```bash
# Node-level
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io

# Watch live (install psi or just loop)
watch -n1 'head -n1 /proc/pressure/{cpu,memory,io}'

# Per-service (cgroup v2)
cat /sys/fs/cgroup/system.slice/nginx.service/memory.pressure
cat /sys/fs/cgroup/system.slice/nginx.service/cpu.pressure
# path varies; find it from /proc/PID/cgroup

# Correlate
mpstat -P ALL 1 5
vmstat 1 10
iostat -xz 1 5
cat /proc/meminfo | grep -E 'MemAvailable|Dirty|Writeback|AnonPages'
```

`systemd-oomd` and `systemd-analyze` already consume PSI. `memory.pressure` in a unit file can trigger actions without a separate agent.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High load, low CPU%, rising memory PSI | Reclaim / thrash | `memory.pressure`, MemAvailable, `si`/`so` |
| App latency spikes, node CPU idle | cgroup CPU quota | service `cpu.pressure`, `cpu.stat` throttled |
| I/O PSI high, `%util` low | Multi-queue / remote storage | `iostat`, device queue depth, NFS/iSCSI |
| PSI files missing | Kernel < 4.20 or `CONFIG_PSI=n` | `uname -r`, `/proc/pressure` |
| Alerts fire, `top` looks fine | Short stalls averaged away | look at `avg10` not only `avg300` |
| Container PSI high, host low | Limits or noisy neighbour | cgroup path, `cpu.max`, memory high |
| `full` memory PSI climbing | Thrashing, OOM imminent | direct reclaim, `vmstat` si/so, oomd |

## Investigation Tips

- Prefer `avg10` for incident triage. `avg300` is for capacity trends.
- CPU pressure on a container with a small quota is expected under load; it is not a host problem.
- Memory PSI can rise from cache reclaim alone. Check whether the workload needs the cache (database buffer pool vs page cache).
- I/O PSI does not replace `iostat`. Use both: PSI tells you tasks stalled; iostat tells you which device and which queue.
- On cgroup v1 hosts PSI is node-only. Do not assume per-service numbers exist.
- `total` counters are useful for "did this get worse after the change" without relying on sampling windows.

## Related Notes

- [[High Load Low CPU]]
- [[Memory Pressure Runbook]]
- [[CPU Scheduling and Load Average]]
- [[Namespaces and cgroups]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[systemd-oomd]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service looked fine in `top` (low %CPU, modest RSS) while requests timed out. `memory.pressure` inside its cgroup showed sustained `some avg10 > 20`. The container memory limit was forcing continuous reclaim of the heap's file cache. Raising the limit (not the node) fixed it.
- Load average of 30 on a 16-CPU box with CPU PSI near zero and I/O PSI high was an NFS mount. We would have added CPUs if we had only looked at load.
