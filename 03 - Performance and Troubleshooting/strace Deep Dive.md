# strace Deep Dive

## Concept

`strace` attaches with ptrace and prints the syscalls a process makes. It is a scalpel for “the process is stuck, the log line is a lie, and I need the errno”. It is not a profiler and it is not safe to hang on a busy production database.

Every traced syscall is stopped and resumed. A hot process under `strace` gets slower, sometimes enough to trip health checks or stall replication.

## Why it matters

- Turns “it timed out” into `connect()` → `ETIMEDOUT`, `read()` → `EAGAIN`, or `open()` → `ENOSPC`.
- Shows the path the process actually opened, which is often not the path in the config file you were handed.
- `-c` gives a cheap syscall histogram when you suspect the process is in a tight failing loop.
- `ptrace_scope` and container restrictions explain “strace failed” before you conclude the binary is static or malicious.

## Mental Model

```
strace -p PID
    → ptrace attach (process stops)
    → each syscall: stop, record, resume
    → detach on Ctrl-C (process keeps running)

-f     follow forks (threads too on Linux — clones)
-tt    absolute timestamps
-T     time spent inside the syscall
-e trace=network,file
       only the classes you care about
-o file
       do not scroll the incident away
-c     counts, not a transcript
```

errno you will actually see:

- `EAGAIN` / `EWOULDBLOCK` — non-blocking fd, nothing ready. Often normal in an event loop. A tight loop of them means the loop is spinning, not that the disk is dying.
- `ETIMEDOUT` — the kernel gave up waiting (TCP retransmit limit, or a timed futex).
- `ENOSPC` — filesystem or inode full, or sometimes a quota. Confirm with `df` / `df -i` on the path in the same line.
- `ECONNREFUSED` — nothing listening, or a reject.
- `EINPROGRESS` — non-blocking connect still in flight. Not a failure by itself.

## Key Commands

```bash
# Attach, follow threads, timestamps, syscall duration, network+file only
strace -f -tt -T -e trace=network,file -p <PID> -o /tmp/strace.out

# Bound the damage
timeout 15 strace -f -tt -T -e trace=network,file -p <PID> -o /tmp/strace.out
# or stop after N lines
strace -f -e trace=network -p <PID> -o /tmp/strace.out &
sleep 10; kill %1

# Summary instead of a transcript (still slows the process)
strace -c -f -p <PID>
# Ctrl-C after a few seconds prints the table

# New process from the start (reproduces a failing start)
strace -f -tt -T -o /tmp/start.out /usr/bin/myapp --config /etc/myapp.conf

# One family
strace -e trace=openat,stat,connect,sendto,recvfrom -tt -T -p <PID>

# Filter a path substring while writing the file
strace -f -e trace=file -p <PID> -o /tmp/files.out
grep '/etc/myapp' /tmp/files.out
```

`-p` needs root or the same user, and `kernel.yama.ptrace_scope` must allow it. `3` or `4` means you cannot attach; `1` is the usual distro default (parent, or root).

```bash
cat /proc/sys/kernel/yama/ptrace_scope
# 0 classic, 1 restricted, 2 admin-only, 3 no attach
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `strace: attach: ptrace: Operation not permitted` | `ptrace_scope`, container seccomp, or Yama | sysctl, `capsh`, same PID namespace |
| `attach: No such process` | PID raced, or you are in the wrong namespace | `lsns`, host PID vs container PID |
| Process freezes while traced | ptrace stop on a hot thread | detach; you are the cause |
| Endless `read` `EAGAIN` | non-blocking loop, not a disk error | look at the fd; do not treat EAGAIN as ENOSPC |
| `connect` `ETIMEDOUT` | no SYN-ACK, firewall, or routing | path from `-tt`, then tcpdump |
| `openat` `ENOSPC` | full fs or full inodes | `df -h` and `df -i` on that mount |
| `openat` `ENOENT` on a path the config “has” | wrong cwd, dropped privs, or a relative path | the path string in the trace |
| Output fills the disk | no `-o` rotation, traced a busy process | `timeout`, `-e trace=`, write to a roomy fs |
| `-c` shows 90% `futex` | lock or idle wait, not CPU math | this is a waiter; go to the other thread |
| Database latency spikes as soon as you attach | you traced the wrong thing | detach immediately |

## Investigation Tips

- Never `strace -f` a production database, a JVM under load, or a process with thousands of threads unless you have already decided the slowdown is acceptable. Sample one worker PID, for seconds, with a filter.
- `-e trace=network,file` cuts noise. An unfiltered trace of a Java process is mostly futex and clock_gettime.
- Write `-o` to `/tmp` or a data disk with space. A trace of a chatty process can be gigabytes in a minute.
- `timeout 15 strace …` so a dropped SSH session does not leave the process traced. If it does, `kill` the strace; do not kill the target.
- Match timestamps (`-tt`) to the application log line. The syscall just before the log is the one that failed.
- `EAGAIN` on a socket in an event loop is healthy. `EAGAIN` in a tight loop with no `poll`/`epoll_wait` is a bug.
- Containers: attach from the host to the host PID, or from inside the container if the runtime allows ptrace. `ptrace_scope` on the host still applies.
- `-c` is the right first attach when you do not know which syscall matters. A transcript is the second step.
- strace will not show you page cache or disk latency inside a successful `read`. A fast `read` that returns data can still have been a slow disk earlier; use `iostat` for that. strace tells you *which* call and *which* errno.

## Related Notes

- [[lsof Deep Dive]]
- [[bpftrace]]
- [[Performance Investigation Framework]]
- [[Processes and Threads]]
- [[File Descriptors]]
- [[tcpdump Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I attached `strace -f` to a Postgres backend “just to see”. Checkpoints stalled, the replica alert fired, and the only finding was `epoll_wait`. Detach first, apologise second.
- A service that “could not read its config” was `openat("/app/config/app.yaml")` with cwd `/`. The unit had no `WorkingDirectory=`. The file existed. The relative path did not.
- `ETIMEDOUT` on `connect` to a VIP, with no packets on the server, ended a two-hour “application timeout” argument. The security group never had the port. strace named the address; tcpdump proved the drop.
