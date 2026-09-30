# High Load Low CPU

## Concept

Load average counts threads that are *runnable or uninterruptible* — not "how busy the ALU is". You can have load of 40 on an 8-CPU box while `mpstat` shows 85% idle if those threads are stuck in `D` (usually disk or NFS) or piled up behind a lock.

This note is the fork in the road from [[High CPU Runbook]]: if `%us+%sy` is modest and the box still feels dead, stop chasing userspace hot loops.

## Why it matters

- Adding vCPU does nothing when the queue is I/O
- NFS/iSCSI hangs present as "load through the roof, SSH almost frozen" — classic high-load, low-CPU
- Memory reclaim (`si`/`so`, kswapd) inflates load without a user process looking hot in `top`
- cgroup CPU throttling can leave the *node* idle while the *service* is queued
- Misreading this pattern burns the first hour on `perf` and flame graphs that will not help

## Mental Model

```
loadavg ≈  run-queue length averaged over 1/5/15 min
         + tasks in uninterruptible sleep (D)

                 ┌─ high %us/%sy  → [[High CPU Runbook]]
load high ──────────┤
                 └─ low %us/%sy
                       ├─ high %wa          → storage / NFS I/O
                       ├─ D-state pile-up   → same, plus hung remote FS
                       ├─ high si/so        → reclaim / swap
                       ├─ high %st          → hypervisor steal
                       ├─ high r, low wa    → wakeups, lock, or throttle
                       └─ load high, host fine → look at the dependency
```

Compare load to `nproc` (and to the *quota* if this is a container), not to folklore. Load 8 on 2 CPUs is saturated. Load 8 on 64 CPUs is idle.

`D` is uninterruptible. `kill -9` does not unstick it. The task is in the kernel waiting on I/O or a filesystem lock. Fix the waiter (storage, NFS server, dying disk) or fence the client.

## Key Commands

```bash
nproc
uptime
mpstat -P ALL 1 5
vmstat 1 10

# Who is not runnable in a useful way?
ps -eo pid,ppid,stat,wchan:24,pcpu,rss,args | awk '$3 ~ /D/'

# Storage
iostat -xz 1 5
grep -E 'Dirty|Writeback|NFS_Unstable' /proc/meminfo
lsblk -d -o NAME,ROTA,QUEUE,TRAN

# Remote FS
findmnt -t nfs,nfs4,cifs
nfsstat -c

# Memory pressure path
free -h
# si/so in the vmstat sample above

# After you have a PID
cat /proc/<PID>/wchan
cat /proc/<PID>/stack          # often names nfs_*, io_schedule, blk_*

# cgroup throttle (node idle, app queued)
cat /sys/fs/cgroup/$(awk -F: '{print $3}' /proc/<PID>/cgroup)/cpu.stat 2>/dev/null
# v1:
# grep nr_throttled /sys/fs/cgroup/cpu,cpuacct/.../cpu.stat
```

`wchan` / `/proc/PID/stack` distinguishes `nfs4_wait_event` from `io_schedule` from `rwsem_down`. That one file chooses the next note you open.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| High load, high `%wa`, few `D` | Busy disk, not hung | `iostat -xz` await / `%util` |
| High load, many `D`, SSH lags | Hung NFS/iSCSI or dying disk | `findmnt`, `dmesg`, storage path |
| High load, `si`/`so` > 0 steadily | Thrash | [[Memory Pressure Runbook]] |
| High load, `%st` high | Host oversubscribed | hypervisor metrics; do not tune the JVM |
| High `r` in vmstat, low `wa`, low `%us` | Quota, tiny steal, wakeup storm | `cpu.stat` throttled, `pidstat -w` |
| Load high only on 15-min, 1-min low | Incident already over | trust 1-min + live `vmstat` |
| `top` idle, app timeouts | Dependency off-box | do not force this pattern onto the host |
| One core 100%, summary idle | Averaging lie | `mpstat -P ALL`; [[High CPU Runbook]] |
| Load high inside pod, node idle | CPU quota | `throttled` periods, requests/limits |

## Investigation Tips

- Take `mpstat -P ALL 1 5` before you decide "CPU is idle". One pegged core plus 15 idle cores still averages to "low CPU" and is a different problem.
- `D` state cannot be `kill -9`ed. Killing the NFS client process does not unstick the kernel wait. Fix or fence the storage.
- On NFS: look at the *server* and the network RTT. The client load average is a symptom.
- Dirty / Writeback climbing while `%wa` is high means writers outrun the device. Throttle writers; do not add CPU.
- Container view: load relative to quota can look "high" while the node is idle. Check `cpu.max` / throttled periods before you resize the node.
- Do not reboot to clear load until `ps` / `wchan` / `iostat` are in the ticket. Rebooting an NFS client with a sick filer just moves the outage.
- Soft lockups and "task blocked for more than 120 seconds" in `dmesg` are this pattern written by the kernel. Capture the blocked task's stack from that message.

## Related Notes

- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[top Deep Dive]]
- [[Disk I/O and Latency]]
- [[NFS Troubleshooting]]
- [[Namespaces and cgroups]]
- [[Resource Requests and Limits]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst "high load" I have owned was 200+ on a 16-CPU web box with 90% idle. Every PHP-FPM worker was `D` on an NFS session mount. The filer had a dead disk. We spent twenty minutes sampling CPU.
- `vmstat` `r` vs `b` splits the room immediately: `b` is blocked. Glance at those two columns before `top`.
- Steal (`%st`) fooled us into an application incident channel. The host was live-migrating. Guest-side CPU tuning cannot fix steal.
- A Kubernetes service with a 100m CPU limit produced "high load" in the pod and a quiet node. `nr_throttled` was the whole story. We almost added nodes.
