# ps Deep Dive

## Concept

`ps` reports a snapshot of current processes. Unlike `top`, it is non-interactive and highly scriptable, making it the right tool for one-shot diagnostics, pipelines, and automation.

## Why it matters

- `top` is great for live watching; `ps` is great for precise, repeatable queries
- Custom format strings let you extract exactly the fields you need
- Essential for finding processes by name, user, state, or parent
- Works cleanly in scripts and remote sessions where interactive tools are awkward

## Mental Model

```
ps = snapshot of the kernel process table at one moment

Common views:
- BSD style   (ps aux)
- System V    (ps -ef)
- Custom      (ps -eo pid,ppid,user,stat,pcpu,pmem,cmd)

Key columns to watch:
STAT  → process state (R, S, D, Z, T …)
%CPU / %MEM → resource consumers
PPID  → parent relationship (trees, orphans)
```

`D` state (uninterruptible sleep) usually means waiting on I/O. `Z` means zombie.

## Key Commands

```bash
# Classic full list (BSD style)
ps aux

# Full list with wide command line (System V style)
ps -ef

# Custom columns — most useful form
ps -eo pid,ppid,user,stat,pcpu,pmem,vsz,rss,cmd --sort=-pcpu | head

# Processes for a specific user
ps -u www-data -o pid,stat,pcpu,pmem,cmd

# Tree view (parent/child)
ps -ejH
ps auxf                  # forest view (some versions)

# Threads of a process
ps -T -p <PID>
ps -L -p <PID>           # alternative

# Find by name (prefer pgrep for scripts)
ps aux | grep [n]ginx
pgrep -a nginx
pgrep -u root -a sshd

# Zombies and stuck processes
ps -eo pid,ppid,stat,cmd | grep ' Z'
ps -eo pid,stat,wchan:20,cmd | grep -E ' D|Z'

# Memory consumers
ps -eo pid,user,rss,cmd --sort=-rss | head -20
```

### Useful STAT codes

| Code | Meaning                          |
|------|----------------------------------|
| R    | Running or runnable              |
| S    | Interruptible sleep (waiting)    |
| D    | Uninterruptible sleep (usually I/O) |
| Z    | Zombie (exited, not reaped)      |
| T    | Stopped (job control / debugger) |
| <    | High priority (not nice)         |
| N    | Low priority (nice)              |
| +    | Foreground process group         |

## Common Failure Modes & Symptoms

| What you see                     | Likely meaning                          | Next step                              |
|----------------------------------|-----------------------------------------|----------------------------------------|
| Many processes in `D` state      | I/O bottleneck (disk, NFS, etc.)        | `vmstat`, `iostat`, `iotop`            |
| Zombies accumulating             | Parent not calling wait()               | Check parent process / service         |
| High %CPU on many short-lived    | Fork bomb or frequent restarts          | `pstree`, service logs                 |
| Process missing from `ps` but port open | Short-lived or different namespace   | Check containers / PID namespaces      |
| RSS growing over time            | Possible memory leak                    | Track with `pidstat -r` or smem        |

## Investigation Tips

- Prefer `ps -eo … --sort=` over interactive tools when you need reproducible output or to pipe into other commands.
- `wchan` shows what a sleeping process is waiting on — useful for `D` state diagnosis.
- On systems with containers, remember that `ps` inside a container only sees its own PID namespace; use the host view when troubleshooting.
- `pgrep` / `pkill` are cleaner than `ps | grep` in scripts (and avoid the classic grep self-match problem).
- For a live process tree that updates, use `pstree -p` or `htop` in tree mode.

## Related Notes

- [[top Deep Dive]]
- [[pidstat Deep Dive]]
- [[File Descriptors]]
- [[Processes and Threads]]
- [[High CPU Runbook]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
