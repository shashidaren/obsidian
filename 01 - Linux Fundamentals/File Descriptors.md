# File Descriptors

## Concept

A **file descriptor** (FD) is a handle that a process uses to access a file, socket, pipe, or other I/O resource.  
Every process starts with three standard FDs:

- 0 = stdin
- 1 = stdout
- 2 = stderr

New FDs are allocated when the process opens files, accepts connections, creates pipes, etc.

## Why it matters

When a process hits its FD limit it can no longer:
- Accept new network connections
- Open files or logs
- Create pipes or sockets

This often surfaces as “Too many open files” errors and can make an otherwise healthy service unavailable.

## Mental Model

```
Process
└── FD table
    ├── 0 → terminal / pipe
    ├── 1 → terminal / pipe
    ├── 2 → terminal / pipe
    ├── 3 → regular file
    ├── 4 → listening socket
    ├── 5 → accepted connection
    └── ...
```

Limits exist at two levels:
- Per-process limit (`ulimit -n` / `LimitNOFILE`)
- System-wide limit (`fs.file-max`)

## Key Commands

```bash
# Current limits for the shell
ulimit -n
ulimit -a

# Limits of a running process
cat /proc/<PID>/limits | grep 'open files'

# How many FDs a process is using
ls /proc/<PID>/fd | wc -l

# What the FDs point to
ls -l /proc/<PID>/fd
lsof -p <PID>

# System-wide usage
cat /proc/sys/fs/file-nr          # allocated, free, max

# Find processes with many open files
lsof | awk '{print $2}' | sort | uniq -c | sort -nr | head
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                         | First checks                        |
|--------------------------------------|--------------------------------------|-------------------------------------|
| “Too many open files” in logs        | Process hit its nofile limit         | `cat /proc/<PID>/limits`, `lsof`    |
| Service cannot accept new connections| FD exhaustion on listening process   | Count of FDs for that PID           |
| Gradual increase in open files       | FD leak (forgot to close)            | Watch `ls /proc/<PID>/fd | wc -l`   |
| High system-wide FD usage            | Many processes or system limit too low | `cat /proc/sys/fs/file-nr`        |

## Investigation Tips

- Always check both the process limit and the actual number of open FDs.
- For systemd services, look at `LimitNOFILE` in the unit file or drop-in.
- In containers, the limit may be set by the runtime or cgroup.
- `lsof +L1` is also useful when investigating deleted-but-still-open files.

## Related Notes

- [[Processes and Threads]]
- [[lsof Deep Dive]]
- [[ss Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
