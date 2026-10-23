# NUMA and Memory Affinity

## Concept

NUMA (Non-Uniform Memory Access) means memory is attached to specific CPU sockets. Accessing memory on the local node is fast; crossing the interconnect is slower. The kernel tries to allocate local, but a process can still be scheduled on the wrong node or have its pages migrated.

`numactl`, `numastat`, and `/sys/devices/system/node` show the topology and where pages live.

## Why it matters

- A database or JVM that is CPU-bound on one socket but has its working set on the other socket pays a latency tax on every cache miss.
- Automatic NUMA balancing can migrate pages under load and create surprising latency spikes.
- Containers and VMs often ignore NUMA; the whole node looks flat until you measure.
- Binding a process and its memory to one node is sometimes the cheapest performance win.

If a workload is slower than a smaller box with the same core count, check NUMA before you buy more RAM.

## Mental Model

```
Socket 0                Socket 1
  CPU 0-15                CPU 16-31
  Node 0 memory           Node 1 memory
        \                   /
         Interconnect (QPI/UPI/Infinity Fabric)
```

Local hit: ~100 ns. Remote: 1.5–2× that. The kernel’s default policy is “prefer local”. `numactl --membind` or `cgroup` cpuset can force it.

## Key Commands

```bash
# Topology
numactl -H
lscpu | grep -i numa
cat /sys/devices/system/node/node*/cpulist

# Where are the pages?
numastat -p $(pidof postgres)
numastat -m

# Bind a process
numactl --cpunodebind=0 --membind=0 -- ./myapp
# or from systemd
# CPUAffinity=0-15
# or cgroup cpuset

# Interconnect traffic (if numastat or pcm available)
numastat
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High remote memory access | process scheduled across nodes | `numastat -p`, `lscpu` |
| Latency spikes under load | automatic NUMA balancing | `numastat`, kernel logs |
| One socket idle, other saturated | poor affinity | `mpstat -P ALL`, `numactl -H` |
| Container slower than expected | no cpuset, memory on remote node | `cat /proc/PID/status`, cgroup |
| After live migration, worse | guest sees flat or wrong topology | hypervisor NUMA config |

## Investigation Tips

- Start with `numactl -H` and `numastat -p <pid>`. If remote is a large fraction of total, affinity is worth fixing.
- For databases, pin the postmaster (or the instance) to one node and its memory. Many vendors document the exact `numactl` or systemd directives.
- Automatic NUMA balancing (`kernel.numa_balancing`) can help or hurt. Measure before and after.
- In Kubernetes, use `cpuManagerPolicy: static` and topology manager if you need guaranteed NUMA. Otherwise the pod can be split.
- Cloud VMs may present a flat topology even on multi-socket hosts. Check with the provider before you assume NUMA is visible.

## Related Notes

- [[Memory Management]]
- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Performance Investigation Framework]]
- [[Namespaces and cgroups]]
- [[CPU Isolation and Affinity]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Postgres instance on a dual-socket box was 30% slower than the same config on a single-socket machine. `numastat` showed most of the buffer cache on the remote node. `numactl --cpunodebind=0 --membind=0` fixed it with no hardware change.
- Automatic balancing turned a stable workload into one with periodic 50 ms stalls. Disabling it and pinning was quieter.
- A Kubernetes node with no topology manager put a latency-sensitive pod across both sockets. The cgroup cpuset was the missing piece.
