# perf and Flame Graphs

## Concept

`perf` samples the CPU via the kernel’s performance counters and attributes samples to a process, a kernel function, or a stack. A flame graph turns those stacks into a picture: width is time on-CPU, height is the call stack. It answers “what is this CPU *doing*?", not “what is it waiting for?”

Off-CPU time (locks, disk, network) is a different profile. `strace` and sleep graphs cover that. Do not read an on-CPU flame graph as the whole latency story.

## Why it matters

- `top` names the PID. `perf` names the function. Restarts hide the function and the bug comes back
- A wide frame of `sha256` or `inflate` is a different fix from a wide frame of `spin_lock`
- Kernel vs user split in the graph stops a wasted argument about “the app” when the CPU is in `writeback` or `nf_conntrack`
- Short, targeted records (`-p`, 10–20 s, 99 Hz) are usually safe. System-wide long records are not

If you cannot take a profile, you are guessing which line of code to change.

## Mental Model

```
perf_events (kernel)
   │  sample every N ms (or on a hardware counter)
   ▼
perf record -g  →  perf.data (stacks)
   │
   ├─ perf report          (interactive / stdio tree)
   └─ perf script | stackcollapse | flamegraph.pl → SVG

on-CPU  = sampled while the task was running
off-CPU = sampled while the task was sleeping (perf sched, offcputime) — different tool path
```

Frame pointers (`-fno-omit-frame-pointer`) or DWARF (`--call-graph dwarf`) decide whether user stacks are real. Missing frames collapse the graph into `[unknown]` and one libc bar.

`kernel.perf_event_paranoid` gates who can sample. `kptr_restrict` hides kernel symbols. Containers often see neither, even when the host can.

## Key Commands

```bash
# Can this user sample?  -1 or 0 = easier; 2+ = more restricted; 4 = no
sysctl kernel.perf_event_paranoid kernel.kptr_restrict

# Live, one PID — first look, no file
perf top -p <PID> -g

# Short on-CPU record. -F 99 avoids lockstep with 100 Hz timers
perf record -F 99 -g -p <PID> -- sleep 15
perf report --stdio --no-children | head -60

# Whole box, still short — only if one PID is not enough
perf record -F 99 -g -a -- sleep 10

# DWARF stacks when the binary omitted frame pointers (larger, slower)
perf record -F 49 -g --call-graph dwarf -p <PID> -- sleep 10

# Hand off to flamegraph.pl (clone brendangregg/FlameGraph once; not on the sick host)
perf script | ./stackcollapse-perf.pl | ./flamegraph.pl > /tmp/cpu.svg

# Scheduler noise: context switches, not stacks
perf stat -p <PID> -- sleep 5
```

Java/Node/Python without symbols look like `Interpreter` or `[unknown]`. Use the runtime’s profiler (async-profiler, `py-spy`, `node --prof`) or generate `/tmp/perf-<pid>.map`. Do not “fix” an unknown Java stack by reading it as C++.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `perf` not found / no events | package missing, or paranoid blocks | `perf` package, `sysctl kernel.perf_event_paranoid` |
| All stacks are `[unknown]` or one bar | No frame pointers, no DWARF, stripped binary | `--call-graph dwarf`, debuginfo |
| Graph is 90% `_raw_spin_lock` | Real contention, or sampling too slow a lock | Confirm with `perf lock` / higher `-F` only if safe |
| Record makes the host worse | System-wide DWARF, high frequency, huge `perf.data` | `-p`, `-F 49`, short `sleep`, check disk |
| Container has no samples | perf_event not allowed in the cgroup | Profile from the host PID namespace |
| “Idle” in the graph during an outage | You profiled on-CPU; the app is waiting | [[strace Deep Dive]], off-CPU, `vmstat` `b` |
| Symbols are hex only | `kptr_restrict`, no vmlinux | root, debuginfo, or host-side report |
| `perf report` empty | Record failed, or PID exited | `perf record` stderr, file size |

## Investigation Tips

- Classify first with `mpstat` / `pidstat`. `perf` on a box that is in iowait wastes the window and the disk.
- Prefer `-p` of the hot PID over `-a`. System-wide captures include idle and unrelated services and fill `/tmp`.
- 10–20 seconds at 99 Hz is enough for a steady burn. Longer is for rare paths, and only after you know the cost.
- Watch free space where `perf.data` lands (cwd). A full `/` from a profile is a self-inflicted incident.
- Children vs self in `perf report`: `--no-children` shows who actually used the CPU. Inclusive “children” makes `main` look guilty.
- Kernel frames at the top of a user stack often mean a syscall. That is a clue to read the syscall, not to tune the scheduler.
- Save the SVG and the `perf.data` off the box before reboot. The profile is the evidence; the restart is the mitigation.
- Never attach a long `perf record -g --call-graph dwarf -a` to a production database “to see”. Same rule as blind `strace`.

## Related Notes

- [[High CPU Runbook]]
- [[top Deep Dive]]
- [[pidstat Deep Dive]]
- [[strace Deep Dive]]
- [[bpftrace]]
- [[CPU Scheduling and Load Average]]
- [[Processes and Threads]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A flame graph that was 70% `libcrypto` ended a week of “the database is slow” tuning. The app was hashing every cache key on the request path. `top` only said `java`.
- I once filled the root filesystem with `perf.data` from a 5-minute system-wide DWARF record. The profile was useless and the box paged for disk. Short, per-PID, frequency-capped.
- `[unknown]` is not “kernel bug”. It is missing symbols. I do not write a fix proposal until the stack has names.
