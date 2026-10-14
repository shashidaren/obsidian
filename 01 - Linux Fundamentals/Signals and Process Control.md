# Signals and Process Control

## Concept

Signals are asynchronous notifications delivered by the kernel to a process (or thread). They are the primary mechanism for process lifecycle control outside of the process itself: graceful shutdown, forced termination, stop/continue, reload, and core dumps.

`kill` (and friends) send signals. The default action for most signals is to terminate the process; some can be caught or ignored by the application.

## Why it matters

- `kill -9` is not the first action. SIGTERM lets the process flush buffers, close sockets, and release locks. SIGKILL does not.
- A process stuck in D-state ignores all signals until the kernel wait ends. Sending more signals does nothing useful.
- Job control (`SIGSTOP`/`SIGCONT`, `nice`, `ionice`) is how you deprioritise a runaway batch job without killing it during an incident.
- Orphaned processes after a bad deploy or double-start are cleaned up by understanding parent/child and session relationships, not by name alone.

## Mental Model

```
User/kernel sends signal
        ↓
process signal mask / handler
        ↓
default action or custom handler
        ↓
terminate / stop / core / ignore / catch
```

Common signals you will actually use:

| Signal | Number | Default | Typical use |
|--------|--------|---------|-------------|
| SIGHUP | 1 | Terminate | Reload config (daemons that catch it) |
| SIGINT | 2 | Terminate | Ctrl-C |
| SIGQUIT | 3 | Core + terminate | Dump core and quit |
| SIGKILL | 9 | Terminate (uncatchable) | Last resort |
| SIGTERM | 15 | Terminate | Graceful stop (systemd default) |
| SIGSTOP | 19 | Stop (uncatchable) | Pause for investigation |
| SIGCONT | 18 | Continue | Resume after STOP |
| SIGUSR1/2 | 10/12 | Terminate | App-specific (often rotate logs or dump) |

`kill -l` lists them. Prefer names over numbers.

## Key Commands

```bash
# Send signal
kill -TERM <PID>
kill -9 <PID>                 # only after TERM ignored and you accept data loss
killall -TERM nginx
pkill -TERM -u appuser

# Stop / continue (job control or investigation)
kill -STOP <PID>
kill -CONT <PID>

# Priority
nice -n 19 ionice -c 3 long-batch.sh
renice -n 10 -p <PID>
ionice -c 3 -p <PID>          # idle I/O class

# Affinity (rarely first lever)
taskset -cp 0-3 <PID>

# What is actually happening
ps -eo pid,ppid,sid,stat,wchan,cmd -p <PID>
cat /proc/<PID>/status | grep -E 'SigPnd|SigBlk|SigIgn|SigCgt'
cat /proc/<PID>/wchan

# Core dumps (if enabled)
ulimit -c
systemctl status systemd-coredump
coredumpctl list
```

systemd units: `KillSignal=`, `TimeoutStopSec=`, `SendSIGKILL=` control the stop path. Prefer unit configuration over ad-hoc `kill` on production services.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Process ignores `kill -TERM` | Handler stuck, or D-state | `ps` state, `wchan`, then `strace` briefly |
| `kill -9` does nothing | D-state or zombie | `stat` column; fix the wait, not the signal |
| Service "restarts" but old PID remains | Double start, wrong PID, or Type=forking race | `systemctl status`, `pstree` |
| Batch job starves production | Default nice 0, same I/O class | `renice`, `ionice`, or cgroup CPUQuota |
| Logs not rotated after SIGHUP | App does not catch SIGHUP, or wrong PID | App docs, `systemctl reload` |
| Core dump missing after crash | `ulimit -c 0`, or systemd-coredump not running | `coredumpctl`, `LimitCORE=` |

## Investigation Tips

- Always prefer `systemctl stop` / `kill -TERM` first. Document why you escalated to -9.
- Check state before signalling: `ps -o stat,wchan,cmd -p <PID>`. T means already stopped; D means signals are queued until the wait ends.
- For systemd services, look at `TimeoutStopSec` and journal for the stop path before you start sending extra signals.
- `pkill` by name is dangerous on a shared host. Prefer PID or cgroup.
- After a STOP for investigation, remember to CONT. A forgotten SIGSTOP looks like a hung process.
- `nice` and `ionice` do not help a process that is already in D-state or CPU-bound on a single core with no other work.

## Related Notes

- [[Processes and Threads]]
- [[systemctl Deep Dive]]
- [[High CPU Runbook]]
- [[coredumpctl]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A "hung" Java process was in D-state on a wedged NFS. `kill -9` did nothing for 20 minutes. The useful work was on the NFS server.
- I used `kill -STOP` to freeze a runaway logger during an incident so I could capture `/proc` and a short strace. CONT after the capture. The process continued exactly where it left off.
- systemd's default stop path already sends SIGTERM then SIGKILL after TimeoutStopSec. Manual `kill -9` on a unit is usually redundant and loses the journal context.
