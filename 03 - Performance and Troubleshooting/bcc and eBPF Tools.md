# bcc and eBPF Tools

## Concept

BCC (BPF Compiler Collection) is a set of ready-made eBPF tools (and the Python/Lua libraries behind them) that attach to kernel events, aggregate in maps, and print only the interesting results. It is the “install and run” layer on top of the same verifier and probes that bpftrace and libbpf use.

## Why it matters

- You can answer “which stack is allocating, which bio is slow, which TCP retransmit is from which process” without stopping the target the way strace does.
- Most of the useful questions already have a tool (`biolatency`, `tcpretrans`, `execsnoop`, `opensnoop`, `cachestat`). Writing a new probe is the exception.
- The output is already aggregated, so a busy host does not drown the terminal or fill the disk.
- When the tool is missing or the kernel is too old, you know immediately instead of debugging a custom script.

## Mental Model

```
bcc tool (Python or binary)
    → loads eBPF program + maps
    → attaches to tracepoint / kprobe / uprobe
    → kernel side filters and aggregates
    → userspace polls the map and prints

Common maps: histograms (latency), counts (stack → hits), ring buffer (rare events).
If the tool prints nothing, either the event never fired or the filter excluded it.
```

BCC tools are not a replacement for `perf` when you need hardware counters or a flame graph of CPU time. They are the right tool when the question is “which events, how long, which stacks”.

## Key Commands

```bash
# Install (distro packages vary; often bcc-tools or bpfcc-tools)
# biolatency - histogram of block I/O latency
sudo biolatency-bpfcc -D 10

# tcpretrans - TCP retransmits with process and stack
sudo tcpretrans-bpfcc

# execsnoop - new processes
sudo execsnoop-bpfcc

# opensnoop - open() calls
sudo opensnoop-bpfcc -p $(pgrep -d, nginx)

# cachestat - page cache hit ratio
sudo cachestat-bpfcc 1

# funclatency - latency of a kernel or user function
sudo funclatency-bpfcc -u vfs_read
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `bpf: Failed to load program` or verifier error | Kernel too old, or tool expects a newer helper | `uname -r`, tool version, `dmesg` for the exact reject |
| Tool runs but prints nothing | Event never happens, or filter is too tight | Confirm the workload is doing the thing; try without `-p` |
| `Operation not permitted` | Missing `CAP_BPF` / `CAP_SYS_ADMIN`, or `bpf_jit_enable=0` in some policies | `capsh --print`, systemd unit hardening, seccomp |
| High CPU in the tool itself | Map is huge or userspace is polling too hard | Shorter interval, or switch to a histogram tool |
| Container sees no events from host processes | Namespace isolation of pids / cgroups | Run from host, or use the host PID namespace |
| `biolatency` shows only zeros | Device is idle, or the probe point changed | Generate load; check kernel tracepoints with `bpftrace` |

## Investigation Tips

- Start with the tool that already matches the symptom. Writing a one-off is slower and more likely to be rejected by the verifier.
- Run for a short, bounded window (`timeout 30 …`) and redirect to a file. A long run of `execsnoop` on a build host is mostly noise.
- Compare the BCC histogram with `iostat` or `sar`. If biolatency says 10 ms and iostat says 1 ms, you are looking at different layers.
- When a tool fails to load, the kernel log (`dmesg` or journal) has the verifier message. The Python traceback usually does not.
- Prefer the distro-packaged tools. A random GitHub clone often needs headers and a matching clang that you do not have on the incident host.
- BCC and bpftrace can run at the same time; they share the same map and probe limits. Too many probes and the later one is rejected.

## Related Notes

- [[eBPF Deep Dive]]
- [[bpftrace]]
- [[perf and Flame Graphs]]
- [[iostat Deep Dive]]
- [[strace Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I spent twenty minutes writing a kprobe for `tcp_retransmit_skb` before remembering `tcpretrans` already existed and printed the process name. The packaged tool was the faster path.
- `biolatency` on a host with a single busy NVMe showed a clean histogram; the same command on a host with a stalled multipath path showed a long tail that `iostat` had averaged away. The histogram made the bad path obvious.
- A container-based monitoring sidecar could not see host block events until it ran with the host PID and mount namespace. The tool was fine; the namespace was the filter.
