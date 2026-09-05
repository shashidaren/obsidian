# pidstat Deep Dive

## Concept

`pidstat` (sysstat) attributes CPU, I/O, memory faults, and context switches to PIDs or TIDs as *rates over an interval*. `top` is a live scoreboard; `pidstat` is the same idea in columns you can log, grep, and compare across 5–10 seconds.

It only sees tasks that exist at sample time. Fork-heavy workers need a longer window or `execsnoop`-style tracing.

## Why it matters

- `iostat` names a device; `pidstat -d` names the process writing it
- `vmstat` shows a `cs` explosion; `pidstat -w` splits voluntary vs involuntary per task
- Thread view (`-t`) is how you find the one runaway pthread inside a well-named JVM/nginx
- Batch-friendly: no TTY, no interactive sort state, easy to attach to a ticket

If you stop at `top` you will miss processes that are I/O-heavy and barely show `%CPU`.

## Mental Model

```
pidstat samples /proc/<pid>/stat{,m} (and io) each interval

-u  %usr %system %guest %wait %CPU   — wait here is task iowait, not disk await
-r  minflt/s majflt/s VSZ RSS %MEM   — majflt/s is the one that hurts
-d  kB_rd/s kB_wr/s cccwr/s iodelay  — cancelled writes = page cache not flushed
-w  cswch/s nvcswch/s                — voluntary vs forced off-core
-t  same counters per TID
```

`%wait` in `pidstat` is time the task spent waiting for I/O while it wanted to run. It is not `iostat`’s `await`.

I/O numbers are what the process issued through the kernel accounting. Direct I/O shows up; some mmap dirtying shows up later as someone else’s writeback (`kworker`, `flush`).

## Key Commands

```bash
# CPU, command line, 1s
pidstat -l 1

# Active-looking lines only (rough)
pidstat -l 1 5 | awk 'NR==1 || $0 ~ /[1-9][0-9]*\.[0-9][0-9]/'

# One process, threads, full command
pidstat -t -l -p <PID> 1 5

# Who is hitting disk
pidstat -d -l 1 5

# Faults / RSS movement
pidstat -r -l 1 5

# Context switches
pidstat -w -l 1 5

# Combined for one PID (CPU + mem + I/O)
pidstat -urd -l -p <PID> 1 10

# All tasks including kernel threads (default already includes many k*)
pidstat -l 1 3 | grep kworker

# Children of a tree: pidstat does not walk a cgroup; use pgrep
pidstat -l -p $(pgrep -d, -f 'postgres:') 1 5
```

Need the sysstat package. On minimal images it is often missing; `ps` + `/proc/<pid>/io` is the fallback.

## Common Failure Modes & Symptoms

| Goal | Flags | What “bad” looks like |
|------|-------|------------------------|
| CPU culprit | `-l 1` | High `%usr` (app) vs `%system` (kernel/syscalls) |
| Disk culprit | `-d 1` | High `kB_wr/s` or `kB_rd/s`; `iodelay` climbing |
| Leak / reclaim | `-r 1` | RSS rising across samples; `majflt/s` > 0 under load |
| Scheduler / lock noise | `-w 1` | Huge `cswch/s` (blocking) or `nvcswch/s` (preempted) |
| One bad thread | `-t -p PID` | One TID owns the `%CPU` |
| “pidstat is empty” | interval too short / idle tasks omitted in your grep | Widen window; drop the `0.00` filter |
| Numbers disagree with `top` | different interval or threads vs process | Align `-t` and sample length |
| I/O not attributed to the app | writeback, md, nfsd | Also sample `kworker`, `nfsd`, `jbd2` |

## Investigation Tips

- Start system-wide (`top`/`vmstat`/`iostat`), then `pidstat` with the matching flag (`-u` / `-d` / `-w`). Do not start with `-urd` on a 2k-process host — the noise hides the signal.
- `-d` needs kernel I/O accounting. If every `kB_*` is zero on a clearly busy disk, check `sysstat` version and whether the work is in another PID (flush, journal).
- Major faults (`majflt/s`) during a latency spike mean the working set is hitting backing store — swap or file mappings. Pair with `vmstat si/so`.
- Voluntary switches (`cswch`) are normal for I/O-bound services. Involuntary (`nvcswch`) high on one task means it is CPU-hungry and getting preempted — usually the actual hot loop.
- In containers, run `pidstat` where the PIDs make sense. Host `pidstat -p <container-pid>` works if you use the host PID from `crictl inspect` / `docker top`.
- Do not parse column numbers blindly; `-l` shifts fields. Use the header line from *that* invocation.

## Related Notes

- [[top Deep Dive]]
- [[ps Deep Dive]]
- [[iostat Deep Dive]]
- [[vmstat Deep Dive]]
- [[High CPU Runbook]]
- [[Memory Pressure Runbook]]
- [[File Descriptors]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `pidstat -d` once showed almost nothing while `iostat` was on fire. The writes were `jbd2` and `kworker` from a burst of tiny fsyncs. The app was guilty; its PID was not the one with the `kB_wr/s`.
- A JVM “at 400%” was four GC threads. `pidstat -t -p` made the conversation with developers factual instead of “Java is hot”.
- I keep a 10-second `pidstat -urd -l` in the incident template. It survives Slack compression better than an `htop` screenshot and you can re-read it the next morning.
