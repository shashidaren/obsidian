# iostat Deep Dive

## Concept

`iostat` (sysstat) reports CPU and *per-device* I/O: transfers, throughput, utilisation, average queue, and wait time. After `vmstat` says “blocked / wa”, `iostat` names the disk, the MD/LVM device, or the virtual volume.

Like `vmstat`, the first report is since boot. Use an interval. `-x` and `-z` should be muscle memory.

## Why it matters

- `%util` alone is not saturation on multi-queue NVMe; `await` and `aqu-sz` complete the picture
- Read storms and write/fsync storms look different (`rkB/s` vs `wkB/s`, `rareq-sz` vs `wareq-sz`)
- One hot member under LVM/RAID explains “the filesystem is fine but everything stalls”
- VM and NFS “devices” report guest-visible latency, which may be the network or the host

If you grow a volume because `%util` is 100% but `await` is 0.3 ms, you spent money on a disk that was keeping up.

## Mental Model

```
CPU line  — same idea as vmstat / top (us sy id wa st)

Device line (sysstat 11+ names vary slightly):
  tps / r/s / w/s     = request rate
  rkB/s / wkB/s       = throughput
  rareq-sz / wareq-sz = average request size (KB)
  aqu-sz              = average queue length (was avgqu-sz)
  await               = average time in queue + service (ms) per request
  r_await / w_await   = split by direction
  %util               = share of the interval the device had at least one request in flight
```

Saturation pattern: `await` rising, `aqu-sz` rising, throughput flattening.
Busy-but-healthy: `%util` high, `await` flat and low, throughput at expected sequential rates.

`await` is an average. A device can show 2 ms await while p99 is 200 ms. `iostat` will not show tail latency — use blktrace, application timers, or histogram metrics for that.

## Key Commands

```bash
# Default incident command
iostat -xz 1

# Five samples, human units where supported, timestamps
iostat -t -xz 1 5
iostat -h -xz 1 5          # if your sysstat has -h

# Named devices only (skip loop/ram)
iostat -xz sda nvme0n1 dm-0 1 10

# CPU omitted when you already have vmstat
iostat -dxz 1 10

# Older hosts: KB/s, no extended fields
iostat -dk 1 5

# Confirm package
rpm -q sysstat || dpkg -l sysstat
```

Device names: `sda` is the SCSI/SATA disk, `nvme0n1` the NVMe namespace, `dm-N` is LVM/multipath, `mdN` is software RAID. Always map:

```bash
lsblk -o NAME,TYPE,SIZE,MOUNTPOINT,MODEL
dmsetup ls --tree
```

## Common Failure Modes & Symptoms

| Symptom | Interpretation | Next |
|---------|----------------|------|
| `%util` ~100%, `await` tens–hundreds ms, `aqu-sz` > 1–2 | Device saturated | `pidstat -d 1`, `iotop -oPa`, check RAID rebuild |
| `%util` high, `await` < 1 ms on NVMe | Busy, not necessarily sick | Look at application RPS; maybe expected |
| High `await`, modest `%util` | Slow I/Os, path blips, or queueing *behind* this device | Multipath, SAN, hypervisor storage, NFS |
| `w_await` >> `r_await` | Write/fsync pressure, cache flush, dying disk | App checkpoints, `dirty` ratios, smartctl |
| Tiny `rareq-sz` + huge `r/s` | Random read storm (index miss, thundering herd) | Query plans, cache hit rate |
| Huge sequential `wkB/s`, short spike | Backup, compact, RAID resync | `cat /proc/mdstat`; change windows |
| Only `dm-*` hot, physical disk quiet in the same sample | You sampled the wrong layer or interval | Align devices with `lsblk` |
| NFS “disk” latency high | Network or remote server | [[NFS Troubleshooting]] |
| First line ugly, rest fine | Since-boot average | Ignore line 1 |

## Investigation Tips

- Map the mount to the device before you blame “disk”. `findmnt -T /var/lib/mysql` then `iostat` that name.
- Software RAID rebuilds pin `%util` and wreck `await`. Check `/proc/mdstat` and `mdadm --detail` early.
- Thin pools and snapshots add hidden write amplification. Guest `iostat` will not show the host’s extra I/O.
- `%util` on modern multi-queue devices can sit near 100% because *some* queue was busy, while other queues were idle. Prefer `await` + throughput vs known capability.
- Compare read vs write size. Databases doing 8–16K writes vs a backup doing 128K–1M look nothing alike; tuning one for the other fails.
- On VMs, “fixing” the guest scheduler will not fix a saturated datastore. Escalate with the `await` numbers; they are the evidence.

## Related Notes

- [[vmstat Deep Dive]]
- [[Disk I/O and Latency]]
- [[Disk Full Runbook]]
- [[pidstat Deep Dive]]
- [[NFS Troubleshooting]]
- [[LVM Deep Dive]]
- [[RAID Concepts]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once replaced a “slow disk” that had `%util` 98% and `await` 0.4 ms. The real problem was a single-threaded CPU path. Utilisation without wait time is not a verdict.
- RAID-1 rebuilds have paged me more often than failing media. `iostat` looked identical to “disk dying” until I opened `/proc/mdstat`.
- When `iostat` and the application disagree, the application is usually measuring a different layer (fsync, NFS RTT, or lock wait). Do not argue with `await`; add a layer to the model.
