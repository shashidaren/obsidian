# numactl Deep Dive

## Concept

`numactl` controls and queries NUMA policy for a process: which nodes it may run on and which nodes it may allocate memory from. It is the userspace tool that turns a `numastat` measurement into a binding.

It can also show the topology (`-H`).

## Why it matters

- Remote memory is slower. Binding a database or JVM to local memory removes a tax that looks like “the app is slow”.
- Automatic balancing can migrate pages and create latency. Explicit policy is more predictable.
- Containers and VMs often need an explicit policy because the scheduler does not know the application’s preference.

## Mental Model

```
numactl --membind=0 --cpunodebind=0 ./app
  → process may only allocate on node 0
  → process may only run on CPUs of node 0
```

`--interleave` spreads allocations. `--preferred` tries local first.

## Key Commands

```bash
# Topology
numactl -H

# Run bound
numactl --cpunodebind=0 --membind=0 postgres

# Show current policy of a running process
numactl --show
cat /proc/<PID>/numa_maps | head

# Interleave for a test
numactl --interleave=all ./workload
```

Systemd can do the same with `CPUAffinity=` and `NUMAPolicy=` / `NUMAMask=` in the unit.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No improvement after bind | Working set still remote or topology flat | `numastat -p`, `numactl -H` |
| Process fails to start | Node does not exist or cgroup restricts | `numactl -H`, cgroup |
| Latency spikes after enabling balancing | Automatic migration | `kernel.numa_balancing` |
| Container ignores host bind | No topology manager | Kubernetes topology manager |

## Investigation Tips

- Measure with `numastat -p` before and after. A bind that does not change the remote fraction did not help.
- Prefer systemd unit settings over wrapping the binary for long-running services.
- On cloud VMs confirm the topology is real before you spend time on binding.

## Related Notes

- [[NUMA and Memory Affinity]]
- [[numastat Deep Dive]]
- [[CPU Isolation and Affinity]]
- [[Memory Management]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Binding a JVM with `numactl --membind` removed a 15% throughput gap that had been blamed on the application code. numastat confirmed the pages were local afterwards.
- A bind to a node that the cgroup did not allow caused the process to fail at start. Check the allowed CPUs first.
