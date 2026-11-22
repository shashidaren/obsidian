# SystemTap

## Concept

SystemTap is a scripting language and toolset for dynamic tracing of the Linux kernel and user space. It compiles scripts into kernel modules (or uses the runtime) to probe functions, tracepoints, and kprobes without rebooting or recompiling the kernel.

It sits between `perf` (sampling) and `bpftrace` (more modern eBPF). Useful when you need custom predicates or to collect structured data from specific events.

## Why it matters

- Lets you answer “how often does this path run and with what arguments?” without a rebuild
- Catches rare events that sampling misses (error paths, specific syscalls with particular flags)
- Production-safe when limited to short runs and read-only probes; unsafe when you write a probe that allocates or takes locks in a hot path
- Still relevant on older kernels or distros where full eBPF tooling is restricted

If `perf` shows a function and you need the arguments or the rate of a specific condition, SystemTap (or bpftrace) is the next step.

## Mental Model

```
script.stp
  → stap compiler → kernel module (or runtime)
  → probes fire on tracepoints / kprobes / uprobes
  → collect in maps or print
  → unload when done

Safety rules:
  - Prefer existing tracepoints over raw kprobes
  - Keep probe bodies tiny (no heavy computation, no allocation in hot path)
  - Always have a timeout or manual stop
  - Test on a non-prod host first
```

`stap -L 'kernel.function("*")'` lists available probes. `stap -v` shows the compile path.

## Key Commands

```bash
# List probes
stap -L 'kernel.trace("sched*")'
stap -L 'process("/usr/bin/sshd").function("*")'

# Simple one-liner: count context switches per process (short run)
stap -e 'probe scheduler.ctxswitch { p[pid(), execname()] <<< 1 } probe end { foreach (i in p+) printf("%s %d\n", i, @count(p[i])) }' -c 'sleep 5'

# Trace openat with path (example)
stap -e 'probe syscall.openat { printf("%d %s\n", pid(), filename) }' -c 'ls /tmp'

# Install required packages (RHEL-like / Debian)
# stap, systemtap-runtime, kernel-debuginfo or kernel-devel matching the running kernel
uname -r
stap -V

# Run with timeout and limited output
timeout 20 stap -o /tmp/stap.out script.stp
```

Always match debuginfo / kernel-devel to the exact running kernel. A mismatch is the most common “it doesn’t work” failure.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| “semantic error” or no probes | Missing debuginfo or wrong kernel package | `stap -V`, debuginfo package version vs `uname -r` |
| Module load fails / “permission denied” | Secure boot, lockdown, or missing privileges | `dmesg`, `mokutil`, run as root |
| Script runs but no output | Probe never hits, or predicate too strict | `-v`, add a timer probe to prove it is alive |
| Host slows or hangs | Probe body too heavy, or probing a lock path | Kill with Ctrl-C, check `dmesg`, simplify script |
| “pass 5: failed” | Compiler / kernel header mismatch | Reinstall matching kernel-devel |
| Works on one host, fails on another | Different kernel config (no tracepoints) | `stap -L` on both |

## Investigation Tips

- Start with existing examples (`/usr/share/systemtap/examples` or the SystemTap wiki). Do not write a complex script on the incident host.
- Prefer `bpftrace` or `perf` when they can answer the question; SystemTap’s compile step is slower and more fragile.
- Always bound the run (`timeout`, `-c`, or a timer that exits). An unbounded probe on a busy path is a denial-of-service.
- Capture the script and the output off the box. The trace is the evidence.
- If debuginfo is missing and you cannot install it, fall back to `perf` or `trace-cmd`.
- Never leave a SystemTap module loaded overnight. Unload with `stap -d` or a reboot if it is stuck.

## Related Notes

- [[perf and Flame Graphs]]
- [[bpftrace]]
- [[strace Deep Dive]]
- [[bcc and eBPF Tools]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A SystemTap script that printed every `open` on a busy web server filled the journal and made the box unresponsive until I killed it. Now every script has an explicit exit condition and a short timeout.
- Debuginfo mismatch is the number-one reason “SystemTap doesn’t work” tickets appear. Check the package version against `uname -r` before you debug the script.
