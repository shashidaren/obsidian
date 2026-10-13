# ftrace Deep Dive

## Concept

ftrace is the kernel’s built-in function tracer. It can record every kernel function call (function tracer), only those matching a filter (function_graph), or specific tracepoints and kprobes. The interface is the debugfs (or tracefs) files under `/sys/kernel/tracing`.

It is lower-level than `perf` and `strace`. Use it when you need to see kernel path, scheduling, or a specific function that userspace tools cannot reach, and when you can tolerate the overhead on a non-critical box or for a short window.

## Why it matters

- Explains “why is this process in D state?” or “which kernel function is spinning?” when `perf` is too coarse and `strace` only sees the syscall boundary.
- Tracepoints (e.g. `sched:sched_switch`, `block:block_rq_issue`) give structured events with almost no code change.
- Essential for confirming a suspected kernel bug or a missing tracepoint before you escalate to a vendor or write a bpftrace script.
- Overhead can be significant with the function tracer; never leave it enabled on a production database or latency-sensitive service.

## Mental Model

```
/sys/kernel/tracing/
  current_tracer     (nop, function, function_graph, ...)
  set_ftrace_filter  (which functions)
  set_event          (which tracepoints)
  tracing_on         (master switch)
  trace              (human-readable buffer)
  trace_pipe         (live stream)

Typical flow:
  echo nop > current_tracer
  echo function_graph > current_tracer
  echo 'do_sys_open*' > set_ftrace_filter
  echo 1 > tracing_on
  # reproduce
  echo 0 > tracing_on
  cat trace
```

The buffer is per-CPU and finite. If you see “lost events” you either filtered too little or the buffer was too small.

## Key Commands

```bash
# Mount (usually already done)
mount -t tracefs tracefs /sys/kernel/tracing

# Available tracers and events
cat /sys/kernel/tracing/available_tracers
cat /sys/kernel/tracing/available_events | head

# Function graph of open*
echo nop > /sys/kernel/tracing/current_tracer
echo function_graph > /sys/kernel/tracing/current_tracer
echo 'do_sys_open*' > /sys/kernel/tracing/set_ftrace_filter
echo 1 > /sys/kernel/tracing/tracing_on
# ... reproduce ...
echo 0 > /sys/kernel/tracing/tracing_on
cat /sys/kernel/tracing/trace | head -100

# Tracepoint example (block layer)
echo 1 > /sys/kernel/tracing/events/block/enable
cat /sys/kernel/tracing/trace_pipe

# Reset
echo nop > /sys/kernel/tracing/current_tracer
echo > /sys/kernel/tracing/set_ftrace_filter
echo 0 > /sys/kernel/tracing/tracing_on
echo > /sys/kernel/tracing/trace
```

Prefer `trace-cmd` or `perf ftrace` when available; they handle buffer sizing and output more safely.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No output | tracing_on=0 or wrong filter | `cat tracing_on`, filter contents |
| “lost N events” | Buffer overflow | larger buffer_size_kb, tighter filter |
| System becomes very slow | function tracer on hot path | switch back to nop immediately |
| Permission denied | not root or tracefs not mounted | mount, id |
| Events appear but not the one you want | wrong tracepoint name | `available_events` |
| Only some CPUs show data | per-CPU buffer, process affinity | `trace_pipe` or cat trace after |

## Investigation Tips

- Always start with `echo nop > current_tracer` and a tight filter. The unrestricted function tracer can make a busy box unusable.
- Use `function_graph` when you care about call depth and duration; plain `function` when you only need the names.
- For “which process is in uninterruptible sleep?”, combine with `echo 1 > events/sched/sched_switch/enable` and look for the wchan.
- `trace_pipe` is live but consumes the buffer. For a reproducible issue, turn tracing on, reproduce, turn off, then `cat trace`.
- On production, prefer tracepoints or a short `perf` recording over the function tracer. Document the exact filter and duration in the ticket.
- If you need this often, move to bpftrace or a permanent tracepoint; ftrace is excellent for one-off confirmation.

## Related Notes

- [[Performance Investigation Framework]]
- [[strace Deep Dive]]
- [[perf and Flame Graphs]]
- [[bpftrace]]
- [[High CPU Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A process stuck in D state for minutes was not I/O. `function_graph` filtered to the wchan showed it was spinning on a mutex inside a kernel module we had just loaded. `strace` had only shown the syscall that never returned.
- I left the function tracer enabled on a build server “just to check one thing”. Load average went from 4 to 40 in under a minute. The reset command is now muscle memory: `echo nop > current_tracer`.
- Lost events on a high-rate tracepoint were fixed by raising `buffer_size_kb` and adding a filter on the device name. Unfiltered block events on a busy array fill the buffer instantly.
