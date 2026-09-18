# ps Deep Dive

## Concept

`ps` is a one-shot dump of the kernel process table. It does not refresh. That is the point: you get a reproducible snapshot you can sort, grep, paste into a ticket, or run from a script.

`top` answers “what is happening *now*?”  
`ps` answers “what exists *at this instant*, with these fields?”

Two dialects coexist and people mix them by habit:

- BSD: `ps aux` (no dash)
- System V: `ps -ef` (dash)

Learn one custom format and stop arguing about the classics.

## Why it matters

- First tool when SSH is slow, `top` is too busy, or you need a field `top` does not show (`wchan`, `nlwp`, `psr`, start time)
- The only honest way to catch `D` and `Z` states in bulk
- Scripts must not scrape interactive `top`
- Inside containers vs on the host, PID namespaces change what `ps` can see — you have to know which view you are in

If you cannot name the state codes and the difference between RSS and VSZ, you will misread the snapshot.

## Mental Model

```
ps = read /proc at one moment, format, exit

Useful axes:
  identity   PID PPID SID TTY USER
  state      STAT / S, wchan
  CPU        pcpu, time, psr (CPU last ran on)
  memory     rss (resident), vsz (virtual), pmem
  shape      nlwp (threads), cmd / args
```

State is the column that changes the investigation:

| STAT | Meaning | What it usually implies |
|------|---------|-------------------------|
| R    | Running or runnable | Actually on (or about to be on) a CPU |
| S    | Interruptible sleep | Waiting on a timer, socket, or condvar — normal |
| D    | Uninterruptible sleep | Almost always block I/O (disk, NFS, iSCSI) |
| Z    | Zombie | Child exited; parent has not `wait()`ed |
| T    | Stopped | `SIGSTOP`, job control, or a debugger |
| I    | Idle kernel thread | Ignore unless you are counting tasks |

Modifiers: `<` high priority, `N` niced, `L` pages locked, `l` multi-threaded, `s` session leader, `+` foreground pgrp.

`%CPU` in `ps` is lifetime average since start (procps), not the last second. That is why a just-spawned compiler looks quiet in `ps` and hot in `top`.

## Key Commands

```bash
# The format worth memorising
ps -eo pid,ppid,user,stat,psr,pcpu,pmem,rss,vsz,nlwp,wchan:20,etime,cmd --sort=-pcpu | head -30

# Memory consumers (RSS in KiB)
ps -eo pid,user,rss,stat,cmd --sort=-rss | head -20

# Threads of one process
ps -T -p <PID>
ps -L -p <PID> -o pid,tid,psr,stat,pcpu,cmd

# Forest / session
ps auxf
ps -ejH
pstree -p <PID>

# By user or name
ps -u www-data -o pid,stat,pcpu,rss,cmd
pgrep -a nginx
pgrep -u postgres -a

# Stuck and dead
ps -eo pid,ppid,stat,wchan:24,cmd | awk '$3 ~ /D/'
ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'

# Wide argv (otherwise cmd is truncated in some defaults)
ps -eo pid,args | grep -F '[n]ginx'

# Start time / elapsed — “has this been up since the deploy?”
ps -eo pid,lstart,etime,cmd -p <PID>
```

`wchan` is the kernel wait channel. `vfs_read`, `io_schedule`, `rpc_wait` point at storage or NFS. `futex_wait` is userspace locking.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|--------------|----------------|-----------|
| Many `D` | Storage or remote FS stall | `wchan`, `vmstat 1`, `iostat -xz 1`, NFS note |
| `Z` accumulating | Parent not reaping | Inspect PPID; restart *parent* only with a plan |
| High `nlwp` | Thread leak or runaway pool | `ps -T -p`; app metrics |
| Huge VSZ, modest RSS | Large mappings / JIT / arena, not necessarily a leak | Track RSS over time with `pidstat -r` |
| Process gone, port still listed | Different namespace, or you raced a restart | Host `ss -tlnp`; `lsns` |
| `ps` inside container misses siblings | PID namespace | Run `ps` on the node or via crictl/nsenter |
| `%CPU` disagrees with `top` | Lifetime vs interval accounting | Believe `top`/`pidstat` for “now” |
| `grep` matches itself | Classic `ps \| grep foo` | `pgrep -a` or `grep '[f]oo'` |

## Investigation Tips

- Custom `-eo` plus `--sort=` is the whole skill. Pick fields for the question; do not dump `aux` and squint.
- For CPU *right now*, `pidstat 1` or `top -b -n 3` beats a single `ps`.
- For “who parented this?” follow PPID until you hit a systemd unit or container runtime. `pstree -s -p PID` is faster than walking by hand.
- `rss` is pages currently resident. It is the number that matters for memory pressure. `vsz` is address space.
- In cgroup-limited containers, `ps` still reports host-relative `%CPU`. Check quota before you call the process idle or greedy.
- Snapshot twice, 5–10 seconds apart, when the claim is “it is stuck”. A single line cannot show a process that is making progress.

## Related Notes

- [[top Deep Dive]]
- [[pidstat Deep Dive]]
- [[lsof Deep Dive]]
- [[File Descriptors]]
- [[Processes and Threads]]
- [[High CPU Runbook]]
- [[High Load Low CPU]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A box with load 40 and almost no `%CPU` in `ps aux` was 30 processes in `D` on a dead NFS mount. Sorting by CPU hid the real state. I now always keep `stat` and `wchan` in the format string.
- Zombies are almost never the problem. The parent is. Killing zombies does nothing; they are already dead. Fix or restart the reaper.
- I wasted time comparing `ps %CPU` to a Grafana 1-minute rate. Different clocks. Use `pidstat 1 5` when someone says “prove it is that PID”.
