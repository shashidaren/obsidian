# iostat Deep Dive

## Concept

`iostat` (from the sysstat package) reports CPU and device I/O statistics: throughput, utilisation, queue lengths, and latency-related metrics. It is the primary tool for deciding whether storage is the bottleneck.

## Why it matters

- High disk utilisation does not automatically mean “disk is too slow” — you need queue depth and service time
- Distinguishes read vs write pressure and which device is hot
- Essential companion to `vmstat` when `%wa` or blocked processes are elevated

## Mental Model

```
iostat shows, per device:
- tps          = transfers per second
- kB_read/s, kB_wrtn/s  = throughput
- %util        = percentage of time the device was busy
- await        = average wait time (queue + service) in ms
- aqu-sz       = average queue length

High %util + high await + rising aqu-sz = storage saturation
High %util but low await = device is busy but keeping up
```

## Key Commands

```bash
# Basic: CPU + devices, 1-second interval
iostat -xz 1

# Extended stats, human-readable, only active devices
iostat -dxz 1 5

# With timestamps
iostat -t -xz 1 10

# Specific devices only
iostat -xz sda nvme0n1 1 5

# Older-style output (still useful)
iostat -d -k 1 5          # KB/s
```

`-x` (extended) and `-z` (omit zero-activity devices) are almost always what you want.

## Common Failure Modes & Symptoms

| Symptom in iostat                     | Interpretation                         | Next actions                          |
|---------------------------------------|----------------------------------------|---------------------------------------|
| `%util` near 100%, high `await`       | Device saturated                       | Identify heavy processes (iotop, pidstat -d), check RAID/FS |
| High `await`, modest `%util`          | Occasional slow I/Os or queueing elsewhere | Check underlying storage, multipath, network (NFS) |
| High write throughput, rising `aqu-sz`| Write storm / fsync pressure           | Application logs, journal, database   |
| One device hot, others idle           | Unbalanced workload or single-disk bottleneck | LVM/RAID layout, mount options        |
| NFS mount shows high latency          | Network or remote server issue         | See [[NFS Troubleshooting]]           |

## Investigation Tips

- Always run with an interval (`iostat 1`) — the first report is since boot and can be misleading.
- `%util` is a useful signal but not a perfect measure of saturation on modern multi-queue devices; watch `await` and `aqu-sz` together.
- For NVMe and multi-queue devices, high concurrency can keep `%util` high while latency stays acceptable.
- Pair with `iotop` or `pidstat -d 1` to find which processes are generating the I/O.
- On virtual machines, the “device” may be a virtual disk whose real latency is determined by the hypervisor and shared storage.

## Related Notes

- [[vmstat Deep Dive]]
- [[Disk I/O and Latency]]
- [[Disk Full Runbook]]
- [[pidstat Deep Dive]]
- [[NFS Troubleshooting]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
