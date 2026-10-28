# I/O Schedulers and blk-mq

## Concept

The Linux block layer queues requests before they are handed to a device driver. Current kernels use blk-mq (multi-queue). The I/O scheduler (mq-deadline, none, kyber, bfq) sits in that path and decides merging, ordering, and read/write priority.

## Why it matters

- On NVMe the hardware already has deep queues; an extra scheduler can add latency without benefit.
- On spinning disks or SATA SSDs a deadline scheduler prevents writes from starving reads.
- Changing the scheduler is a frequent "performance" change that is invisible in `%util` and obvious in application latency — or the reverse.

## Mental Model

```
application / filesystem
  → per-CPU software queues (blk-mq)
      → I/O scheduler
          mq-deadline : reads preferred, deadlines, good default
          none        : FIFO to hardware, preferred for many NVMe
          kyber       : latency targets, some SSDs
          bfq         : fairness, higher CPU, better for interactive/desktop
      → hardware dispatch queues
          → device
```

The scheduler is per-device and can be changed at runtime. It does not survive reboot unless a udev rule or kernel command line sets it.

## Key Commands

```bash
# Current scheduler (the one in brackets is active)
cat /sys/block/nvme0n1/queue/scheduler
cat /sys/block/sda/queue/scheduler

# Change until reboot
echo none > /sys/block/nvme0n1/queue/scheduler
echo mq-deadline > /sys/block/sda/queue/scheduler

# Rotational?
cat /sys/block/sda/queue/rotational

# Queue depth the block layer will allow
cat /sys/block/nvme0n1/queue/nr_requests

# Persistent udev example (adjust KERNEL match)
# /etc/udev/rules.d/60-iosched.rules
# ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
# ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/scheduler}="mq-deadline"
```

Kernel command line `elevator=mq-deadline` still works on many builds but udev is clearer.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Higher than expected await on NVMe | mq-deadline or bfq on a device that wants none | `cat .../scheduler`, try none, re-measure |
| Reads delayed behind large writes | none or bfq on a rotational device | switch to mq-deadline, watch await and aqu-sz |
| Latency changed after reboot | udev rule missing or wrong KERNEL match | scheduler value after boot, udev test |
| `%util` high, await and app latency fine | Normal for multi-queue NVMe | trust await + application metrics |
| "Optimization" made p99 worse | bfq or kyber on a server workload | revert, compare with fio or real traffic |
| No effect from scheduler change | Device is a virtio/cloud volume with its own limiting | hypervisor/volume metrics |

## Investigation Tips

- Record `iostat -xz 1` and the application latency metric for several minutes before and after any scheduler change. One-shot `dd` is not enough.
- On pure NVMe, start with `none`. On SATA SSD or HDD, start with `mq-deadline`.
- Change only the scheduler. Do not also raise `nr_requests` or move filesystems in the same window.
- Cloud and virtual disks often ignore or override the guest scheduler. Confirm whether the bottleneck is even in the guest block layer.
- After writing a udev rule, run `udevadm test /sys/block/nvme0n1` or reboot a test host before you roll it fleet-wide.
- BFQ is rarely the right choice on a database or latency-sensitive server; it spends CPU to be fair.

## Related Notes

- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[NVMe Operations]]
- [[fio and Storage Benchmarking]]
- [[SMART and Disk Health]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Moving an NVMe Postgres volume from mq-deadline to none reduced commit p99 by roughly 15 % under the production write mix. `%util` barely moved; `await` and the database's own histogram did.
- A udev rule copied from a desktop guide set bfq on every disk, including the database volumes. The server became latency-sensitive to background jobs it had previously ignored. Server defaults exist because interactive fairness is the wrong goal.
