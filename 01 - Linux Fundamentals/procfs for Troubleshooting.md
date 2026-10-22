# procfs for Troubleshooting

## Concept

`/proc` is a virtual filesystem that exports kernel and process state. Most diagnostic commands (`ps`, `top`, `ss`, `lsof`) are just pretty printers over `/proc`. When the pretty printer is missing, broken, or lying, you read the files directly.

## Why it matters

In a constrained environment (rescue shell, container without procps, SELinux denial that blocks `ps`) `/proc` is still there. It also gives the ground truth for limits, namespaces, cgroups, and open files when the higher-level tool is ambiguous.

## Mental Model

```
/proc/PID/
  status     → state, memory, capabilities, NSpid
  limits     → actual rlimits the process has right now
  fd/        → open file descriptors (symlinks to the target)
  net/       → network namespace view (if you enter it)
  cgroup     → which cgroup the process is in
  mountinfo  → mounts as the process sees them

/proc/net/   → host network tables (tcp, udp, unix)
/proc/meminfo, /proc/vmstat, /proc/loadavg
```

Numbers in `/proc/PID/limits` are the ones that matter. `/etc/security/limits.conf` is only a request that PAM or systemd may or may not have applied.

## Key Commands

```bash
# What limits does this process actually have?
cat /proc/$(pgrep -n nginx)/limits

# Open files (works even if lsof is missing)
ls -l /proc/PID/fd | head

# Network namespace of a process
ls -l /proc/PID/ns/net
# Enter it
nsenter -t PID -n ss -tlnp

# Memory breakdown
cat /proc/PID/status | grep -E 'Vm|Rss|Threads'

# Who is using a deleted file that still consumes space
ls -l /proc/*/fd/* 2>/dev/null | grep deleted
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| “too many open files” but limits.conf looks fine | systemd unit did not set LimitNOFILE | `/proc/PID/limits`, unit file |
| `ps` shows different PID than logs | PID namespace | `/proc/PID/status` NSpid |
| Disk full but `du` is small | Deleted file still open | `ls /proc/*/fd | grep deleted` |
| Process sees different mounts | Mount namespace | `/proc/PID/mountinfo` |
| `ss` empty inside container | Wrong netns | `nsenter` or `/proc/PID/net` |

## Investigation Tips

- Always check `/proc/PID/limits` when you see EMFILE. Do not trust the unit file or limits.conf until you have confirmed the running process.
- `/proc/PID/fd` is the fastest way to see what a process has open when `lsof` is slow or unavailable.
- For “deleted but space not freed”, the classic one-liner above plus `lsof +L1` if available.
- `cat /proc/PID/stack` (if permissions allow) shows the kernel stack; useful when a process is stuck in D state.
- Remember that reading `/proc` can be slow on a host with tens of thousands of processes. Target the PID you care about.

## Related Notes

- [[File Descriptors]]
- [[sysctl and Resource Limits]]
- [[Namespaces and cgroups]]
- [[lsof Deep Dive]]
- [[Processes and Threads]]

## Personal Lessons Learned

- A service kept hitting “too many open files” after every restart. The unit had no `LimitNOFILE`. `/proc/PID/limits` showed 1024 while limits.conf claimed 65535. Adding the directive to the unit fixed it; editing limits.conf had done nothing.
- Space was not freed after log rotation because the application still held the deleted inode. `ls /proc/*/fd | grep deleted` found it in seconds.
