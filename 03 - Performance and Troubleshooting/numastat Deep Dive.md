# numastat Deep Dive

## Concept

`numastat` reports per-node memory statistics: how much memory is local vs remote, hits and misses, and (with `-p`) where a specific process’s pages live. It is the measurement tool that turns “this might be NUMA” into numbers.

It reads `/sys/devices/system/node/node*/numastat` and process memory maps.

## Why it matters

- Remote memory access is slower. A database or JVM whose buffer cache is on the other socket pays that tax on every miss.
- Automatic NUMA balancing can migrate pages and create latency spikes that look like application jitter.
- Containers and VMs frequently hide or ignore NUMA until you measure.
- `numastat -p` is the evidence you need before you pin with `numactl` or a cpuset.

If remote memory is a large fraction of the working set, affinity is worth fixing.

## Mental Model

```
Node 0          Node 1
local hits      remote hits
local miss      remote miss
...
```

Per-process (`-p`) shows anon, file, and other pages allocated on each node. A process that is scheduled on node 0 but has most of its anonymous memory on node 1 is the classic remote-memory case.

## Key Commands

```bash
# System-wide
numastat
numastat -m          # more detail (MemFree, MemUsed, etc.)

# Per process
numastat -p $(pidof postgres)
numastat -p <PID>

# Topology first
numactl -H
lscpu | grep -i numa
```

Interpretation: high `numa_miss` or a large remote fraction in `-p` output means the workload is crossing the interconnect.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Remote >> local for a busy process | Scheduled across nodes or memory not bound | `numastat -p`, `numactl -H` |
| Periodic latency spikes | Automatic NUMA balancing migrating pages | `numastat`, `kernel.numa_balancing` |
| One socket saturated, other idle | Poor affinity | `mpstat -P ALL`, `numastat` |
| Container slower than bare metal | No cpuset / topology manager | cgroup, `numastat -p` inside pod |
| After migration, worse performance | Topology changed or pages remote | `numactl -H`, `numastat -p` |

## Investigation Tips

- Run `numactl -H` then `numastat -p <main-pid>`. If remote is significant, pinning is the next experiment.
- For databases, vendor docs often specify the exact `numactl` or systemd `CPUAffinity`/`NUMAPolicy` settings.
- Measure before and after changing `kernel.numa_balancing`. It can help or hurt.
- In Kubernetes, topology manager + static CPU manager is required if you need guaranteed NUMA; otherwise the pod can be split.
- Cloud VMs may present a flat topology. Confirm with the provider before you assume NUMA is visible.

## Related Notes

- [[NUMA and Memory Affinity]]
- [[Memory Management]]
- [[CPU Isolation and Affinity]]
- [[High CPU Runbook]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Postgres buffer cache that was 70% remote explained a 30% performance gap versus a single-socket box. `numastat -p` was the proof; `numactl --membind` was the fix.
- Automatic balancing created 50 ms stalls under load. Disabling it and pinning removed the jitter.
- I now check `numastat -p` on any multi-socket database or JVM host before I declare the hardware “just slower”.
