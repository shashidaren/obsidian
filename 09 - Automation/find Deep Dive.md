# find Deep Dive

## Concept

`find` walks a directory tree, selects entries by predicates (name, type, size, time, permissions, etc.), and optionally runs actions on the matches. It is the standard tool for locating files when you do not already know the exact path.

## Why it matters

- Disk-full and “where did this file go” investigations almost always need `find`
- Destructive actions (`-delete`, `-exec rm`) are easy to get wrong; test selection first
- Combined with `-exec`, `xargs`, or `-print0` it becomes a powerful batch processor
- Understanding predicates and short-circuit evaluation prevents both missed files and accidental mass deletion

Never run a destructive `find` against production without a dry-run that only prints paths.

## Mental Model

```
find [path...] [expression]

Expression = tests + actions + operators

Tests:   -name, -type, -size, -mtime, -user, -perm, -path, …
Actions: -print (default), -ls, -delete, -exec … \;  or  -exec … +
Operators: -a (and, default), -o (or), ! / -not, \( \)

Evaluation is left-to-right with short-circuiting.
-exec … \;  runs once per file;  -exec … +  batches arguments.
```

Paths are relative to the starting points you give. Symbolic links are not followed by default (`-L` changes that).

## Key Commands

```bash
# Basic name and type
find /var/log -name '*.log'
find /home -type d -name '.git'
find /tmp -type f -name 'core.*'

# Size and time
find / -type f -size +100M 2>/dev/null          # large files
find /var -type f -mtime -1                     # modified in last 24h
find /tmp -type f -atime +7                     # not accessed in 7+ days
find /var/log -type f -mtime +30 -name '*.gz'

# Permissions and ownership
find / -perm -4000 2>/dev/null                  # setuid
find /home -user nobody -o -nouser
find /etc -type f ! -perm 644 -ls

# Safe delete pattern: list first, then delete
find /tmp -type f -name 'orphaned-*' -print
find /tmp -type f -name 'orphaned-*' -delete    # only after review

# Execute commands
find /var/www -type f -name '*.php' -exec grep -l 'eval(' {} \;
find /data -type f -name '*.csv' -exec gzip {} +

# Null-delimited for safety with weird names
find /path -type f -print0 | xargs -0 grep -l pattern

# Limit depth
find /etc -maxdepth 2 -type f -name '*.conf'

# Exclude paths
find / -path /proc -prune -o -path /sys -prune -o -type f -name 'secret*' -print 2>/dev/null
```

## Common Failure Modes & Symptoms

| What happens                         | Likely cause                              | Fix / next step                               |
|--------------------------------------|-------------------------------------------|-----------------------------------------------|
| “Permission denied” noise            | Traversing unreadable dirs                | Redirect stderr or use `-readable`            |
| Missed files with spaces/newlines    | Parsing `find` output with for-loops      | Use `-print0` + `xargs -0` or `-exec`         |
| Deleted more than intended           | Broad predicate + `-delete`               | Always `-print` first; use `-path` carefully  |
| Slow on huge trees                   | Full walk of large filesystems            | Narrow path, `-maxdepth`, or locate if indexed|
| Followed symlink into unexpected tree| `-L` or default behaviour misunderstood   | Prefer default (no follow) unless needed      |
| `-exec` fails on some files          | Command exits non-zero; `\;` vs `+`       | Check exit status; prefer `+` for speed       |

## Investigation Tips

- Start with the narrowest path and predicates that still answer the question.
- For disk-full work, combine with `du` / `ncdu` and sort by size; `find -size` is a good first filter.
- `-mtime` / `-atime` / `-ctime` are in *days*; use `-mmin` for finer granularity.
- When piping to other tools, `-print0` is the robust default on modern systems.
- `locate` / `plocate` (updatedb) is faster for name-only searches on indexed systems, but can be stale; `find` is authoritative.
- For “files changed since boot / since deploy”, prefer `-newermt` or compare against a reference file with `-newer`.

## Related Notes

- [[df and du Deep Dive]]
- [[Disk Full Runbook]]
- [[Inodes]]
- [[grep awk and sed]]
- [[rsync]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
