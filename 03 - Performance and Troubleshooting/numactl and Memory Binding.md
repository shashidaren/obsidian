# numactl and Memory Binding

## Concept

`numactl` is the userspace tool that sets the NUMA policy for a process: which nodes it may run on and which nodes it may allocate memory from. It is the simplest way to pin a workload before you reach for cgroup cpusets or systemd `CPUAffinity=`.

The kernel’s default is “prefer local”. Explicit binding is how you stop a database or a JVM from paying the interconnect tax. See [[NUMA and Memory Affinity]] for the topology background.

## Why it matters

- A process that allocates on node 0 while its threads run on node 1 pays 1.5–2× memory latency on every miss.
- Automatic NUMA balancing can migrate pages under load and create latency spikes that look like application bugs.
- Containers inherit the host’s default policy unless you constrain them. A “flat” cgroup can still be split across sockets.
- Binding is often the cheapest fix once `numastat` has shown the problem.

If the same binary is slower on a bigger dual-socket box than on a single-socket box, bind it and re-measure.

## Mental Model

```
numactl --cpunodebind=0 --membind=0 -- ./app
    → process may only run on CPUs of node 0
    → all anonymous allocations come from node 0
    → file-backed pages still follow the normal cache policy

--interleave=all
    → round-robin allocations across nodes (sometimes better for large shared caches)

--preferred=0
    → prefer node 0, fall back if it is full
```

Binding is per-process (and inherited by children). It does not move existing pages; start the process under `numactl` or use `migratepages`.

## Key Commands

```bash
# Topology reminder
numactl -H

# Run a command bound
numactl --cpunodebind=0 --membind=0 -- postgres -D /data

# Show the policy of a running process
numactl --show
# or
grep -E 'Cpus_allowed|Mems_allowed' /proc/<pid>/status

# Move an existing process (best-effort)
migratepages <pid> 0-1 0

# systemd unit fragment
# [Service]
# ExecStart=/usr/bin/numactl --cpunodebind=0 --membind=0 /usr/bin/myapp
# or
# CPUAffinity=0-15
# (memory binding still needs numactl or a cpuset)
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High remote node access | no binding, scheduler spread the threads | `numastat -p`, `numactl -H` |
| `numactl: cannot bind` | node has no free memory or cgroup limit | `numastat -m`, cgroup memory.max |
| Process still shows remote pages | started without numactl; pages already allocated | restart under numactl, or migratepages |
| Latency spikes after enabling balancing | kernel migrating pages | `kernel.numa_balancing`, `numastat` over time |
| Container ignores host binding | no cpuset in the pod spec | `/proc/1/status` inside the container |
| Interleave slower than bind | workload is not large enough to benefit | measure both |

## Investigation Tips

- Measure first. `numastat -p $(pidof myapp)` before and after the bind. If remote drops and latency improves, keep it.
- `--membind` fails hard if the node cannot satisfy the allocation. `--preferred` is safer for processes that grow.
- File cache and shared libraries are not fully controlled by membind. A large page cache on the remote node can still hurt; consider `numactl` plus dropping caches only in a test window.
- In systemd, wrapping `ExecStart` with `numactl` is simple and survives restarts. `CPUAffinity=` alone does not bind memory.
- Kubernetes: `numactl` inside the container only sees the cpuset the runtime gave it. Set the topology manager or an explicit cpuset if you need node-local placement.
- After live migration or a host reboot, re-check. The node numbers can change if the BIOS enumerates sockets differently.

## Related Notes

- [[NUMA and Memory Affinity]]
- [[numastat Deep Dive]]
- [[CPU Isolation and Affinity]]
- [[Memory Management]]
- [[cgroups v2 Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Redis instance on a dual-socket host was fine until the working set exceeded one node’s cache. `numastat` showed 40 % remote. Binding to node 0 cut p99 latency in half with no code change.
- I set `CPUAffinity=` in the unit and declared victory. Memory stayed remote. Adding `numactl --membind` was the actual fix.
- An interleave policy on a small JVM made it slower. The heap fit on one node; round-robin just added interconnect traffic. Prefer-local or explicit bind won.
