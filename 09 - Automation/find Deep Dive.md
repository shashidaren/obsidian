# find Deep Dive

## Concept

`find` walks a tree, applies predicates, and optionally runs actions. It is authoritative: it looks at the filesystem *now*, not at an `updatedb` index.

The skill is not memorising every test. It is writing a selection that you can print, review, then reuse with `-delete` or `-exec` without expanding the match set by accident.

## Why it matters

- Disk-full, “who dropped this 40G file”, and leftover deploy artifacts are `find` jobs
- `-delete` and `-exec rm` have no undo
- Short-circuit evaluation and operator precedence (`-o` vs implied `-a`) change which files match
- On multi-million-inode trees, a sloppy walk is an outage of its own (load, NFS, cache thrash)

Print first. Delete second. Never the other way around.

## Mental Model

```
find [starting-points] [expression]

expression = tests + actions + operators

Tests     -name -iname -path -regex -type -size -mtime -mmin
          -user -group -nouser -perm -empty -newer -newermt
Actions   -print (default)  -print0  -ls  -printf  -delete
          -exec cmd {} \;    -exec cmd {} +
Operators -a (default)  -o  ! / -not  \( \)
          -prune  (do not descend)
```

Left-to-right, short-circuit. `find / -path /proc -prune -o -name core -print` only prints `core` *outside* `/proc` because `-prune` is on the left of `-o`.

Default: do not follow symlinks (`-P`). `-L` follows them and can walk into the same tree twice or into a network mount you did not intend.

`-exec … \;` is one invocation per file. `-exec … +` batches like `xargs`. Prefer `+` unless the command cannot take multiple operands.

## Key Commands

```bash
# Name / type — quote the pattern so the shell does not glob it
find /var/log -name '*.log'
find /home -type d -name '.git'
find /tmp -type f -name 'core*'

# Size and time  (size: c bytes, k, M, G; + means greater than)
find /var -type f -size +100M
find /var/log -type f -mtime +30 -name '*.gz'
find /tmp -type f -mmin -15                    # modified in last 15 minutes
find /app -type f -newermt '2026-09-01'
find /app -type f -newer /tmp/last-deploy.stamp

# Ownership / mode
find / -perm -4000 2>/dev/null                 # setuid
find / -nouser -o -nogroup 2>/dev/null
find /etc -type f ! -perm 644 -ls

# Safe mutation pattern
find /tmp -type f -name 'orphaned-*' -print    # review
find /tmp -type f -name 'orphaned-*' -ls       # extra metadata
find /tmp -type f -name 'orphaned-*' -delete   # only after the list looks right

# -exec
find /var/www -type f -name '*.php' -exec grep -l -- 'eval(' {} +
find /data -type f -name '*.csv' -exec gzip -9 {} +

# Weird names
find /path -type f -print0 | xargs -0 grep -l -- pattern

# Depth and prune
find /etc -maxdepth 2 -type f -name '*.conf'
find / -path /proc -prune -o -path /sys -prune -o -path /snap -prune -o \
     -type f -name 'secret*' -print 2>/dev/null

# Inode pressure: lots of tiny files
find /var/spool -type f | wc -l
```

GNU `find` also has `-printf '%p %k\n'` for custom columns. BusyBox `find` is a subset — test on the target OS, not on your laptop.

## Common Failure Modes & Symptoms

| What happens | Likely cause | Fix / next step |
|--------------|--------------|-----------------|
| Screen full of `Permission denied` | Walking `/` as non-root | `2>/dev/null` or start lower |
| Missed or extra files with spaces | Splitting on whitespace | `-print0` / `-exec` |
| Deleted more than intended | Broad `-name '*'` + `-delete`, or `-o` grouping | Re-print; wrap `\( \)` |
| Walk never finishes / load spikes | Started at `/` on a host with NFS and huge trees | Narrow path, `-xdev`, `-maxdepth`, prune |
| Same file processed twice | `-L` followed a link back into the tree | Drop `-L`; use `-xtype` if needed |
| `-mtime` “missed today’s files” | Unit is *24-hour periods*, not calendar days | Use `-mmin` or `-newermt` |
| `-exec` “works on some files” | `\;` vs `+`, or command returns non-zero | Check `man find` on `+` abort rules |
| `locate` disagrees with `find` | Stale `updatedb` | Believe `find` |

## Investigation Tips

- Start at the narrowest directory that can contain the answer. `/` is a last resort.
- `-xdev` stays on one filesystem — use it when `/var` is local and `/mnt/nfs` is not your problem.
- Disk-full: `find /var -xdev -type f -size +50M -printf '%s %p\n' | sort -nr | head`. Then `du`/`ncdu` for directory totals.
- `-atime` is unreliable on filesystems mounted `noatime` or `relatime` — most servers.
- For “changed since the last deploy”, touch a stamp file in the change window and use `-newer`.
- `locate`/`plocate` is the right first search when you only have a filename and the index is fresh. Confirm with `find` before deleting.
- Cron jobs that `find / -mtime +30 -delete` without `-xdev` will one day walk a mounted backup and erase it.

## Related Notes

- [[df and du Deep Dive]]
- [[Disk Full Runbook]]
- [[Inodes]]
- [[grep awk and sed]]
- [[rsync]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once ran `find /var/log -name '*.gz' -mtime +7 -delete` during an incident. A bind-mounted copy of `/var/log` from another environment was under that tree. Print-then-delete would have shown foreign paths.
- `-mtime -1` does not mean “since midnight”. It means “less than 24 hours ago”. On-call arguments about “today’s logs” ended when we switched to `-newermt '2026-09-18 00:00'`.
- On a host with 80 million inodes, unscoped `find /` raised load enough to trip the same alerts we were investigating. Scope, prune, `-xdev`.
