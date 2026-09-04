# Disk I/O and Latency

## Concept

Disk I/O is requests sitting in a queue, being serviced by a device (or by a hypervisor, RAID controller, or NFS server pretending to be a device). Applications feel **latency** (`await` / completion time), not throughput. A disk can be “busy” and still fine; a disk with a few very slow I/Os can ruin p99 while `%util` looks modest.

This note is the model. [[iostat Deep Dive]] is the primary meter.

## Why it matters

- “CPU idle, load high” is often uninterruptible sleep (`D` state) on slow I/O — see [[High Load Low CPU]]
- Databases, journals, and fsync-heavy apps convert storage latency directly into user latency
- Cloud and virtual disks hide shared contention. The guest `%util` is not the whole story
- Tuning the filesystem or the app before measuring `await` is how you spend a night on the wrong layer

If p99 jumped and `await` jumped with it, stop looking at Python.

## Mental Model

```
app write/read / fsync
    → page cache  (may absorb reads and delay writes)
        → elevator / blk-mq queues
            → device  (nvme, sd, virtio, dm, md)
                → real media or remote target

iostat /s:
  r/s w/s     request rate
  rkB/s wkB/s throughput
  aqu-sz      average queue depth
  await       queue + service, ms, per request
  %util       fraction of time the device had work

Saturation pattern: aqu-sz rising + await rising + app p99 rising
Busy-but-fine:      %util high, await flat, app latency flat
```

Read latency and write latency are different problems. fsync / `O_DIRECT` / barriers bypass the cache that makes `dd` look fast.

Layering matters: `dm` on `mpath` on `lun` on an array. Always identify which name in `iostat` is the one the app’s filesystem sits on (`lsblk`, `findmnt -T /path`).

## Key Commands

```bash
# Device view (skip the since-boot first line by using an interval)
iostat -xz 1 10

# Per-process I/O
pidstat -d 1 5
iotop -oPa                    # if installed; needs root

# Who is in D state (blocked on I/O)?
ps -eo pid,ppid,state,wchan:20,cmd | awk '$3 ~ /D/'
cat /proc/<PID>/wchan
cat /proc/<PID>/stack         # kernel stack; often names the fs or nfs bit

# Block layer / request queues (modern kernels)
cat /sys/block/<dev>/queue/scheduler
cat /sys/block/<dev>/queue/nr_requests
cat /sys/block/<dev>/queue/rotational

# Map path → device
findmnt -T /var/lib/pgsql
lsblk -o NAME,TYPE,SIZE,ROTA,SCHED,MOUNTPOINT
ls -l /dev/disk/by-id | head

# Latency histogram if bpf/bcc available
# biolatency-bpfcc 1 10

# Quick app-side confirmation: time a known fsync path
time dd if=/dev/zero of=/var/tmp/iowrite bs=1M count=256 conv=fdatasync
```

Do not use that `dd` on a production data filesystem except as a last-resort compare, and delete the file.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Load high, `%us`/`%sy` low, `%wa` high | Storage wait | `iostat -xz 1`, `ps` D-state, [[vmstat Deep Dive]] |
| `%util` ~100, `await` 20–200ms+ | Device saturated | Who writes (`pidstat -d`); RAID rebuild? snapshot? |
| `%util` modest, `await` spikes | Slow tail I/O, remote storage, noisy neighbour | Hypervisor/array metrics; not just the guest |
| Writes fast, fsync / commit slow | Cache hiding throughput; barrier cost | Measure with `fdatasync`, DB commit time |
| Only one mount slow | That volume’s backing store, not “the server” | `findmnt -T`, compare two mounts with `iostat` |
| Guest fine at 03:00, bad at 09:00 | Shared array / noisy neighbour / backup window | Array queue, snapshot jobs, [[Backup Strategy]] |
| After snapshot or backup | Copy-on-write amplification | Snapshot age/size; backup I/O class |
| NFS path | Network or server, not local disk | [[NFS Troubleshooting]]; `rpcinfo`, server `iostat` |
| New volume slower than old | Different disk type, encryption, queue depth | `ROTA`, instance volume type, `nr_requests` |

## Investigation Tips

- Always run `iostat` with an interval. The first sample is since boot and will lie.
- Convert units in your head: `await` of 20ms on a log device that fsyncs per commit is 50 commits/s best case. That is the capacity conversation.
- `%util` on NVMe multi-queue can sit high while latency stays good. Believe `await` and the application SLO together, not `%util` alone.
- Split “bytes/s” from “IOPS”. 200 MB/s sequential is easy; 5k small random writes is not the same disk.
- Check rebuilds, scrubs, snapshots, `fstrim` timers, and backup jobs before you blame the application release.
- On VMs, open a second window on the host or the cloud volume metrics. Guest tools cannot see a neighbour eating the same LUN.
- Page cache: a warm read workload can show almost no disk I/O and still be “disk bound” after a cache flush or a reboot. Compare cache hit behaviour (`/proc/meminfo` Cached, `sar -r`) with disk `r/s`.
- Change one thing. Raising `nr_requests` and switching scheduler and moving the WAL in the same change teaches you nothing.

## Related Notes

- [[iostat Deep Dive]]
- [[vmstat Deep Dive]]
- [[pidstat Deep Dive]]
- [[High Load Low CPU]]
- [[Performance Investigation Framework]]
- [[NFS Troubleshooting]]
- [[Filesystems and Mounts]]
- [[XFS Operations]]
- [[ext4 Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The most expensive I/O incident I worked was a “CPU problem” that was `await` of 300ms on a virtual data disk during snapshot consolidation. Guest CPU was bored. The hypervisor UI had the graph that mattered.
- `dd` to `/tmp` (tmpfs) has convinced more than one person that “disk is fine”. Time the write on the *same mount* the database uses, with `conv=fdatasync`.
- RAID rebuilds and cloud volume migrations show up as a mysterious multi-hour latency hump with no deploy in the window. Check storage jobs before you revert application code.
