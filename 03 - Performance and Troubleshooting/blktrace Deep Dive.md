# blktrace Deep Dive

## Concept

`blktrace` traces the block I/O path from the request queue to the device driver. It answers “what is the disk actually doing right now?” at a level `iostat` cannot. The output is event-based (queue, dispatch, complete) and can be turned into latency distributions or timelines.

It is heavy. Use it on a sick disk for seconds, not minutes.

## Why it matters

- `iostat` shows averages. blktrace shows the individual requests that make up the average.
- Helps distinguish “the disk is slow” from “the disk is busy with tiny random I/O” or “a single large write is stalling everything”.
- Pairs with `iowatcher` or `btt` to produce graphs and statistics for the ticket.
- Essential when a storage array or software RAID is involved and you need to see the requests leaving the host.

## Mental Model

```
app → page cache / direct I/O
  → block layer (request queue)
    → blktrace sees: Q (queued) → D (dispatched) → C (completed)
      → driver → device
```

Each request has a latency from queue to complete. High queue-to-dispatch latency means the device is saturated or the scheduler is holding requests. High dispatch-to-complete means the device or path is slow.

## Key Commands

```bash
# Short capture on one device (needs root)
blktrace -d /dev/sda -w 10 -o /tmp/sda
# Then convert
blkparse -i /tmp/sda

# Or live (very verbose)
blktrace -d /dev/sda -o - | blkparse -i -

# Statistics with btt (from blktrace package)
btt -i /tmp/sda

# iowatcher for a graph (if installed)
iowatcher -t /tmp/sda -o /tmp/io.svg
```

Filter to a specific process or range if the output is huge. Default is everything on that device.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Capture fills the disk | Left running, or busy device | `-w` seconds, monitor `df` |
| No events | Wrong device, or nothing is doing I/O | `iostat` first, correct major:minor |
| High Q2D latency | Device queue full or scheduler | Compare with `iostat` await |
| High D2C latency | Device or fabric slow | SMART, multipath, array logs |
| Permission denied | Not root, or tracefs not mounted | `mount | grep trace` |

## Investigation Tips

- Always start with `iostat -xz 1`. If the device is idle, blktrace will be empty and you wasted time.
- Capture for 5–10 seconds during the problem, not longer. The files grow fast.
- Look at the largest requests and the longest latencies first. A few multi-second completes explain the application timeouts.
- On multipath or LVM, trace the underlying device, not only the mapper.
- Save the trace files with the ticket. They are the evidence.

## Related Notes

- [[iostat Deep Dive]]
- [[Disk I/O and Latency]]
- [[I/O Schedulers and blk-mq]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A database “slow query” was a single 2-second D2C on a RAID member that was rebuilding. blktrace made the rebuild visible; iostat only showed elevated await.
- I once left blktrace running on a busy volume and filled /tmp. Short `-w` is non-negotiable.
