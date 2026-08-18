# df and du Deep Dive

## Concept

- **`df`** reports filesystem-level allocation (what the filesystem thinks is used/free).
- **`du`** walks the directory tree and sums the size of files it can see.

They often disagree. Understanding *why* is a core troubleshooting skill.

## Why it matters

A large gap between `df` and `du` usually means one of:
- Deleted files that are still held open by a process
- Mount points hiding data
- Permission or namespace differences
- Different filesystems / bind mounts

## Mental Model

```
df  = “How full is the filesystem?”
du  = “How much space do the visible files under this path consume?”
```

When `df` shows high usage but `du` shows much less → look for deleted-but-open files or data hidden under mount points.

## Key Commands

```bash
# Filesystem usage
df -hT
df -i

# Directory usage (one level)
du -xhd1 /var 2>/dev/null | sort -hr | head -20

# Summary of a tree
du -sh /var/log

# Exclude other filesystems (-x is important)
du -xhd1 / 2>/dev/null | sort -hr

# Find large files
find /var -xdev -type f -size +100M -exec ls -lh {} \; 2>/dev/null | sort -k5 -hr | head
```

## Common Discrepancy Causes

| Situation                        | What you see                     | How to confirm                      |
|----------------------------------|----------------------------------|-------------------------------------|
| Deleted file still open          | df high, du lower                | `lsof +L1` or `lsof | grep deleted` |
| Data under a mount point         | du on parent misses the data     | `findmnt`, `mount`, check order     |
| Permission denied                | du under-reports                 | Run as root, check errors           |
| Different filesystem             | du without -x crosses mounts     | Always use `-x` or `-xdev`          |
| Sparse files                     | du and ls can differ             | `ls -ls`, `du --apparent-size`      |

## Investigation Tips

- Always use `du -x` (or `find -xdev`) when investigating a single filesystem.
- When `df` and `du` disagree significantly, run `lsof +L1` first.
- For interactive exploration, `ncdu -x /path` is excellent if available.

## Related Notes

- [[Disk Full Runbook]]
- [[Inodes]]
- [[lsof Deep Dive]]
- [[Filesystems and Mounts]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
