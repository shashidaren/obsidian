# CPU Isolation and Affinity

## Concept

Linux schedules freely across all CPUs by default. For latency-sensitive or high-throughput workloads you can pin tasks to specific CPUs (`taskset`, `CPUAffinity=`, cpusets) or remove CPUs from the general scheduler entirely (`isolcpus`, `nohz_full`, `rcu_nocbs`).

Affinity is a soft preference. Isolation is a hard removal of those CPUs from the load balancer. The difference matters under load.

## Why it matters

- A database or packet-processing thread that migrates between cores pays cache and TLB warm-up costs. On a busy box that shows up as higher tail latency.
- Isolating CPUs for a real-time or DPDK-style workload stops the kernel from scheduling housekeeping or unrelated userspace on those cores.
- Containers and VMs often inherit the host’s full CPU set. Without a cpuset they can be moved under memory pressure or load balancing.
- Over-isolating leaves cores idle while other cores saturate. Measure before you reserve.

If the workload is latency-sensitive and you already ruled out lock contention and I/O, look at migration and remote NUMA before you add hardware.

## Mental Model

```
All online CPUs
    → isolcpus= / nohz_full= remove some from the load balancer
    → remaining CPUs are the general pool
    → a process can still be bound to isolated CPUs with taskset / cpuset

Affinity (soft)     CPUAffinity=, taskset -c, sched_setaffinity
Isolation (hard)    isolcpus, cgroup cpuset with exclusive, nohz_full
```

`isolcpus` is boot-time. cgroup cpusets are runtime and can be exclusive. Both stop migration; only the latter is easy to reverse without a reboot.

## Key Commands

```bash
# What is this process allowed to run on?
taskset -cp $(pidof myapp)
cat /proc/$(pidof myapp)/status | grep -E 'Cpus_allowed|voluntary'

# System-wide
lscpu
cat /sys/devices/system/cpu/isolated
cat /sys/devices/system/cpu/nohz_full

# Bind for a test
taskset -c 2,3 ./latency-test
# or
numactl --physcpubind=2,3 --membind=0 ./latency-test

# systemd unit
# CPUAffinity=2-3
# or a drop-in
systemctl show myapp -p CPUAffinity

# cgroup v2 cpuset (runtime)
echo 2-3 > /sys/fs/cgroup/myapp/cpuset.cpus
echo 1 > /sys/fs/cgroup/myapp/cpuset.cpus.exclusive
```

Boot parameters that are commonly paired:

```
isolcpus=2-5
nohz_full=2-5
rcu_nocbs=2-5
```

Confirm they took effect with the sysfs files above before you blame the application.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High voluntary context switches, latency spikes | process migrating | `taskset -cp`, `/proc/PID/sched` |
| Isolated CPUs still show load | something else bound, or isolcpus not applied | `/sys/.../isolated`, `ps -eo pid,psr,comm` |
| One core pegged, others idle after pinning | affinity too narrow or single-threaded bottleneck | `mpstat -P ALL`, thread count |
| Works on bare metal, worse in container | no cpuset, host load balancer moves it | cgroup `cpuset.cpus`, `CPUAffinity` |
| After reboot affinity gone | `taskset` was runtime only | unit file or cgroup config |
| `isolcpus` ignored | wrong syntax or overridden by later param | kernel cmdline, dmesg |

## Investigation Tips

- Start with `taskset -cp <pid>` and `cat /proc/<pid>/status`. If `Cpus_allowed` is the full set and the workload is latency-sensitive, try a temporary pin and measure.
- `isolcpus` is a blunt instrument. Prefer a cgroup cpuset with `cpuset.cpus.exclusive` when you can change it without rebooting.
- Pair CPU isolation with memory binding on NUMA systems. Pinning the CPU but leaving memory remote still costs.
- Housekeeping still runs somewhere. `nohz_full` and `rcu_nocbs` reduce timer and RCU noise on the isolated set; they do not remove all kernel threads.
- In Kubernetes, `cpuManagerPolicy: static` + guaranteed QoS gives exclusive CPUs. Without it the kubelet can still move the pod.
- Record the before/after latency numbers. Affinity changes that feel better in a microbenchmark can be noise under real load.

## Related Notes

- [[NUMA and Memory Affinity]]
- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Namespaces and cgroups]]
- [[systemd Units]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A packet-processing service had 99th-percentile latency that jumped whenever the box ran a backup. The threads were migrating. `CPUAffinity=` in the unit plus a cpuset for the backup job made the tail stable without buying faster NICs.
- I set `isolcpus` and forgot `nohz_full`. The cores were isolated from the load balancer but still took timer interrupts. The combination was what the vendor note actually required.
- A container without a cpuset looked fine until the node ran a large compile. The container’s threads moved to the busy cores and the SLA missed. The cgroup was the missing control, not more replicas.
