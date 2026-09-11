# Container Internals

## Concept

A container is **not** a lightweight VM. It is one or more ordinary Linux processes isolated by kernel features and given a private root filesystem view:

- **Namespaces** — what the process can *see* (PID, net, mnt, UTS, IPC, user, cgroup)
- **cgroups** — what the process can *use* (CPU, memory, PIDs, I/O)
- **Union / overlay filesystem** — layered image + thin writable layer that looks like a private `/`

From inside: "I am a small machine." From the host: "These are processes with special `/proc/<pid>/ns` and cgroup membership."

## Why it matters

- Most "container mysteries" are namespace, cgroup, or overlay problems wearing a Docker/K8s costume
- OOMKilled, "permission denied" on bind mounts, wrong DNS, and "no space left" inside a container are all explainable from these three mechanisms
- The same model applies to Docker, containerd, Podman, and Kubernetes — only the control plane that *sets* the namespaces and cgroups changes
- If you only know `docker run` flags, you cannot debug the cases where the runtime is healthy and the kernel is enforcing something you did not expect

## Mental Model

```
Host kernel (one)
├── Namespaces          isolation of view
│     PID, net, mnt, UTS, IPC, user, cgroup
├── cgroups             limits + accounting
│     memory, cpu, pids, io, ...
└── Processes
      private rootfs via OverlayFS (lower image layers + upper writable layer)
```

Important consequences:

- Same kernel, same system call table, same vulnerabilities class as the host
- `pid 1` *inside* the container is not host pid 1; signal handling and zombie reaping still matter
- Network namespace has its own interfaces, routes, and `/etc/resolv.conf` (unless hostNetwork)
- User namespace maps container UID 0 to an unprivileged host UID when enabled — file ownership on bind mounts becomes non-obvious

## Key Concepts & Host Commands

```bash
# Namespaces visible on the host
lsns
ls -l /proc/<PID>/ns
nsenter -t <PID> -n -p -m -- bash     # enter net/pid/mnt of a container process

# cgroup membership and limits (v2 example paths vary by distro)
cat /proc/<PID>/cgroup
cat /sys/fs/cgroup/system.slice/docker-<id>.scope/memory.max
cat /sys/fs/cgroup/system.slice/docker-<id>.scope/memory.current

# Overlay components (Docker / containerd)
docker inspect <container> --format '{{.GraphDriver.Data.UpperDir}}'
# or find upperdir/lowerdir/workdir from mountinfo
grep -E 'overlay|upperdir' /proc/<PID>/mountinfo

# Process view
docker top <container>
ps -o pid,ppid,user,args -C <entrypoint>
cat /proc/<PID>/status | grep -E 'NSpid|Uid|Gid|Cpus_allowed'

# What does the container think its IP / routes are?
nsenter -t <PID> -n -- ip addr
nsenter -t <PID> -n -- ip route
nsenter -t <PID> -n -- cat /etc/resolv.conf
```

Image layers are read-only. All writes go to the upperdir (or to a volume/bind mount that bypasses the overlay). Filling the upperdir produces "No space left on device" even when the host disk still has space.

## Common Failure Modes & Symptoms

| Symptom | Internal cause | First checks |
|---------|----------------|--------------|
| OOMKilled | cgroup memory max hit | `kubectl describe` / `docker inspect` limits; `memory.current` vs `memory.max` |
| Permission denied on bind mount | User namespace UID mapping vs host file owner | `ls -ln` on host; container `/proc/1/status` Uid |
| Container cannot reach network | Wrong netns, NetworkPolicy, or host firewall | `nsenter -t PID -n -- ip route`; compare with host |
| DNS works on host, fails in container | resolv.conf from runtime/CNI, not host | `cat` resolv.conf *inside* netns |
| "No space left" inside container | Writable layer full, not host disk | `df` inside; upperdir size on host |
| Process sees host PIDs / interfaces | hostPID / hostNetwork (or broken runtime) | `ls -l /proc/PID/ns` vs host init |
| Slow mass file writes | Overlay + small files, or diskquota on upper | Check whether workload should use a volume |
| Zombies pile up | Container pid 1 does not reap | Use tini/s6 or a proper entrypoint |

## Investigation Tips

- Always identify the **host PID** of the container's main process first. Everything else (`nsenter`, cgroup files, mountinfo) keys off that.
- Resource limits in Kubernetes (`resources.limits`) and Docker (`--memory`) become cgroup settings. If the runtime says Running but the app dies, read the cgroup and the kernel OOM log (`dmesg` / `journalctl -k`).
- Bind mounts ignore the image's UID layout. Match ownership to the **mapped** container UID, or run with a known uid and document it.
- `docker exec` / `kubectl exec` enter the namespaces; they do not prove what a *new* process started by the entrypoint would see. For boot-time failures, use logs and `nsenter` from the host.
- Overlay is fine for code and temp files; it is a poor fit for databases and heavy write workloads — use volumes.
- When moving between Docker and Kubernetes, assume the *isolation model* is the same and the *defaults* (network plugin, pid 1, securityContext) are not.

## Related Notes

- [[Namespaces and cgroups]]
- [[Docker Operations]]
- [[Podman Operations]]
- [[Kubernetes Architecture]]
- [[Resource Requests and Limits]]
- [[Pod Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first time I saw "No space left on device" with `df -h` on the host showing 40% free, the writable layer was a few GB and full of core dumps. `docker inspect` upperdir + `du` on that path ended the mystery.
- Bind-mounting a host directory owned by UID 1000 into a container that runs as UID 0 with user namespaces produced permission errors that looked like SELinux. It was the UID map. `ls -ln` on both sides is faster than guessing.
- `hostNetwork: true` made a debugging pod "fix networking". It also shared the host's ports and resolv.conf and taught me to never leave that on in production manifests.
- An app that trapped SIGTERM and relied on PID 1 reaping zombies worked in a VM and leaked zombies in a container until we added an init process. Pid 1 behaviour is part of the interface.
