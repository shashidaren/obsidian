# iowatcher and blktrace

## Concept

`blktrace` records block-layer events (queue, issue, complete, merge). `iowatcher` turns that trace into a timeline of latency, throughput, and queue depth. Together they answer “which process, which device, and which request sat in the queue for 200 ms”.

`iostat` averages. blktrace is the film.

## Why it matters

- Distinguishes device saturation from application batching.
- Shows if writes are sync or if the elevator is merging them away.
- Explains a latency spike that `iostat` averaged into “util 40%”.
- Lets you prove the disk was idle when the application claimed it was waiting.

## Mental Model

```
application write/read
    → page cache or direct
    → block layer (request queue)
        blktrace sees: Q (queued) → D (dispatched) → C (completed)
    → device

iowatcher plots:
    latency = C - Q (or D - Q)
    queue depth over time
    per-process bars
```

High queue depth + high latency = the device (or its path) is the bottleneck. Low queue depth + high application latency = the wait is elsewhere (locks, network, userspace).

## Key Commands

```bash
# Capture 30s on one device (needs root, debugfs)
blktrace -d /dev/sda -w 30 -o /tmp/sda

# Or the convenience wrapper
btrace /dev/sda

# Turn the binary trace into a movie
iowatcher -t /tmp/sda.blktrace.* -o /tmp/io.svg
# or HTML
iowatcher -t /tmp/sda.blktrace.* -o /tmp/io.html

# Live-ish summary without the movie
blkparse -i /tmp/sda.blktrace.0 | head

# Per-process
iowatcher -t /tmp/sda.blktrace.* -p postgres -o /tmp/pg.svg
```

Stop the capture cleanly (`Ctrl-C` or `-w`). Large traces fill `/tmp` fast on a busy disk.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `blktrace: No such file` | debugfs not mounted, or wrong device | `mount \| grep debugfs`, `lsblk` |
| Trace empty | device name is the partition, not the disk, or multipath path | trace the active path or the dm device |
| iowatcher “no events” | capture was too short or filters dropped everything | longer `-w`, check `blkparse` first |
| Latency looks huge but iostat is fine | you traced the wrong device (the backup disk) | `lsblk -o NAME,MOUNTPOINT`, confirm |
| SVG is a solid bar of writes | application is sync-flushing every small write | look at the process bar; check fsync pattern |
| Queue depth 1 and latency still high | single-threaded or device is serial (USB, some RAID) | compare to `iostat` await |
| Trace fills the disk | busy device, long capture, no `-w` | shorter window, bigger filesystem |

## Investigation Tips

- Start with `iostat -x 1` to pick the device and the time window. Then blktrace only that window.
- Trace the device the application actually uses. On multipath that is often the `dm-` device, not `/dev/sda`.
- `iowatcher`’s queue-depth plot is the first thing to look at. Depth stuck at the device’s max means you are limited by the device or its queue.
- A process that appears only in the “queued” phase and never completes is waiting on a lock or a barrier, not on the disk.
- Combine with `pidstat -d` or `iotop` to confirm which PID, then filter the trace.
- On NVMe the numbers are smaller; a 5 ms tail is still worth chasing. On spinning rust 50 ms can be normal for a random write.
- Do not leave blktrace running on a production database volume “just in case”. It adds measurable overhead under heavy IO.

## Related Notes

- [[I/O Schedulers and blk-mq]]
- [[fio and Storage Benchmarking]]
- [[Disk I/O and Latency]]
- [[iotop Deep Dive]]
- [[iostat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Device Mapper Multipath]]

## Personal Lessons Learned

- A “slow disk” ticket had queue depth 0 for the entire 60 s trace. The application was stuck in a userspace lock. blktrace ended the argument in ten minutes.
- I once traced `/dev/sda` while the database lived on a multipath `dm-3`. The trace was empty and I almost ordered new disks. Always confirm the device under the mount.
