# Namespaces and cgroups

## Concept

Linux **namespaces** give a process its own view of some kernel resource (PIDs, mounts, network, users, UTS, IPC, cgroup, time).  
**cgroups** (control groups) account for and limit CPU, memory, I/O, and PIDs for a process tree.

Containers are not a separate kernel feature. They are namespaces + cgroups + a filesystem view, orchestrated by a runtime.

## Why it matters

- Almost every “the container cannot see X / cannot use more than Y” ticket is namespaces or cgroups
- Resource limits explain sudden OOM kills inside an otherwise healthy host
- Mount and network namespaces explain why host tools and container tools disagree
- On Kubernetes nodes, the same mechanisms implement requests, limits, and QoS
- systemd slices use the same cgroup tree for host services — this is not “just Docker”

If you only look at host `top`/`free`, you will misdiagnose container problems.

## Mental Model

```
Process
  ├─ namespaces  → what it can *see*  (PID 1 inside the container, private netns, private /)
  └─ cgroups     → what it can *use*  (CPU quota, memory.max, io.max, pids.max)
```

A process can be in many namespaces at once. Children inherit them unless a runtime creates new ones.

Common namespaces:

| Namespace | Isolates |
|-----------|----------|
| `mnt`     | Mount table |
| `pid`     | Process ID tree |
| `net`     | Interfaces, routes, sockets |
| `uts`     | Hostname / NIS domain |
| `user`    | UIDs/GIDs mapping to the host |
| `ipc`     | SysV / POSIX IPC |
| `cgroup`  | cgroup root |

cgroup v2 (unified hierarchy under `/sys/fs/cgroup`) is what you should expect on current distros. v1 still appears on older hosts. Mixed nodes are a trap: the same controller name lives in a different path.

`memory.max` is a hard stop. Hitting it is an OOM *inside that cgroup*, even if `free -h` on the host looks comfortable. `cpu.max` is a quota (budget per period), not a nice suggestion.

## Key Commands

```bash
# What namespaces does this process belong to?
ls -l /proc/<pid>/ns
lsns
lsns -p <pid>

# Enter another process's namespaces (debug a container from the host)
nsenter -t <pid> -a /bin/bash          # all namespaces
nsenter -t <pid> -n ip addr            # just network
nsenter -t <pid> -m ls /               # just mount
nsenter -t <pid> -n ss -lntup

# cgroup v2: find a process's cgroup and its limits
cat /proc/<pid>/cgroup
CG=/sys/fs/cgroup$(awk -F: '{print $NF}' /proc/<pid>/cgroup)
echo "$CG"
cat "$CG/memory.max" "$CG/memory.current" "$CG/memory.events"
cat "$CG/cpu.max" "$CG/cpu.stat"
cat "$CG/pids.current" "$CG/pids.max"

# systemd slice view (host services)
systemctl status <unit>
systemctl show <unit> -p MemoryMax -p CPUQuota -p TasksMax

# Container / kube shortcuts
docker inspect <id> --format '{{.State.Pid}} {{.HostConfig.Memory}}'
crictl inspect <id>
# kube path varies by runtime and version — start from /proc/<pause-pid>/cgroup

# Who is hitting the memory limit on this node?
grep -R E 'oom_kill|max' /sys/fs/cgroup --include=memory.events 2>/dev/null | grep -v ': 0$'

# v1 vs v2?
stat -fc %T /sys/fs/cgroup
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Process OOM-killed, host still has free RAM | cgroup `memory.max` hit | `/proc/<pid>/cgroup`, `memory.events`, dmesg `Memory cgroup out of memory` |
| Container CPU capped while host is idle | `cpu.max` quota / CFS period | `cpu.max`, `cpu.stat` `throttled_*`, `docker stats` |
| “Cannot fork” inside container | `pids.max` | `pids.current` vs `pids.max` |
| Host `ss`/`ip` show nothing the app uses | App is in another netns | `lsns -t net`, `nsenter -t <pid> -n ss -lnt` |
| File exists on host, missing in container | Mount namespace / overlay | `nsenter -t <pid> -m findmnt` |
| Permission denied on a file the UID should own | User namespace UID map | `/proc/<pid>/uid_map`, `ls -n` |
| `iptables` rules on host do not match traffic | Traffic is in a pod/container netns or via veth/CNI | Inspect the *peer* netns, not only the host |
| Limit raised, still killed | Runtime did not apply; wrong cgroup; leak faster than you think | Re-read `memory.max` for the live PID |

## Investigation Tips

- Start from the PID you care about (`ps`, `crictl inspect`, `docker inspect`) and walk `/proc/<pid>/ns` and `/proc/<pid>/cgroup`.
- Host memory pressure and cgroup OOM are different events. Read the kernel log line; it names the cgroup.
- `nsenter` is safer and more precise than `docker exec` when the container image has no shell, or when you need host tools inside the container's netns/mnt.
- Kubernetes *requests* affect scheduling and (on cpu) how shares are divided. *Limits* are the hard cgroup caps. A pod with a memory limit will be killed at that cap even if the node has RAM left.
- Do not disable cgroups to “fix” an app. Raise the limit or fix the leak after you have evidence.
- On v1 vs v2 mixed nodes, controllers live in different trees. Check `stat -fc %T /sys/fs/cgroup` (`cgroup2fs` vs tmpfs + v1 mounts).
- After changing a kube limit, confirm the *running* cgroup file changed. YAML that did not roll out is a common false fix.

## Related Notes

- [[Processes and Threads]]
- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[Container Internals]]
- [[Resource Requests and Limits]]
- [[Pod Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A host that looks fine in `free -h` can still kill a container every few minutes. Always read the cgroup `memory.events` for that pod before resizing the node.
- I once “fixed” a CPU-starved API by adding nodes. `cpu.stat` already showed heavy throttling on a 200m limit. The app needed a limit change, not a bigger cluster.
- `docker exec` into a distroless image is a dead end. `nsenter -t <host-pid> -n` with host `ss`/`tcpdump` is how you debug the netns those images actually have.
- User-namespace mapped UIDs made a bind-mounted config “owned by root” inside and “owned by 100000” on the host. `ls -n` on both sides ended the chmod lottery.
