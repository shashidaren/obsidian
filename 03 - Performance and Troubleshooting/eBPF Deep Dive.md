# eBPF Deep Dive

## Concept

eBPF lets you attach small, verified programs to kernel events (tracepoints, kprobes, XDP, sockets) that run in the kernel without a module. bpftrace and BCC are the usual front-ends. The program is rejected by the verifier if it can loop forever or read arbitrary memory.

It is how you answer "what is this process doing on the slow path" without ptrace-stopping it.

## Why it matters

- strace on a busy database can stall it. An eBPF probe that only fires on the slow open or the high-latency bio does not.
- You can count, histogram, or filter in the kernel so the volume of data that reaches userspace stays small.
- Production kernels already have BPF; the missing piece is usually the tool and a filter, not a rebuild.
- XDP and socket filters can drop or redirect packets before the normal stack, which is both powerful and easy to break.

## Mental Model

```
userspace (bpftrace / BCC / libbpf)
    → compile to eBPF bytecode
        → kernel verifier
            → attach to probe / tracepoint / XDP / cgroup
                → run on every event that matches
                    → maps for aggregation, ring buffer for events

Verifier rejects: unbounded loops, unchecked pointer deref, too much stack, calling the wrong helper.
```

Two clocks people mix up: the probe fires on the event; the map or the print is what you actually see. A filter that never matches looks identical to "BPF is broken".

## Key Commands

```bash
# Is the kernel willing?
bpftrace -l 'tracepoint:syscalls:sys_enter_openat' | head
ls /sys/kernel/debug/tracing/available_filter_functions | head
sysctl kernel.unprivileged_bpf_disabled

# One-liners (prefer these over long scripts in an incident)
bpftrace -e 'tracepoint:syscalls:sys_enter_openat /comm == "postgres"/ { printf("%s %s\n", comm, str(args->filename)); }'
bpftrace -e 'tracepoint:block:block_rq_complete { @us = hist(args->nr_sector * 512); }'
bpftrace -e 'kprobe:tcp_v4_connect { @[comm] = count(); }'

# Existing tools
ls /usr/share/bpftrace/tools/
bpftrace /usr/share/bpftrace/tools/biolatency.bt

# Permissions
id
# usually needs root or CAP_BPF + CAP_PERFMON on newer kernels
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Verifier error on load | Loop, unbounded map, or old helper | error text; simplify to a printf |
| No output | Filter never matches or wrong probe name | `bpftrace -l` the probe; drop the filter |
| Permission denied | unprivileged_bpf_disabled or missing caps | sysctl, id, run as root |
| High CPU after attach | Hot function, no filter | add `/comm == "..."/` or a rate |
| Works on host, fails in container | Missing caps or cgroup BPF | run from host PID namespace |
| "BPF not available" | CONFIG_BPF off or lockdown | `bpftrace -l`; dmesg |
| User stacks empty | No frame pointers | use perf or a build with frame pointers |

## Investigation Tips

- Start with a tracepoint and a comm filter. Kprobes break across kernel updates; tracepoints do not.
- Histograms beat printing every event when you care about latency. One biolatency run often ends the "average looks fine" argument.
- Bound the run. A bpftrace left attached for a day can fill a map or the journal.
- If the one-liner is getting long, put it in a `.bt` file in the ticket so the next person can re-run it exactly.
- eBPF will not give you a flame graph of on-CPU time. Use it for the rare or the conditional path; use perf for the hot one.
- Test on a non-production box first if the probe is on `tcp_sendmsg`, `vfs_write`, or anything that fires millions of times a second.
- After you detach, confirm the process CPU dropped. A forgotten probe is still a probe.

## Related Notes

- [[bpftrace]]
- [[strace Deep Dive]]
- [[perf and Flame Graphs]]
- [[ftrace Deep Dive]]
- [[Performance Investigation Framework]]
- [[iostat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- biolatency showed a 99th-percentile of 80 ms while iostat average was 2 ms. One LUN was saturated; the rest were idle. The histogram made the ticket obvious.
- I attached an unfiltered kprobe to vfs_read on a busy nginx. CPU rose 15 %. Adding `/comm == "nginx"/` made it invisible. Filters are not optional.
- The verifier rejected a script that looked correct because the map had no max entries. A single printf got the filename I needed for the ticket in thirty seconds.
