# Linux Architecture

## Concept

A running Linux system is a layered machine: hardware and firmware at the bottom, the kernel in privileged mode, and user-space processes that only reach hardware through system calls, device files, and well-defined APIs. Almost every production symptom is a *layer* problem wearing an application costume.

The kernel owns CPU scheduling, virtual memory, filesystems, networking, namespaces, cgroups, and drivers. User space owns init (systemd), libraries, daemons, shells, and applications. Crossing that boundary is a syscall (`open`, `read`, `write`, `clone`, `ioctl`, `mmap`, …).

## Why it matters

- The same user-facing error (“connection refused”, “slow”, “permission denied”) can originate in the app, libc, systemd, a cgroup limit, SELinux, the kernel, a driver, or the hypervisor.
- Restarting a service treats the *process* layer. If the fault is kernel, storage, or namespace, the restart will look like a fix and then repeat.
- Containers and VMs do not remove the model — they add more layers (guest kernel, container runtime, overlay FS, virtual NIC).
- You cannot debug what you cannot place. Architecture is the map; tools are the flashlight.

## Mental Model

```
Users / clients
        ↓
Applications and language runtimes
        ↓
Libraries (libc, NSS, OpenSSL, …)
        ↓
systemd / supervisors / containers
        ↓  syscalls, /proc, /sys, netlink
Linux kernel
  scheduler | mm | VFS | net | ns | cgroup | drivers
        ↓
Firmware / hypervisor / hardware
```

Useful overlays on that stack:

| Overlay | What it changes |
|---------|-----------------|
| Namespaces | What a process *sees* (PID, net, mount, UTS, IPC, user, time) |
| cgroups | What a process *may consume* (CPU, memory, I/O, PIDs) |
| LSM (SELinux/AppArmor) | What a process *may do* beyond DAC |
| Virtualization | Extra scheduler and I/O path below the guest kernel |

`/proc` and `/sys` are not “files”. They are kernel APIs mounted as filesystems. If they disagree with a userspace tool, believe the kernel interface and question the tool.

## Key Commands

```bash
# Where am I in the stack?
uname -a
cat /etc/os-release
systemctl is-system-running

# Kernel vs user-space first glance
uptime
cat /proc/loadavg
cat /proc/meminfo | egrep 'MemTotal|MemAvailable|SwapTotal|SwapFree'
cat /proc/cpuinfo | egrep 'processor|model name' | tail -4

# Failed units and kernel log (this boot)
systemctl --failed
journalctl -k -b -p err --no-pager | tail -50

# Syscall / library boundary when an app misbehaves
# (use on a *copy* of traffic or a single worker, not blindly in prod)
strace -f -tt -o /tmp/trace.out -p <PID>
lsof -p <PID>
ls -l /proc/<PID>/ns
cat /proc/<PID>/cgroup

# Hardware / virt layer
lsblk -f
ip -br link
systemd-detect-virt || true
cat /proc/cpuinfo | grep -i hypervisor || true
```

When you need the next layer down, do not start with tunables. Start with *which layer owns the resource*.

## Common Failure Modes & Symptoms

| Symptom | Layer that often owns it | First checks |
|---------|--------------------------|--------------|
| Process 100% CPU, host otherwise idle | App / runtime | `top -H -p`, app logs |
| High load, low `%us`, processes in `D` | Block I/O / NFS / kernel wait | `vmstat 1`, `ps -o stat,wchan` |
| “Permission denied” with correct mode/owner | LSM or mount options | `ausearch`, `aa-status`, `findmnt` |
| App cannot fork / accept | rlimit, cgroup pids, FD limit | `/proc/PID/limits`, `cgroup.controllers` |
| Packet never arrives in process | netfilter, routing, namespace | `ip netns`, `ss`, `nft`/`iptables` |
| Guest CPU idle but latency high | Hypervisor steal / noisy neighbour | `%st` in `top`, host metrics |
| “No such file” for a device that `lsblk` shows | udev, initramfs, namespace mount | `ls -l /dev`, `findmnt` |
| Container dies, node looks fine | cgroup memory / OOM in the *pod* | `dmesg`, `kubectl describe`, cgroup `memory.events` |

## Investigation Tips

- Write the stack on paper for the failing request: client → LB → app → syscall → kernel → device → remote. Tick the first layer that is *not* proven healthy.
- Compare a good host and a bad host at the *same* layer before changing config. Architecture bugs look like snowflakes until you diff `/proc`, mounts, and unit files.
- Do not tune `sysctl` because a blog mentioned it. Name the queue you think is overflowing, then prove it (`ss -m`, `vmstat`, `iostat`, `nstat`).
- In containers, there are two kernels’ worth of numbers if you are on a VM, but only one kernel. The *limits* are cgroup; the *truth* of hardware is the node.
- Firmware and RAID controllers fail like software: silent retries, rising latency, then a storm of I/O errors. `dmesg` is part of architecture, not an afterthought.
- If you cannot explain which process is waiting on which kernel object, you are guessing.

## Related Notes

- [[Processes and Threads]]
- [[CPU Scheduling and Load Average]]
- [[Memory Management]]
- [[Namespaces and cgroups]]
- [[Linux Boot Process]]
- [[systemd Units]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “Java is slow” ticket was 40% steal time. We spent a night in GC logs. Architecture first: guest CPU is not real CPU.
- Another outage was “disk full” with `df` showing space. The process was in a mount namespace that still had the old root. Same kernel, different view.
- I now treat `/proc/<pid>/{cgroup,limits,ns,status}` as the identity card of a process. `ps` is advertising; `/proc` is the passport.
