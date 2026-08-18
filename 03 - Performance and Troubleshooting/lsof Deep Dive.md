# lsof Deep Dive

## Concept

`lsof` (list open files) shows which processes have which files, directories, sockets, and other file descriptors open.  
In Linux almost everything is a file, so `lsof` is extremely useful.

## Why it matters

Classic use cases:
- Finding which process is using a file or port
- Discovering deleted files that are still held open (and therefore still consuming space)
- Investigating file descriptor leaks
- Seeing network connections per process

## Mental Model

```
lsof shows the link between:
Process  ←→  File Descriptor  ←→  File / Socket / Pipe / etc.
```

## Key Commands

```bash
# Files opened by a process
lsof -p <PID>

# Process that has a specific file open
lsof /var/log/nginx/access.log

# Deleted files still held open (very common in disk-full situations)
lsof +L1
lsof | grep deleted

# Network connections
lsof -i
lsof -i :80
lsof -i TCP:443
lsof -i UDP

# Files opened by a user
lsof -u <username>

# Count open files per process (rough FD usage)
lsof | awk '{print $2}' | sort | uniq -c | sort -nr | head
```

## Common Failure Modes & Symptoms

| Situation                            | Useful lsof command              |
|--------------------------------------|----------------------------------|
| Disk full but du looks normal        | `lsof +L1`                       |
| “Too many open files”                | `lsof -p <PID>` + count FDs      |
| Who is listening on this port?       | `lsof -i :<port>`                |
| Which process has this file open?    | `lsof /path/to/file`             |
| FD leak investigation                | Watch `lsof -p <PID> | wc -l` over time |

## Investigation Tips

- `+L1` is one of the most valuable flags for disk space incidents.
- When a process holds a deleted file open, the space is only released when the process closes the FD or exits.
- `lsof` can be slow on systems with huge numbers of open files — narrow the scope with `-p`, `-u`, or `-i` when possible.
- For listening ports, `ss -tulpn` is often faster and clearer; use `lsof` when you need more detail about the file or process.

## Related Notes

- [[File Descriptors]]
- [[Disk Full Runbook]]
- [[ss Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
