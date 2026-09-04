# lsof Deep Dive

## Concept

`lsof` lists open files. On Linux that includes regular files, deleted files still held open, directories, block devices, UNIX sockets, TCP/UDP sockets, pipes, and anonymous memory mappings. It answers “who holds this?” when `ss`, `fuser`, and `ls` are not enough.

It is a snapshot of the kernel’s file-descriptor tables, not a live tracer. Treat it as evidence at a point in time.

## Why it matters

- Disk-full incidents where `du` looks fine are usually deleted files still open
- “Too many open files” is an FD leak until you prove otherwise; `lsof -p` is the proof
- Port ownership, NFS file holders, and “target is busy” unmounts all show up here
- It is slower and noisier than `ss -tulpn` for listening sockets — use the right tool

If space disappears after logrotate, look for `(deleted)` before you grow the volume.

## Mental Model

```
process
  → FD table (0, 1, 2, …)
      → file object
          → inode / socket / pipe
              → path (or “(deleted)”, or “TCP …”)

Unlink does not free blocks while any FD still references the inode.
lsof +L1  → link count < 1  → deleted-but-open
```

Columns you actually use: `COMMAND`, `PID`, `USER`, `FD`, `TYPE`, `DEVICE`, `SIZE/OFF`, `NODE`, `NAME`.

FD suffixes: `u` read/write, `r` read, `w` write, `mem` mmap, `cwd` working directory, `txt` the binary itself, `DEL` deleted mapping.

## Key Commands

```bash
# Everything one process has open (start here for leaks)
lsof -nP -p <PID>
lsof -nP -p <PID> | wc -l

# Who has this path open?
lsof -nP /var/log/nginx/access.log
lsof -nP +D /var/lib/mysql          # recursive; can be slow and miss some types

# Deleted files still consuming space
lsof -nP +L1
lsof -nP +L1 | awk 'NR==1 || $7 > 100000000'   # big holders only
# SIZE/OFF is column 7 on most builds; confirm the header first

# Network (prefer ss for listeners; lsof when you need the process + path)
lsof -nP -iTCP:443 -sTCP:LISTEN
lsof -nP -iTCP -sTCP:ESTABLISHED
lsof -nP -iUDP

lsof -nP -a -p <PID> -i                 # only network FDs for one PID

# User / command filters
lsof -nP -u www-data
lsof -nP -c nginx
lsof -nP -c /^python/

# Repeat every 2s without reopening (good for leak watch)
lsof -nP -p <PID> -r 2 | head

# Count FDs per PID (rough; header lines included — subtract 1)
lsof -nP | awk 'NR>1 {c[$2]++} END {for (p in c) print c[p], p}' | sort -nr | head

# Compare against the process limit
ls /proc/<PID>/fd | wc -l
cat /proc/<PID>/limits | grep 'open files'
```

`-n` skips DNS. `-P` skips `/etc/services` names. Always use both on a sick box.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `df` 100%, `du` much smaller | Deleted files held open | `lsof +L1`, then restart or copytruncate-aware rotate |
| `Too many open files` | Leak, or `LimitNOFILE` too low | `ls /proc/PID/fd \| wc -l` vs `limits`; `lsof -p` |
| `target is busy` on umount | cwd, open file, or nested mount | `lsof +f -- /mnt/data`; also `findmnt -R` |
| Who is on this port? | Listener or leftover client | `ss -tulpn` first, `lsof -i :PORT` if you need NAME |
| Space not freed after logrotate | Process still has old inode | `lsof +L1 \| grep log`; send `USR1` / restart |
| NFS “file in use” | Remote holder or local lock | `lsof` on the *client* that mounted it |
| `lsof` hangs | Blocked NFS/CIFS or huge FD tables | Narrow with `-p`/`-i`; `timeout 10 lsof -p PID` |
| Counts do not match `/proc/PID/fd` | Threads, `lsof` vs kernel view, or `-p` missing children | `ls /proc/PID/fd`; `lsof -p PID -R` |

## Investigation Tips

- For disk-full, `lsof +L1` beats guessing. Sort by size, confirm the command, then restart *that* process — not the whole host.
- `logrotate` without `copytruncate` (or an app that does not reopen on `USR1`) is the usual deleted-file factory. Fix the rotate config after you recover space.
- `ss -tulpn` is faster and enough for “what listens on 443”. Use `lsof` when the name is a UNIX socket path or you need the file behind the FD.
- Recursive `+D` walks the tree and will miss files that are open but no longer under that path (deleted, moved). Prefer `+L1` or `-p`.
- Containers: host `lsof` sees host PIDs. Inside the container the same inode has a different PID. Match on inode (`NODE` column) if you must correlate.
- Do not parse `lsof` in cron on a busy database host. It can stall on every FD. Sample `/proc/<pid>/fd` instead.
- Threaded processes share an FD table. One `lsof -p` is enough; summing every TID double-counts.

## Related Notes

- [[File Descriptors]]
- [[Disk Full Runbook]]
- [[ss Deep Dive]]
- [[df and du Deep Dive]]
- [[mount and findmnt]]
- [[pidstat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The largest “mystery” disk-full I have cleaned was a 40G `java` heap dump the JVM still had open after `rm`. `lsof +L1` named the PID in one shot; `kill` was the reclaim.
- I stopped using `lsof -i` as the first port check. On a host with tens of thousands of connections it is slower than `ss` and easy to interrupt mid-output, which looks like “nothing is listening”.
- When `lsof +L1` is empty and `df`/`du` still disagree, the missing space is usually another mount, reserved blocks, or a sparse file — not an open-deleted file.
