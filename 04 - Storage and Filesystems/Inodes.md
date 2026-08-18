# Inodes

## Concept

An **inode** is a filesystem data structure that stores metadata about a file or directory (permissions, owner, size, timestamps, pointers to data blocks, etc.).  
The actual filename lives in the directory entry; the inode holds everything else.

Every filesystem has a fixed number of inodes created at format time (or dynamically managed in some modern filesystems).

## Why it matters

A filesystem can report “No space left on device” even when `df -h` shows free space, if it has run out of inodes.  
This is especially common with millions of small files (mail queues, session files, container layers, monitoring metrics, etc.).

## Mental Model

```
Filesystem capacity has two limits:
1. Data blocks  → shown by df -h
2. Inodes       → shown by df -i
```

You can have free blocks but zero free inodes (or the reverse).

## Key Commands

```bash
# Inode usage overview
df -i

# Detailed view for one filesystem
df -i /var

# Find directories containing huge numbers of files
find /var -xdev -type d -exec sh -c 'echo $(find "$1" -maxdepth 1 -type f | wc -l) files in $1' _ {} \; 2>/dev/null | sort -nr | head -20

# Count inodes used under a path
find /path -xdev -printf "%i\n" | sort -u | wc -l
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| “No space left on device” but df -h OK | Inode exhaustion                          | `df -i`                          |
| Cannot create new files/directories  | No free inodes                            | `df -i`, find large directories  |
| Sudden inode exhaustion              | Application creating millions of small files | Check mail, sessions, tmp, containers |

## Investigation Tips

- Always run both `df -h` **and** `df -i` when investigating space issues.
- Common culprits: PHP sessions, mail spools, Nginx/Apache cache, Docker overlay, monitoring agents, CI artifacts.
- On XFS and some other filesystems inode allocation is more flexible, but you can still run out.

## Related Notes

- [[Disk Full Runbook]]
- [[df and du Deep Dive]]
- [[Filesystems and Mounts]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
