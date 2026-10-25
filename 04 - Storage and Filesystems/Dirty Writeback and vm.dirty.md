# Dirty Writeback and vm.dirty

## Concept

Dirty pages are file-backed data that has been modified in RAM but not yet written to disk. The kernel writeback threads flush them. `vm.dirty_ratio` / `vm.dirty_background_ratio` (and the `_bytes` variants) control when processes start to block on writes and when background writeback starts.

A host can show lots of cache and still stall hard if dirty pages cannot be written fast enough. The classic symptom is high load, high `%wa` or iowait, and processes stuck in `D` state on write syscalls while `Dirty` in `/proc/meminfo` stays elevated.

## Why it matters

- Default dirty ratios assume a reasonably fast disk. On slow storage, NFS, or a throttled cloud volume, they let too much dirty data accumulate, then everything blocks.
- A single process doing a large write can fill the dirty limit and stall unrelated writers.
- Tuning dirty_* is a latency vs throughput trade-off. Lower ratios start writeback sooner and reduce stall risk; they can also reduce batching efficiency.
- `Dirty` stuck high with a dead or slow backing store is a classic "load average through the roof, CPU idle" incident.

## Mental Model

```
Process writes to a file
  → pages marked dirty in page cache
  → background writeback starts at dirty_background_ratio
  → process blocks at dirty_ratio (or dirty_bytes)

vm.dirty_background_ratio   (default ~10)  start background flush
vm.dirty_ratio              (default ~20)  block writers
vm.dirty_expire_centisecs   how long before a dirty page is old enough to write
vm.dirty_writeback_centisecs how often the flusher wakes

Bytes variants override the ratios when set.
```

## Key Commands

```bash
# Current dirty state
grep -E 'Dirty|Writeback|DirtyThresh|DirtyBackground' /proc/meminfo
# or just
grep Dirty /proc/meminfo

# Sysctl
sysctl vm.dirty_ratio vm.dirty_background_ratio
sysctl vm.dirty_bytes vm.dirty_background_bytes
sysctl vm.dirty_expire_centisecs vm.dirty_writeback_centisecs

# Who is writing
iotop -o
iostat -xz 1 5

# Processes in D state (often writeback or journal)
ps -eo state,pid,wchan:20,cmd | awk '$1 ~ /D/'

# Temporary (incident)
sysctl -w vm.dirty_ratio=10
sysctl -w vm.dirty_background_ratio=5
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Load high, CPU idle, Dirty high | writeback cannot keep up | meminfo Dirty, iostat, iotop |
| Processes stuck in D on write | hit dirty_ratio or journal/NFS | wchan, backing device latency |
| Fine until a large copy/backup | dirty limit too high for the disk | ratios vs device speed |
| NFS mount slow or hung, whole box stalls | writeback waiting on NFS | mount state, nfsstat, Dirty |
| After lowering ratios, more but smaller stalls | expected trade-off | monitor Dirty and latency |

## Investigation Tips

- `grep Dirty /proc/meminfo` during the stall. If it is large and not falling, writeback is the bottleneck.
- Confirm the backing device. Local SSD vs spinning disk vs NFS vs cloud volume changes what "too much dirty" means.
- `iostat -xz 1` and `iotop` name the device and the processes. High `await` or `%util` with rising Dirty is the pattern.
- Lowering `dirty_ratio` and `dirty_background_ratio` is a common mitigation on slow or shared storage. Persist it in sysctl.d and document why.
- Do not set the ratios to 1 unless you have measured. You can turn a throughput workload into a latency mess of constant small flushes.
- Journaling filesystems add their own writeback. A full journal or a slow journal device looks similar; check `iostat` on the journal device if separate.

## Related Notes

- [[Memory Management]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[sysctl and Resource Limits]]
- [[Filesystems and Mounts]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A backup job on an NFS-mounted volume pushed Dirty to several GB. Every other writer on the box stalled in D state. Lowering the dirty ratios and moving the backup to a dedicated window stopped the cascade.
- I have set `dirty_ratio=5` on a database host with slow storage and watched checkpoint latency improve because the kernel no longer let a huge dirty set build up before flushing.
