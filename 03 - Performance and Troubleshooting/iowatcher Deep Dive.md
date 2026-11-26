# iowatcher Deep Dive

## Concept

`iowatcher` turns a blktrace capture into graphs: latency over time, IOPS, queue depth, and a timeline of individual requests. It is the visual companion to blktrace when numbers alone are hard to read.

It requires the blktrace package and a trace file.

## Why it matters

- A graph of latency spikes is easier to put in a ticket than a raw blkparse.
- Shows whether the problem is sustained high latency or a few outliers.
- Helps correlate with application timestamps.

## Mental Model

```
blktrace -d /dev/sda -w 10 -o /tmp/trace
iowatcher -t /tmp/trace -o /tmp/io.svg
```

The SVG shows the story; the raw trace remains the evidence.

## Key Commands

```bash
# Capture then graph
blktrace -d /dev/sda -w 15 -o /tmp/sda
iowatcher -t /tmp/sda -o /tmp/sda.svg

# With a movie (optional)
iowatcher -t /tmp/sda --movie
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No SVG | Missing dependencies or bad trace | `which iowatcher`, trace file size |
| Graph empty | No I/O during capture | iostat during the window |
| Huge SVG | Long capture | Shorter -w |

## Investigation Tips

- Capture only while the problem is visible. A quiet trace produces a boring graph.
- Include the SVG in the ticket along with the conditions (load, what the app was doing).
- Compare before/after when you change a scheduler or ring buffer.

## Related Notes

- [[blktrace Deep Dive]]
- [[iostat Deep Dive]]
- [[Disk I/O and Latency]]
- [[I/O Schedulers and blk-mq]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An iowatcher graph made a 800 ms outlier obvious that the average await of 12 ms had hidden. The application timeout matched the outlier.
- I now generate the SVG as a standard attachment for storage latency tickets.
