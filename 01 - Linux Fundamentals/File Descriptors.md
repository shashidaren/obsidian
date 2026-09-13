# File Descriptors

## Concept

A file descriptor (FD) is an integer handle a process uses to talk to an open file, socket, pipe, epoll instance, or other I/O object. The kernel keeps a per-process table; userspace only ever sees the small integers.

Every process starts with:

- `0` stdin
- `1` stdout
- `2` stderr

The next `open()`, `socket()`, `accept()`, `pipe()`, or `dup()` takes the lowest unused number. Closing an FD frees that slot; leaking one does not.

## Why it matters

Hitting the per-process or system-wide FD ceiling is one of the most common “the box looks fine but the app is dead” failures:

- Listeners stop accepting (`Too many open files`, `EMFILE`, `ENFILE`)
- Log files cannot be opened, so the app fails closed or silently stops logging
- Health checks fail while CPU and RAM still look idle

Deleted-but-still-open files also hide disk usage from `du` and keep filling the filesystem until the holder exits. That is an FD problem, not a “disk full mystery”.

## Mental Model

```
Process
└── FD table (soft limit = RLIMIT_NOFILE)
    ├── 0,1,2 → stdio
    ├── 3     → regular file / log
    ├── 4     → listening socket
    ├── 5..N  → accepted connections, pipes, inotify, ...
    └── each entry → file table entry → inode / sock

Two ceilings:
  per-process  ulimit -n / systemd LimitNOFILE / container nofile
  system-wide  fs.file-max   (and fs.nr_open as the hard cap on RLIMIT_NOFILE)
```

`/proc/<pid>/fd` is the live table. `lsof` and `ss` are views of the same objects. Soft limit is what the process actually hits; hard limit is what it can raise to without privilege.

systemd units default to a modest `LimitNOFILE` on many distros. Raising `ulimit -n` in your interactive shell does **not** change a service that was started by systemd.

## Key Commands

```bash
# Shell / login limits (not the same as a systemd service)
ulimit -n
ulimit -Hn
ulimit -a

# What a running process is actually allowed and using
cat /proc/<PID>/limits | grep -E 'open files|Max open'
ls /proc/<PID>/fd | wc -l
ls -l /proc/<PID>/fd | head
readlink /proc/<PID>/fd/* | sort | uniq -c | sort -nr | head

# Map FDs to names, including sockets and deleted files
lsof -p <PID>
lsof -p <PID> | awk '$4 ~ /DEL|[0-9]+[uw]/'
lsof +L1                    # open, unlinked files still holding space

# Who is hogging FDs on the host
lsof 2>/dev/null | awk 'NR>1 {print $2}' | sort | uniq -c | sort -nr | head

# System-wide allocated / unused / max
cat /proc/sys/fs/file-nr
cat /proc/sys/fs/file-max
cat /proc/sys/fs/nr_open

# systemd service limit (the one that actually matters for daemons)
systemctl show <service> -p LimitNOFILE
systemctl cat <service> | grep -i nofile

# Persistent bump for one unit
mkdir -p /etc/systemd/system/<service>.service.d
cat >/etc/systemd/system/<service>.service.d/nofile.conf <<'EOF'
[Service]
LimitNOFILE=65536
EOF
systemctl daemon-reload
systemctl restart <service>

# Sockets specifically (often the leak)
ss -antp | grep <PID>
ss -s
```

`file-nr` columns are: allocated FDs, unused but allocated, maximum. On modern kernels the middle column is usually `0`; watch the first vs the third.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| `Too many open files` / `EMFILE` | Process hit its soft `RLIMIT_NOFILE` | `/proc/<pid>/limits` vs `ls /proc/<pid>/fd \| wc -l` |
| `ENFILE` | System-wide `fs.file-max` exhausted | `file-nr` vs `file-max` |
| Listener up, new clients time out | Accept path cannot allocate an FD | FD count on the listener PID; `ss -s` |
| FD count climbs and never falls | Leak: connections, files, or inotify watches not closed | `readlink /proc/<pid>/fd/*` grouped by type |
| `df` high, `du` low | Deleted file still open | `lsof +L1` |
| Limit raise “did nothing” | You changed the shell, not the unit | `systemctl show -p LimitNOFILE` |
| Container hits the limit, host does not | Runtime `--ulimit nofile=` or cgroup | Inspect container spec and `/proc/1/limits` *inside* |
| After logrotate, disk stays full | App still holds the rotated inode | `lsof +L1` on the log path |

## Investigation Tips

- Compare **used** vs **soft limit** on the exact PID, not on your SSH session.
- Group `/proc/<pid>/fd` targets: if most are `socket:[...]`, it is connection leakage or missing keep-alive/timeouts. If most are regular files, look at temp files, language runtimes, or a log file opened per request.
- For systemd, put `LimitNOFILE` in a drop-in. Editing `/etc/security/limits.conf` only affects PAM logins.
- Raising the limit is mitigation. If the count is monotonic over hours, find the leak; a higher ceiling only delays the outage.
- `ss -antp` + application metrics (active connections, pool size) should roughly agree. When they do not, something is holding sockets in `CLOSE-WAIT` or `FIN-WAIT`.
- Inotify watches have their own cap (`fs.inotify.max_user_watches`) and also consume FDs. IDEs and recursive file watchers are frequent offenders on jump boxes.
- After a disk-full incident, always run `lsof +L1` before you start deleting “mystery” usage.

## Related Notes

- [[Processes and Threads]]
- [[lsof Deep Dive]]
- [[ss Deep Dive]]
- [[Connection Exhaustion]]
- [[logrotate]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service “needed 1 million FDs” according to the ticket. `ls /proc/pid/fd` showed 60k sockets in `CLOSE-WAIT` because the load balancer idle timeout was longer than the app’s. Fixing timeouts dropped usage by an order of magnitude; the ulimit change was optional.
- I once raised `ulimit -n` in `/etc/profile` and wondered why nginx still died. nginx was a systemd unit. `systemctl show nginx -p LimitNOFILE` told the truth immediately.
- `df` said `/var` was 100% and `du` could not find the bytes. `lsof +L1` showed a 40 GiB deleted `app.log` held by a process that had not been HUP’d after rotate. Restart released the inode; logrotate’s `postrotate` was the real fix.
