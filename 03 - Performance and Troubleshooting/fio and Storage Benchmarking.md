# fio and Storage Benchmarking

## Concept

fio is a flexible I/O benchmark and stress tool. It generates controlled workloads (sequential, random, mixed, with or without fsync) so you can measure latency, IOPS, and throughput of a block device, filesystem, or remote target under conditions that matter to the application.

It is not a substitute for production monitoring. It is how you answer "is this volume slow?" or "did the migration improve latency?" with numbers instead of feelings.

## Why it matters

- `dd` to `/tmp` (tmpfs) or without `fdatasync` lies about write latency.
- Cloud and virtual disks have variable performance; a baseline before and after a change prevents "it feels slower" arguments.
- Application p99 often tracks storage `await`. fio lets you reproduce the pattern (small random writes + fsync) that a database actually does.
- Wrong fio parameters (page cache, too little runtime, wrong iodepth) produce numbers that do not match production.

## Mental Model

```
fio job
  → opens file or raw device
  → issues reads/writes with chosen pattern, block size, iodepth, engine
  → optional fsync / fdatasync
  → reports latency percentiles, IOPS, bandwidth, CPU
```

Useful job patterns for sysadmins:

- Sequential read/write (large block) — bandwidth ceiling
- Random 4k read/write — IOPS ceiling
- Random 4k + fdatasync — commit latency (what databases feel)
- Mixed read/write with realistic iodepth

Always run long enough (30s+) and discard the first few seconds of cache warmup unless you intentionally want cold-cache numbers.

## Key Commands

```bash
# Install (package name varies)
# apt install fio / dnf install fio

# Quick sequential write bandwidth (careful with path)
fio --name=seqwrite --filename=/var/tmp/fiotest --size=1G --bs=1M --rw=write --direct=1 --runtime=30 --time_based --group_reporting

# Random 4k read IOPS
fio --name=randread --filename=/dev/nvme0n1 --size=10G --bs=4k --rw=randread --iodepth=32 --direct=1 --runtime=60 --time_based --group_reporting

# Database-like: random 8k write + fdatasync
fio --name=dbwrite --filename=/var/lib/pgsql/fiotest --size=2G --bs=8k --rw=randwrite --iodepth=1 --fsync=1 --direct=1 --runtime=30 --time_based --group_reporting

# Latency histogram focus
fio --name=lat --filename=/dev/sdb --rw=randread --bs=4k --iodepth=8 --direct=1 --runtime=30 --time_based --lat_percentiles=1 --group_reporting
```

Key flags:

- `--direct=1` bypasses page cache (O_DIRECT)
- `--fsync=1` or `--fdatasync=1` forces durability
- `--iodepth` controls outstanding I/Os (libaio engine)
- `--runtime` + `--time_based` for steady state
- Never point a destructive job at a production data file

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| fio numbers look great, app is slow | Test used page cache or wrong pattern | Add `--direct=1` and fsync; match app block size |
| Very low IOPS on NVMe | iodepth=1 or wrong engine | Raise iodepth, use libaio |
| Results vary wildly between runs | Cache, noisy neighbour, or too short | Longer runtime, discard first 10s, check array metrics |
| Write test fills disk | Size too large or no cleanup | Use smaller size, delete file after |
| "Disk is fine" but p99 is bad | Average latency hides tail | Look at 99th/99.9th percentile in fio output |
| fio saturates device, production collapses | Test during peak | Schedule maintenance window or use rate limit |

## Investigation Tips

- Match the pattern to the complaint. Sequential bandwidth tests do not explain random 8k commit latency.
- Compare against the volume's advertised IOPS/throughput (cloud) or previous baseline (on-prem).
- Run on the same mount and filesystem type the application uses. `/tmp` is often tmpfs.
- Pair fio with `iostat -xz 1` in another terminal so you see `await` and queue depth together.
- On VMs, also look at host or cloud volume metrics. Guest fio cannot see a noisy neighbour.
- After a storage migration or resize, take a short baseline before declaring success.

## Related Notes

- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[SMART and Disk Health]]
- [[High Load Low CPU]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A "storage is slow" ticket was resolved by showing fio random 4k + fsync latency of 40ms on a cloud volume that advertised 3ms. The volume type was wrong. The application metrics matched the fio numbers exactly.
- Running fio without `--direct=1` once convinced a team the new SAN was excellent. Production fsyncs were 10x slower. The page cache had been hiding the real device.
