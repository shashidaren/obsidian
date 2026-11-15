# io_uring Deep Dive

## Concept

io_uring is a Linux kernel interface for asynchronous I/O. Applications submit operations (read, write, accept, etc.) to a shared ring and reap completions without a syscall per operation. It is used by modern databases, proxies, and runtimes for lower latency and higher throughput.

From the outside it still appears as normal file and network I/O. The difference is visible in syscall counts, context-switch rates, and sometimes in new error paths or resource limits.

## Why it matters

- A process that “does almost no syscalls” in `strace` but still moves a lot of data is often using io_uring.
- Ring setup failures, `ENOMEM`, or `EAGAIN` on submission can look like application bugs when the real limit is `RLIMIT_MEMLOCK`, `io_uring` disabled by seccomp, or a kernel config.
- Older strace and some security tools do not fully decode io_uring operations, so traditional tracing can miss the actual work.
- Kernel bugs or mis-tuned applications using io_uring have produced both performance wins and hard-to-diagnose stalls.

## Mental Model

```
Application
  → io_uring_setup()          creates rings (submission + completion)
  → io_uring_enter() / busy poll
       submits SQEs (read, write, accept, …)
       reaps CQEs
  → kernel performs the I/O asynchronously
```

Key limits and switches:

- `kernel.io_uring_disabled` (0 = enabled, 1 = disabled for unprivileged, 2 = disabled)
- `RLIMIT_MEMLOCK` (rings pin memory)
- seccomp filters that block `io_uring_setup` / `io_uring_enter`
- File and socket readiness still obeys normal filesystem and network behaviour

## Key Commands

```bash
# Is io_uring available and enabled?
cat /proc/sys/kernel/io_uring_disabled
# 0 normal, 1 unprivileged disabled, 2 fully disabled

uname -r
# io_uring needs a reasonably modern kernel (5.1+)

# Process using it (high io_uring_enter counts)
strace -c -p <pid>          # look for io_uring_enter
# or
perf stat -e 'syscalls:sys_enter_io_uring_*' -p <pid> -- sleep 5

# Limits that affect ring setup
prlimit -p <pid> | grep -E 'MEMLOCK|NOFILE'
cat /proc/<pid>/limits

# seccomp
grep Seccomp /proc/<pid>/status
# 2 = filter active
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `io_uring_setup` fails with EPERM or ENOSYS | disabled sysctl, old kernel, or seccomp | `io_uring_disabled`, `uname -r`, Seccomp status |
| Setup fails with ENOMEM | RLIMIT_MEMLOCK too low or memory pressure | `prlimit`, `memory.events` of the cgroup |
| High throughput but strace shows almost nothing | expected; work is in the rings | confirm with `strace -c` or perf |
| Stalls under load | application not reaping, or kernel issue | completion queue overflow, dmesg |
| Works on bare metal, fails in container | seccomp profile blocks the syscalls | runtime security profile, `io_uring_disabled` |
| Permission errors on files despite correct mode | still normal DAC/MAC; io_uring does not bypass them | usual path checks |

## Investigation Tips

- If `strace -c` shows a large fraction of `io_uring_enter` (or very few syscalls despite heavy I/O), you are looking at an io_uring application. Traditional per-syscall tracing will be incomplete.
- Check `kernel.io_uring_disabled` early when an application that should be fast is suddenly slow or fails to start its I/O engine.
- `RLIMIT_MEMLOCK` is a frequent silent limit. Rings pin user pages; a low memlock rlimit produces setup failures that look like OOM.
- Container seccomp profiles (Docker default, many Kubernetes policies) block io_uring by default on older runtimes. The error is often EPERM on setup.
- io_uring does not change filesystem semantics, ownership, or network firewall behaviour. An `ENOSPC` or `ECONNREFUSED` is still those errors.
- For deep inspection use `perf` or bpftrace on the io_uring tracepoints rather than plain strace. See [[perf and Flame Graphs]] and [[bpftrace]].

## Related Notes

- [[strace Deep Dive]]
- [[I/O Schedulers and blk-mq]]
- [[fio and Storage Benchmarking]]
- [[perf and Flame Graphs]]
- [[bpftrace]]
- [[sysctl and Resource Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A database upgrade started failing only in Kubernetes. `strace` showed `io_uring_setup` returning EPERM. The runtime’s seccomp profile blocked it. Switching the engine back to the older AIO path (or relaxing the profile) restored service; the host itself was fine.
- An application reported “out of memory” during startup. The cgroup had headroom, but `RLIMIT_MEMLOCK` was 64 kB. Raising memlock allowed the rings to be created.
- Under a performance investigation `strace` looked almost idle while `iostat` showed heavy disk traffic. `strace -c` revealed the process was spending its time in `io_uring_enter`. We stopped looking for a “missing read syscall” and started looking at ring parameters and completion handling instead.
