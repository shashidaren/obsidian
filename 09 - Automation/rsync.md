# rsync

## Concept

`rsync` efficiently synchronises files and directory trees between local paths or over SSH/daemon connections. It transfers only differences (delta algorithm), preserves attributes when asked, and supports dry-runs, excludes, and deletion of extraneous files.

## Why it matters

- Default tool for ad-hoc and scripted backups, migrations, and content distribution
- Misuse of `--delete` or wrong trailing-slash semantics can destroy data
- Understanding partial transfers, permissions, and ownership is essential for production use
- Network and disk performance characteristics matter for large trees

A dry-run (`-n`) should be habitual before any run that changes the destination.

## Mental Model

```
rsync [options] SRC... DEST

Trailing slash on SRC matters:
  rsync -a /data/  /backup/   → contents of data into backup
  rsync -a /data   /backup/   → creates /backup/data

Common mental checklist:
- What is source? What is destination?
- Do I want to delete files on DEST that are gone from SRC? (--delete)
- Permissions / ownership / times? (-a = archive)
- Dry-run first? (-n)
- Exclude patterns?
```

`-a` is equivalent to `-rlptgoD` (recursive, links, perms, times, group, owner, devices). Add `-H` for hard links, `-A` for ACLs, `-X` for xattrs when needed.

## Key Commands

```bash
# Dry-run archive copy (local)
rsync -a -n -v /source/ /destination/

# Real run with progress and partial resume
rsync -a --info=progress2 --partial /source/ /destination/

# Over SSH
rsync -a -e ssh /source/ user@host:/destination/
rsync -a -e 'ssh -p 2222' /source/ user@host:/dest/

# Delete extraneous files on destination (dangerous — dry-run first)
rsync -a --delete -n -v /source/ /destination/
rsync -a --delete /source/ /destination/

# Excludes
rsync -a --exclude '.git' --exclude '*.tmp' --exclude-from=excludes.txt /src/ /dst/

# Bandwidth limit and compression
rsync -a -z --bwlimit=10000 /src/ user@host:/dst/   # ~10 MB/s

# Sparse files and hard links (backups)
rsync -a -H -S /src/ /dst/

# Compare only (itemize changes)
rsync -a -n -i /src/ /dst/

# Single file or specific includes
rsync -a --include '*/' --include '*.conf' --exclude '*' /etc/ /backup/etc/
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks / fix                            |
|--------------------------------------|--------------------------------------------|-----------------------------------------------|
| Destination wiped or missing files   | `--delete` + wrong SRC/DEST or slash       | Always `-n` first; verify paths               |
| Permission denied on DEST            | User cannot write; root ownership needed   | Run as correct user; check `rsync` daemon ACLs|
| Ownership / group wrong after copy   | Not root / no `-o` `-g` or numeric IDs     | Use `-a` as root, or `--numeric-ids`          |
| Partial transfer left DEST inconsistent | Interrupted run                          | Re-run with `--partial`; consider `--delete` carefully |
| Extremely slow over WAN              | No compression / high latency / many small files | `-z`, `--bwlimit`, tar+ssh for huge file counts |
| Symlinks or hard links broken        | Missing `-l` / `-H`                        | Include in archive options                    |
| Trailing-slash surprise              | SRC without `/` created extra directory    | Re-read the slash rule; dry-run               |

## Investigation Tips

- Habit: `-n -v` (or `-n -i`) until the planned change set looks correct.
- For backups, prefer a dedicated user and restricted SSH key (`command=` in authorized_keys) rather than full root login.
- Large numbers of small files are often slower with rsync than a tar stream; consider `tar | ssh` for pure bulk copies.
- `--delete` only deletes under the destination path you give; it does not climb above it — but a wrong path still hurts.
- After a migration, verify with a second dry-run (`-n -i`) or checksum comparison (`--checksum` is expensive).
- Log the exact command line and exit status in automation; rsync exit codes distinguish partial vs total failure.

## Related Notes

- [[Backup Strategy]]
- [[tar and Compression]]
- [[find Deep Dive]]
- [[SSH Hardening and Troubleshooting]]
- [[Disaster Recovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
