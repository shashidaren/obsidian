# vmstat Deep Dive

## Concept

`vmstat` is a compact time series of the whole machine: run queue, blocked tasks, memory buckets, swap, block I/O, interrupts, context switches, and CPU breakdown. Use it when `top` told you “something is wrong” and you need to know *which resource* before you pick a per-process tool.

The first line is averages since boot. Throw it away. Everything after that is the interval you asked for.

## Why it matters

- `r` vs `b` is the fastest split between “wants CPU” and “stuck on I/O”
- `si`/`so` non-zero under load is memory pressure, even if `free` still shows cache
- `us`/`sy`/`id`/`wa`/`st` matches `top`’s header but in a pasteable column
- 20 lines of `vmstat 1` is a better page-one attachment than a screenshot of `htop`

If you only look at `free` during a slowness call, you will miss a run queue of 40 or a swap-out storm.

## Mental Model

```
procs          memory                         swap     io     system        cpu
r  b    swpd  free  buff  cache   si so    bi bo   in   cs   us sy id wa st
```

- `r` — runnable (includes running). Sustained `r` > CPU count → CPU saturation.
- `b` — uninterruptible sleep, almost always I/O (disk, NFS, iSCSI).
- `swpd` — swap used (bytes already paged out). Rising is interesting; `so` is urgent.
- `si`/`so` — pages swapped in/out *this interval*. Healthy hosts sit at 0/0 under load.
- `bi`/`bo` — blocks in/out. Units are blocks (often 1K); compare trends, not absolute “MB/s”.
- `in`/`cs` — interrupts and context switches per second.
- CPU columns sum to ~100. `st` only exists on guests.

`r` high + `id` high is unusual on bare metal; on VMs check steal and scheduling. `b` high + `wa` high is storage. `b` high + `wa` low can be NFS or a lock in D-state that is not block-layer wait.

## Key Commands

```bash
# The default you want during an incident
vmstat 1

# Bounded capture with timestamps (sysstat / recent procps)
vmstat -t 1 20

# Wide columns so big RAM numbers do not collide
vmstat -w 1 20

# Since-boot counters (use to confirm “have we ever swapped?”, not current rate)
vmstat -s

# Per-disk lines (complement iostat; format varies by version)
vmstat -d 1 5

# Slabs / memory objects when you suspect kernel bloat
vmstat -m | head
```

`vmstat 1 5` is five interval lines *plus* the boot line. Mentally drop line 1.

Active vs inactive / slab detail is `sar -r` or `/proc/meminfo`. `vmstat` is the triage strip, not the inventory.

## Common Failure Modes & Symptoms

| Pattern | Meaning | Next |
|---------|---------|------|
| `r` consistently > nproc | CPU saturated | `top -c`, `pidstat 1`, `perf` |
| `b` elevated, `wa` high | Block I/O bottleneck | `iostat -xz 1`, `pidstat -d 1` |
| `b` elevated, `wa` low | D-state that is not local disk (NFS, device mapper stall) | `ps -eo pid,stat,wchan:32,cmd \| awk '$2 ~ /D/'` |
| `so` > 0 and staying there | Live swap-out | `free -h`, OOM log, reclaim cache vs add RAM |
| `si` high after quiet swap-out | Working set coming back; latency already happened | Prevent the next `so` |
| `cs` hundreds of thousands / s | Wakeup storm, lock convoys, or too many threads | `pidstat -w 1`, `perf sched` |
| `in` exploding | Interrupt storm (NIC, storage) | `mpstat -I SUM 1`, `ethtool -S` |
| `st` rising | Hypervisor contention | Host-side metrics; do not retune the app first |
| `cache` collapsing, `free` not rising | Reclaim under pressure, not a leak by itself | Watch `si/so` and major faults |

## Investigation Tips

- Capture `vmstat 1` *while* the user still feels the problem. A calm `vmstat` after the spike proves nothing.
- Correlate `bo` spikes with journal/database checkpoints. A periodic `bo` burst is often fsync, not “disk dying”.
- On huge-RAM hosts `free` looks enormous while `r` and `wa` tell the real story. Do not declare healthy from the memory columns alone.
- Context switches need a baseline. 10k/s may be fine on a busy API node; 400k/s on a quiet batch box is not.
- Combine with `uptime` (load) and `nproc` so “`r` is 8” means something. Eight runnable on 2 CPUs is a queue; on 64 CPUs it is noise.
- `buff` vs `cache`: both are reclaimable-ish. Obsessing over the split rarely helps an incident; `si/so` and `wa` do.

## Related Notes

- [[top Deep Dive]]
- [[iostat Deep Dive]]
- [[pidstat Deep Dive]]
- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[High Load Low CPU]]
- [[CPU Scheduling and Load Average]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I used to panic at non-zero `swpd`. A host that swapped once at boot and then sits at `si/so = 0` is not in trouble. The rate columns are the alarm; the watermark is just history.
- A “high load” ticket with `r=0`, `b=12`, `wa=40` was NFS. `vmstat` saved an hour of CPU profiling. If `b` moves, go to storage/network before `perf`.
- Pasting `vmstat` without saying the interval is how you get someone “fixing” boot-average `wa` of 3%. Always write `vmstat 1` in the notes.
