# bpftrace

## Concept

bpftrace is a high-level tracer that compiles small scripts into eBPF programs and attaches them to kernel and user probes. It answers “show me every time this function runs, with these arguments, without stopping the process.”

Unlike `strace`, it does not ptrace-stop the target. Unlike `perf`, it can filter and print specific events (open path, TCP state change, bio latency) in one line.

## Why it matters

- A latency spike that `strace` would make worse can be observed with a one-liner that only fires on the slow path.
- You can count or histogram events (disk latency, syscall duration, lock hold time) with almost no overhead until the condition matches.
- It works on production kernels that have BPF enabled, which is most current distros.
- Scripts are short enough to paste into a ticket or a runbook.

## Mental Model

```
bpftrace script
    → BCC/libbpf compiles to eBPF
         → attaches to kprobe / uprobe / tracepoint / kfunc
              → kernel runs the program on each event
                   → prints or aggregates in userspace

probe:function / filter / { action }
```

Common probe types:
- `kprobe` / `kretprobe` — kernel function entry/return
- `tracepoint` — stable kernel events (`syscalls:sys_enter_openat`, `block:block_rq_complete`)
- `uprobe` — user function (needs symbols or offset)
- `interval` / `profile` — timed sampling

The kernel rejects programs that loop unboundedly or use too much memory. A script that fails to load is usually a verifier error, not a missing package.

## Key Commands

```bash
# Is BPF available?
bpftrace -l | head
ls /sys/kernel/debug/tracing/available_filter_functions | head

# One-liners
bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm, str(args->filename)); }'
bpftrace -e 'kprobe:vfs_read /comm == "postgres"/ { @[kstack] = count(); }'

# Histogram of block I/O latency
bpftrace -e 'tracepoint:block:block_rq_complete { @usecs = hist(args->nr_sector * 512); }'

# Count TCP connects by process
bpftrace -e 'kprobe:tcp_v4_connect { @[comm] = count(); }'

# Run a script file
bpftrace /usr/share/bpftrace/tools/biolatency.bt
```

Many distros ship example tools under `/usr/share/bpftrace/tools/`. Start there before writing your own.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `bpftrace: command not found` | Package not installed | `bpftrace` package, kernel headers sometimes needed |
| Program fails to load, verifier error | Loop, unbounded map, or old kernel | error text; simplify the script |
| No output | Filter never matches, or probe name wrong | `bpftrace -l 'kprobe:vfs_*'` |
| Permission denied | Not root, or BPF LSM / lockdown | id, `sysctl kernel.unprivileged_bpf_disabled` |
| High overhead | Probe on a very hot function with no filter | add `/comm == "..."/` or a rate limit |
| User stacks missing | No frame pointers or debuginfo | `--call-graph` equivalent, or use perf |
| Works on host, fails in container | Missing privileges or cgroup BPF | run from host namespace |

## Investigation Tips

- Prefer tracepoints over kprobes when one exists. Tracepoints survive kernel updates; kprobe names do not.
- Always filter (`/comm == "nginx"/`, `/pid == 1234/`) so you do not trace the whole system.
- Histograms (`hist()`) are better than printing every event when you care about latency distribution.
- Run for a bounded time. A bpftrace left attached over a weekend can fill the journal or a map.
- If the one-liner is getting long, put it in a `.bt` file in the ticket so the next person can re-run it.
- bpftrace will not replace a flame graph for “what is on-CPU”. Use it for “when does this rare path happen and with what arguments.”
- Test the script on a non-production box first if it attaches to a very hot function (`tcp_sendmsg`, `vfs_write`).

## Related Notes

- [[strace Deep Dive]]
- [[perf and Flame Graphs]]
- [[Performance Investigation Framework]]
- [[iostat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A biolatency histogram showed 99th-percentile reads at 80 ms while `iostat` average looked fine. The storage array was fine; one LUN was saturated. The histogram ended the “average latency is OK” argument.
- I attached a kprobe to `vfs_read` with no filter on a busy web server. CPU rose 15 %. Adding `/comm == "nginx"/` dropped the overhead to noise.
- Verifier rejected a script that looked correct because I used a map without a bound. Simplifying to a single `printf` got the data I needed for the ticket.
