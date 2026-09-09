# df and du Deep Dive

## Concept

`df` asks the filesystem how many blocks and inodes it has allocated. `du` walks a directory tree and sums the files it is allowed to see. They measure different things. When they disagree, the disagreement *is* the incident.

## Why it matters

- “Disk is 100% but I deleted 40G” is almost always an open-deleted file, a mount hiding a tree, or `du` crossing / not crossing filesystems.
- Filling `/` or `/var` takes down logging, package installs, databases, and sometimes the ability to log in.
- Blind `rm -rf` on the biggest `du` directory without checking mounts has deleted the wrong dataset more than once.
- Capacity alerts based only on `df` miss inode exhaustion; alerts based only on `du` miss deleted-open files.

If you cannot explain a `df` vs `du` gap in two minutes, you do not yet know where the bytes are.

## Mental Model

```
df  = filesystem allocator view   (superblock / statfs)
      includes: blocks owned by deleted-but-open files
      includes: reserved blocks (ext4 5% by default, often root-only)
      excludes: other filesystems (each line is one mount)

du  = walk of names you can stat
      misses: files you cannot read
      misses: data hidden *under* a mount point
      double-counts: if you forget -x and cross into other mounts
      differs on: sparse files, compression, snapshots
```

Classic gap:

```
df /var   says  90G used
du -sx /var  says  20G used

90 - 20 = 70G unaccounted
  → lsof +L1          (deleted open files)
  → findmnt /var      (something mounted on top of a full directory)
  → reserved blocks   (tune2fs -l, usually not tens of GB)
```

Reserved space on ext4 (`mke2fs -m 5`) makes `df` look fuller than users can write. That is by design, not a leak.

## Key Commands

```bash
# Filesystem view
df -hT
df -hT / /var /tmp /home
df -i
df -h --output=source,fstype,size,used,avail,pcent,itotal,iused,ipcent,target

# Tree view, stay on one filesystem
du -xhd1 / 2>/dev/null | sort -hr | head
du -xhd1 /var 2>/dev/null | sort -hr | head -20
du -sh /var/log

# Apparent size vs allocated (sparse files)
du -sh --apparent-size /path
du -sh /path

# Deleted but still allocated
lsof +L1
lsof | awk '/deleted/ {print}'
# per-pid size of deleted fds
find /proc/*/fd -ls 2>/dev/null | grep deleted

# What is mounted where (hiding data under a mount)
findmnt -R /
findmnt /var /var/log /var/lib/docker
lsblk -f

# Large files on one device
find /var -xdev -type f -size +100M -printf '%s %p\n' 2>/dev/null | sort -nr | head

# Interactive, if installed
ncdu -x /
```

`/` vs `/var` vs overlay mounts in containers: always pass `-x` / `-xdev` unless you *intend* to cross.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `df` 100%, `du` much smaller | Deleted-open file or hidden tree under a mount | `lsof +L1`, `findmnt` |
| `du` huge, `df` fine on that path | `du` crossed into another mount | rerun with `-x` |
| Deleted 20G, `df` unchanged | Process still holds the inode | `lsof +L1`; restart/truncate that pid |
| `Permission denied` lines from `du` | Under-count; not the real usage | rerun as root |
| `df` shows 5–10% used you cannot find | ext4 reserved blocks | `tune2fs -l /dev/X \| grep Reserved` |
| Sparse image files look huge in `ls` | Apparent size ≠ allocated | `du` vs `du --apparent-size`, `ls -ls` |
| Docker/overlay host `df` 100% | Layer or log file inside the graph driver | `du -xhd1` on the docker root; not just `/var` |
| Btrfs/ZFS/XFS quota or reflink confusion | Different accounting than ext4 | use the FS-native tools, not only `du` |

## Investigation Tips

- Script the first minute: `df -hT; df -i; du -xhd1 /var | sort -hr | head; lsof +L1 | head`.
- If you must free space *now* and `lsof +L1` shows a 30G `deleted` log, `truncate -s 0 /proc/<pid>/fd/<n>` can reclaim without killing the process. Restarting is cleaner when you can.
- Data under a mount: unmount (or mount `--bind` the parent elsewhere) to see the hidden directory. This is how leftover files from before `/var` became its own LV survive for years.
- `ncdu -x` is the fastest human interface. Install it on jump boxes.
- In containers, `df` inside the container is the *container* view. Check the host graph driver when the node disk is the real problem.
- Cron that runs `du -s /` without `-x` will page you about `/` being huge because it counted `/mnt/nfs`.
- After cleanup, confirm both `df` *and* application health. Truncating an open database file is not “log cleanup”.

## Related Notes

- [[Disk Full Runbook]]
- [[Inodes]]
- [[lsof Deep Dive]]
- [[Filesystems and Mounts]]
- [[logrotate]]
- [[LVM Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst `df` vs `du` gap I chased was 80G “missing” on `/var`. A bind-mounted log volume sat on top of a directory that had been filling for months *under* the mount. `du /var` never saw it. `findmnt` would have ended it in thirty seconds.
- A Java service rotated logs by renaming and opening a new file but never closed the old fd. `logrotate` + `copytruncate` was not in play; the app just leaked inodes. `lsof +L1` plus a rolling restart reclaimed the disk. The durable fix was a proper reopen or `copytruncate`.
- I have watched someone `rm -rf` the biggest `du` number, which was an NFS mount they had descended into without `-x`. Always `-x`, always `findmnt` before delete.
- Reserved blocks on a small root filesystem made “5% free” unusable for the app user. `df` looked healthy-ish; the app got `ENOSPC`. Check who is allowed to use the reserve.
