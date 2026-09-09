# Inodes

## Concept

An inode is the filesystem object that holds a file’s metadata: owner, mode, timestamps, link count, and pointers to data blocks. The name lives in a directory entry and points at an inode number. Many names can point at one inode (hard links). When the last name is unlinked *and* the last file descriptor closes, the inode and its blocks are freed.

Filesystems also have a finite inode table (fixed at mkfs on ext4; more flexible on XFS). Running out of inodes returns `ENOSPC` / “No space left on device” even when `df -h` shows free space.

## Why it matters

- Millions of tiny files (sessions, mail queue, caches, build artifacts, container layers, metric shards) exhaust inodes long before they exhaust bytes.
- The error message does not say “inodes”. Every junior ticket starts with “but `df -h` has 40% free”.
- You cannot add inodes to a live ext4 filesystem in any practical way. Prevention and cleanup are the whole game.
- Deleted-open files still consume the inode until the process exits. Same class of bug as the `df`/`du` gap.

`df -i` belongs next to `df -h` in every disk runbook. Not below it. Next to it.

## Mental Model

```
Directory entry:  name → inode #
Inode:            metadata + block map
Data blocks:      file contents

Capacity limits:
  blocks  → df -h
  inodes  → df -i

IUsed / IFree is per filesystem, not per directory.
A directory with 2 million files can sink the whole FS.
```

ext4: inode count is chosen at format (`mkfs.ext4 -N` or bytes-per-inode `-i`). Default is generous for general use and tight for “millions of 1K files”.

XFS: dynamically allocates inode clusters. You still run out in practice on a volume stuffed with tiny files; `df -i` still matters.

tmpfs, overlay, NFS: inode limits still exist and fail in uglier ways (NFS `EDQUOT`, overlay “no space” from the backing FS).

## Key Commands

```bash
# The slide you should already have on screen
df -hT
df -i

# One filesystem
df -i /var
findmnt /var

# Which directories hold the files (inode *count*, not bytes)
# Fast-enough first pass: one level
du --inodes -xd1 /var 2>/dev/null | sort -nr | head -20

# Deeper offenders (can be slow on huge trees)
find /var -xdev -type d -printf '%h\n' 2>/dev/null | true
# Practical: check known factories first
ls /var/lib/php/sessions 2>/dev/null | wc -l
ls /var/spool/postfix/incoming 2>/dev/null | wc -l
ls /tmp 2>/dev/null | wc -l
find /var/tmp /tmp /var/cache /var/lib/nginx /var/lib/docker -xdev -type f 2>/dev/null | awk -F/ 'NF<8{c[$0]++}' 

# Count files immediately in hot dirs
for d in /var/spool /var/tmp /tmp /var/cache /var/lib; do
  echo -n "$d "
  find "$d" -xdev -maxdepth 2 -type f 2>/dev/null | wc -l
done

# Inode of a specific file; hard links share it
stat /path/to/file
ls -li /path/to/file

# mkfs planning (offline / new volume)
tune2fs -l /dev/vg00/var | grep -E 'Inode|Block|Reserved'
xfs_info /var
```

Do not start with a recursive `find / -type f | wc -l` on a 20 TB NAS mount. Scope to one filesystem (`-xdev`) and likely directories.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `No space left on device` but `df -h` healthy | Inode table full | `df -i` |
| Cannot create files, can append to existing | No free inodes | `df -i`, then find tiny-file factories |
| PHP / app “failed to open session” | Session dir millions of files | count `/var/lib/php/sessions` |
| Mail queue disk “not full” but postfix stuck | One file per message | `find /var/spool -xdev | wc -l` |
| CI runner or container host dies after a week | Layers, caches, leftover overlay inodes | docker/podman disk usage; `/var/lib/container*` |
| `df -i` 100% on root after extract of a tarball | Archive of huge empty-ish tree | find the extract directory |
| Cleanup deleted names, `df -i` unchanged | Process still holds inodes | `lsof +L1` |

## Investigation Tips

- Pair every space ticket with `df -h` and `df -i` before you talk about adding disk.
- `du --inodes -xd1` is the least-known useful flag. Use it.
- Fix the producer, not only the pile. Deleting 8 million session files without fixing `session.gc` or a cron cleaner is a ticket that reopens next week.
- `find … -delete` on millions of files can take hours and hammer the filesystem. Batch it. Prefer the application’s own purge.
- Creating a new ext4 volume for a known tiny-file workload: raise inode density (`mkfs.ext4 -i 4096` or similar) *before* you copy data. You will not get a second chance without backup + mkfs.
- XFS is kinder here but not magic. Project quotas and a dedicated LV still beat “just use XFS”.
- Inodes are per filesystem. Moving `/var/lib/docker` to its own LV isolates the blast radius. That is capacity architecture, not a cleanup trick.

## Related Notes

- [[Disk Full Runbook]]
- [[df and du Deep Dive]]
- [[Filesystems and Mounts]]
- [[ext4 Operations]]
- [[XFS Operations]]
- [[lsof Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A monitoring agent wrote one tiny status file per check per host into `/var/cache` and never expired them. Bytes were fine. Inodes hit 100% on a Friday. `df -i` was not in the alert set. It is now.
- `rm -rf` of 12 million session files locked the disk for so long that we looked worse than the original outage. `find … -mtime +1 -delete` in batches, nice/ionice, and fix PHP gc.
- Someone “fixed” inode exhaustion by adding a bigger disk and rsyncing the same tree onto ext4 with default inode ratio. Same outage, larger disk. Count files *before* you choose mkfs parameters.
- Overlay2 on a busy CI node can look like inode death on `/`. Dedicate a filesystem to the container graph. Do not share it with `/var/log`.
