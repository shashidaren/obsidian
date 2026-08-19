# pidstat Deep Dive

## Concept

`pidstat` (also from sysstat) attributes CPU, memory, I/O, and context-switch activity to individual processes or threads. It bridges the gap between system-wide symptoms (`top`, `vmstat`, `iostat`) and the responsible tasks.

## Why it matters

- `top` shows current consumers; `pidstat` can show rates over time and per-thread detail
- Excellent for finding which process is generating disk I/O or causing high context switches
- Works well in scripts and for capturing short-lived or intermittent behaviour

## Mental Model

```
pidstat = per-process / per-thread counters

- CPU: user, system, guest, wait
- Memory: RSS, VSZ, major/minor faults
- I/O: kB_rd/s, kB_wr/s, cancelled writes
- Context switches: voluntary vs non-voluntary
```

It samples periodically, so you see rates rather than only instantaneous percentages.

## Key Commands

```bash
# CPU activity for all processes, 1-second interval
pidstat 1

# CPU + show command name, only active processes
pidstat -l 1 5

# Per-thread view of a specific process
pidstat -t -p <PID> 1 5

# Disk I/O per process
pidstat -d 1 5

# Memory and page faults
pidstat -r 1 5

# Context switches
pidstat -w 1 5

# Everything for one PID
pidstat -urd -p <PID> 1 5

# All processes that did something (non-zero)
pidstat -l 1 5 | grep -v " 0.00 "
```

## Common Failure Modes & Symptoms

| Goal                              | Useful pidstat flags              | What to look for                     |
|-----------------------------------|-----------------------------------|--------------------------------------|
| Who is burning CPU?               | `pidstat -l 1`                    | High %usr or %system                 |
| Which process is doing heavy I/O? | `pidstat -d 1`                    | High kB_rd/s or kB_wr/s              |
| Memory leak / heavy faulting      | `pidstat -r 1`                    | Rising RSS, high majflt/s            |
| Lock or scheduling issues         | `pidstat -w 1`                    | High cswch/s or nvcswch/s            |
| Multi-threaded runaway            | `pidstat -t -p <PID> 1`           | One thread dominating                |

## Investigation Tips

- Start with system-wide tools (`top`/`vmstat`/`iostat`), then use `pidstat` to attribute the pressure to processes.
- `-d` (I/O) is especially valuable when `iostat` shows a busy device but you don’t yet know the culprit.
- For short-lived processes, a longer sampling window or `pidstat` in a loop helps; some processes appear and disappear between samples.
- On busy systems the output is noisy — pipe through `grep` or use `-p` to focus.
- Remember that I/O statistics require the process to be doing I/O through the page cache / block layer; some direct-I/O or mmap patterns show up differently.

## Related Notes

- [[top Deep Dive]]
- [[ps Deep Dive]]
- [[iostat Deep Dive]]
- [[vmstat Deep Dive]]
- [[High CPU Runbook]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
