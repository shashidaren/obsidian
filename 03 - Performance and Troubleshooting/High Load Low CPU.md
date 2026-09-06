# High Load Low CPU

## Concept

Load average counts threads that are *runnable or uninterruptible* — not “how busy the ALU is”. You can have load of 40 on an 8-CPU box while `mpstat` shows 85% idle if those threads are stuck in `D` (usually disk or NFS) or piled up behind a lock.

This note is the fork in the road from [[High CPU Runbook]]: if `%us+%sy` is modest and the box still feels dead, stop chasing userspace hot loops.

## Why it matters

- Adding vCPU does nothing when the queue is I/O
- NFS/iSCSI hangs present as “load through the roof, SSH almost frozen” — classic high-load, low-CPU
- Memory reclaim (`si`/`so`, kswapd) inflates load without a user process looking hot in `top`
- Misreading this pattern burns the first hour of an incident on `perf` and flame graphs that will not help

## Mental Model

```
loadavg ≈  run-queue length averaged over 1/5/15 min
         + tasks in uninterruptible sleep (D)

                 ┌─ high %us/%sy  → [[High CPU Runbook]]
load high ─────┤
                 └─ low %us/%sy
                       ├─ high %wa          → storage / NFS I/O
                       ├─ D-state pile-up   → same, plus hung remote FS
                       ├─ high si/so        → reclaim / swap
                       ├─ high %st          → hypervisor steal (not guest CPU)
                       └─ high r, low wa    → too many wakeups, lock, or throttling
```

Compare load to `nproc`, not to a folklore number. Load 8 on 2 CPUs is saturated. Load 8 on 64 CPUs is idle.

## Key Commands

```bash
nproc
uptime
mpstat -P ALL 1 5
vmstat 1 10

# Who is not runnable in a useful way?
ps -eo pid,ppid,stat,wchan:20,pcpu,rss,args | awk '$3 ~ /D/'
ps -eo pid,stat,wchan:20,args | awk '$2 ~ /^D/'

# Storage
iostat -xz 1 5
cat /proc/meminfo | egrep 'Dirty|Writeback|NFS_Unstable'

# Open deleted files and blocked I/O (needs sysstat / iotop if present)
iotop -oP
lsblk -d -o NAME,ROTA,QUEUE,TRAN

# Remote FS
findmnt -t nfs,nfs4,cifs
nfsstat -c

# Memory pressure path
free -h
vmstat 1 5          # si/so columns

# After you have a PID
cat /proc/<PID>/stack          # kernel stack; often names the wait
cat /proc/<PID>/wchan
```

`wchan` / `/proc/PID/stack` is the fastest way to distinguish “stuck in `nfs_wait`” from “stuck in `io_schedule`” from “stuck in a mutex”.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| High load, high `%wa`, few `D` | Busy disk, not hung | `iostat -xz` await/`%util` |
| High load, many `D`, SSH lags | Hung NFS/iSCSI or dying disk | `findmnt`, `dmesg`, storage path |
| High load, `si`/`so` > 0 steadily | Thrash | [[Memory Pressure Runbook]] |
| High load, `%st` high | Host oversubscribed | hypervisor metrics; do not tune the JVM |
| High `r` in vmstat, low `wa`, low `%us` | Runnable but not getting time: cgroup quota, tiny steal, or wakeup storm | `cpu.stat` throttled, `pidstat -w` |
| Load high only on 15-min, 1-min low | Incident already over; you are looking at history | trust 1-min + live `vmstat` |
| `top` idle, app timeouts | Dependency off-box (DB, API); local load may be fine | do not force this pattern onto the host |

## Investigation Tips

- Take `mpstat -P ALL 1 5` before you decide “CPU is idle”. One pegged core plus 15 idle cores still averages to “low CPU” and is a *different* problem ([[High CPU Runbook]]).
- `D` state cannot be `kill -9`ed. Killing the NFS client process does not unstick the kernel thread. Fix or fence the storage.
- On NFS: look at the *server* and the network RTT. The client load average is a symptom.
- Dirty / Writeback climbing while `%wa` is high means you are generating more writeback than the device can drain. Throttle writers; do not add CPU.
- Container view: load inside a cgroup-limited container can look “high” relative to quota while the node is idle. Check `cpu.max` / throttled periods before you resize the node.
- Do not reboot to clear load until you have `ps`/`wchan`/`iostat` in the ticket. Reboot of an NFS client with a sick filer just moves the outage.

## Related Notes

- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[top Deep Dive]]
- [[Disk I/O and Latency]]
- [[NFS Troubleshooting]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst “high load” I have owned was 200+ on a 16-CPU web box with 90% idle. Every PHP-FPM worker was `D` on an NFS session mount. The filer had a dead disk. We spent twenty minutes sampling CPU.
- `vmstat` `r` vs `b` would have split the room immediately: `b` is blocked. I now glance at those two columns before `top`.
- Steal (`%st`) fooled us into an application incident channel. The host was live-migrating. Guest-side CPU tuning cannot fix steal.
