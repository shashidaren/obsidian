# bpftrace

## Concept

bpftrace is a high-level tracing language that compiles to eBPF. It is the fastest way to ask "how often does this happen, how long does it take, and with what arguments" without writing C or stopping the process.

## Why it matters

- One-liners answer the majority of "is this path even being taken" questions in an incident.
- Histograms and counts stay in the kernel; you do not stream every event to the terminal.
- It sits between strace (too heavy) and a full BCC tool (may not exist for your exact question).

## Mental Model

```
bpftrace -e 'probe /filter/ { action }'
    → attaches
    → filter evaluated in kernel
    → action (printf, count, hist, stack) runs only on matches
```

## Key Commands

```bash
bpftrace -l 'tracepoint:syscalls:*open*'
bpftrace -e 'tracepoint:syscalls:sys_enter_openat /comm == "nginx"/ { printf("%s\n", str(args->filename)); }'
bpftrace -e 'tracepoint:block:block_rq_complete { @us = hist(args->nr_sector * 512); }'
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Verifier error | Unbounded map or loop | simplify; check kernel version |
| No output | Filter or wrong probe | drop filter; `bpftrace -l` |
| Permission denied | caps or sysctl | run as root |

## Investigation Tips

- Prefer tracepoints over kprobes when one exists. Tracepoints survive kernel updates; kprobe names do not.
- Always filter (`/comm == "nginx"/`, `/pid == 1234/`) so you do not trace the whole system.
- Histograms (`hist()`) are better than printing every event when you care about latency distribution.
- Run for a bounded time. A bpftrace left attached over a weekend can fill the journal or a map.
- If the one-liner is getting long, put it in a `.bt` file in the ticket so the next person can re-run it.
- bpftrace will not replace a flame graph for “what is on-CPU”. Use it for “when does this rare path happen and with what arguments.”
- Test the script on a non-production box first if it attaches to a very hot function (`tcp_sendmsg`, `vfs_write`).

## Related Notes
- [[bcc and eBPF Tools]]

- [[eBPF Deep Dive]]
- [[strace Deep Dive]]
- [[perf and Flame Graphs]]
- [[Performance Investigation Framework]]
- [[iostat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A biolatency histogram showed 99th-percentile reads at 80 ms while `iostat` average looked fine. The storage array was fine; one LUN was saturated. The histogram ended the “average latency is OK” argument.
- I attached a kprobe to `vfs_read` with no filter on a busy web server. CPU rose 15 %. Adding `/comm == "nginx"/` dropped the overhead to noise.
- Verifier rejected a script that looked correct because I used a map without a bound. Simplifying to a single `printf` got the data I needed for the ticket.
