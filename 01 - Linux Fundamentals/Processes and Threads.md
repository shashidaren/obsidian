# Processes and Threads

## Concept

A Linux *task* is the kernel’s unit of scheduling. A process is a task group that owns an address space, file descriptor table, credentials, cgroup membership, and namespaces. Threads are extra tasks in that group (`CLONE_THREAD`): same mm, same fds, different stack and tid.

`ps` without `-L`/`-T` shows thread groups (tgid). `top -H` and `ps -L` show tasks. Mixing those views is how “the process is at 8%” hides one pegged thread.

PIDs are namespace-local. The number in a container is not the number on the node. Always know which namespace you are looking at.

## Why it matters

- Thread leaks exhaust PID space, file descriptors, and scheduler overhead long before CPU looks busy.
- Fork bombs and misconfigured workers fill the process table; new sshd cannot spawn.
- Zombies are a parent bug (missing `wait`), not a resource hog. D-state is a wait on something the kernel will not interrupt.
- Orphaned trees after a crash, a double-started unit, or a container runtime race are how you get two writers on one data directory.

## Mental Model

```
task_struct
  pid / tgid     thread id vs thread-group id (the “process PID”)
  mm_struct      address space (shared by threads)
  files_struct   fd table (shared by threads)
  parent / children
  state          R S D T Z t
  wchan          why it is sleeping
  cgroup / ns

Process (tgid=1010)
├── tid 1010  main
├── tid 1014  worker
├── tid 1015  worker
└── child process tgid=2001   own mm, own fds

/proc/<pid>/task/<tid>/   per-thread view
/proc/<pid>/fd            shared fds
/proc/<pid>/ns            namespaces
```

States you will actually use:

| State | Meaning | Typical next look |
|-------|---------|-------------------|
| R | Running or runnable | CPU runbook |
| S | Interruptible sleep | Normal; ignore unless stuck logically |
| D | Uninterruptible | Storage / NFS / some locks |
| Z | Zombie | Parent not reaping |
| T | Stopped (job control / SIGSTOP) | Forgotten `kill -STOP` or debugger |

## Key Commands

```bash
# Process list with parent and state
ps -eo pid,ppid,user,stat,nlwp,pcpu,pmem,rss,wchan:20,comm,args --sort=-pcpu | head -25

# Threads of one process
ps -L -o pid,lwp,stat,pcpu,comm,args -p <PID>
top -H -p <PID> -c -d 1
cat /proc/<PID>/status | grep -E 'Name|State|Tgid|Pid|PPid|Threads|NSpid|voluntary'

# Tree
pstree -aps <PID>
ps -ef --forest

# Counts (pid_max is a real ceiling)
ps -e --no-headers | wc -l
ps -eL --no-headers | wc -l
cat /proc/sys/kernel/pid_max
ls /proc | grep -c '^[0-9]'

# Why it sleeps / what it has open
cat /proc/<PID>/wchan
ls -l /proc/<PID>/fd | head
ls -l /proc/<PID>/cwd /proc/<PID>/exe

# Host PID for a container thread (on the node)
# NSpid in /proc/<hostpid>/status lists pid in each namespace
grep NSpid /proc/<PID>/status
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `fork() failed: Resource temporarily unavailable` | pid_max, nproc ulimit, or memory | `pid_max`, `ulimit -u`, `free` |
| `nlwp` climbing on one PID | Thread leak or runaway pool | `ps -L -p`; app pool config |
| Forest of same binary, no common supervisor | Double start, leftover nohup, or unit `Type=` wrong | `systemctl status`, `pstree` |
| Z state rows | Parent ignored SIGCHLD / never wait(2) | `ppid`; fix or recycle the parent |
| D state rows, load high, CPU idle | I/O or remote FS | `wchan`, `iostat`, NFS |
| T state on a production daemon | Someone SIGSTOP'd it or left gdb attached | `kill -CONT` only after you know why |
| Host PID ≠ `kubectl exec` PID | Expected namespaces | use NSpid / crictl inspect |
| Threads 100%, process 12% on 8 cores | Math: 100/8 ≈ 12. One hot thread | `top -H` |

## Investigation Tips

- Record **tgid, tid, ppid, stat, wchan, exe, start time**. “nginx is broken” is not a finding.
- `nlwp` in `ps` is thread count. Sudden growth with flat traffic is a leak.
- Zombies hold a PID and almost nothing else. Do not `kill -9` the zombie; you cannot. Fix or kill the parent.
- `kill -9` on a D-state task does nothing until the wait ends. You will sit there feeling powerful.
- In systemd, prefer `systemctl status` / cgroup.scope membership over hunting orphans by name. Two `java` processes are not interchangeable.
- `/proc/<pid>/oom_score_adj` and `NStgid` are how you explain “why did *that* task die”.

## Related Notes

- [[File Descriptors]]
- [[CPU Scheduling and Load Average]]
- [[Memory Management]]
- [[top Deep Dive]]
- [[ps Deep Dive]]
- [[pidstat Deep Dive]]
- [[High CPU Runbook]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “process leak” was a wrapper script that `exec`'d wrong and left a shell per cron tick. `pstree -aps` showed the pattern in ten seconds; `ps aux | wc -l` only said “many”.
- I spent twenty minutes trying to SIGKILL a D-state rsync on a wedged NFS mount. The useful action was on the NFS server, not the client PID.
- Counting threads inside the container and comparing to `pid_max` on the *node* is a category error I have watched happen during an incident. Use the namespace that owns the limit you care about.
