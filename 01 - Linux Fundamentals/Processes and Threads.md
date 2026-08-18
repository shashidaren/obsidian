# Processes and Threads

## Concept

A **process** is an instance of a running program. It has its own address space, file descriptors, credentials, etc.

A **thread** is a unit of execution within a process. Multiple threads share the same address space and most resources, but each has its own stack and register state.

In Linux, threads are implemented as lightweight processes (tasks) that share resources.

## Why it matters

Many production problems appear as:
- Too many processes/threads (resource exhaustion)
- Threads stuck or deadlocked
- Runaway processes consuming CPU or memory
- Zombie processes
- Unexpected process trees after crashes or restarts

## Mental Model

```
Process
├── Address space (memory)
├── File descriptors
├── Credentials (UID/GID)
├── Threads
│   ├── Thread 1 (main)
│   ├── Thread 2
│   └── ...
└── Children processes (if any)
```

`ps` and `top` show tasks. By default many tools show threads as separate lines when using `-L` or `-T`.

## Key Commands

```bash
# Process overview
ps aux --sort=-%cpu | head -20
ps -ef

# Threads of a process
ps -T -p <PID>
top -H -p <PID>

# Process tree
pstree -p
pstree -p <PID>

# Detailed info about one process
cat /proc/<PID>/status
cat /proc/<PID>/cmdline
ls -l /proc/<PID>/fd          # open file descriptors

# Count threads
ps -eLf | wc -l
```

## Common Failure Modes & Symptoms

| Symptom                          | Likely cause                          | First checks                     |
|----------------------------------|---------------------------------------|----------------------------------|
| Very high process count          | Fork bomb, runaway workers, leak      | `ps aux | wc -l`, process tree   |
| Many threads in one process      | Thread leak or high concurrency       | `ps -T -p <PID>`                 |
| Processes in Z state             | Zombies (parent not reaping)          | `ps aux | awk '$8 ~ /Z/'`        |
| Processes stuck in D state       | Waiting on I/O (disk/NFS)             | `ps aux | awk '$8 ~ /D/'`        |
| Unexpected parent/child relation | Crash + restart, or container issues  | `pstree`, `ps -ef`               |

## Investigation Tips

- Always note both PID and PPID when investigating.
- For multi-threaded applications, look at threads (`-T` / `-H`) not just the main process.
- Zombies themselves consume almost no resources; the problem is usually the parent.
- In containers, PIDs are namespaced — host PID ≠ container PID.

## Related Notes

- [[File Descriptors]]
- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Memory Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
