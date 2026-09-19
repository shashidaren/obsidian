# rsync

## Concept

`rsync` copies directory trees and files, sending only the parts that differ. It runs locally, over SSH, or against an rsync daemon. It can also delete destination files that no longer exist on the source (`--delete`).

The two things that destroy data with rsync are the trailing slash and `--delete`. Everything else is performance and attributes.

## Why it matters

- Default tool for migrations, seed copies, and many homegrown backup jobs
- A reversed `SRC`/`DEST` plus `--delete` is a wipe
- Attribute flags decide whether the destination is a usable replica or just a pile of files with the wrong owner
- Huge small-file trees over high-latency links behave nothing like a single 100G image copy

Dry-run (`-n`) is not optional on anything that writes.

## Mental Model

```
rsync [options] SRC... DEST

Trailing slash on SRC:
  rsync -a /data/  /backup/    → contents of data land in backup/
  rsync -a /data   /backup/    → backup/data/ is created

Checklist before Enter:
  1. Which side is source?
  2. Trailing slash correct?
  3. --delete intended?
  4. -n -i looks right?
  5. Attributes (-a -H -A -X --numeric-ids) match the goal?
```

`-a` = `-rlptgoD` (recursive, symlinks, perms, times, group, owner, devices/specials). It does **not** include hard links (`-H`), ACLs (`-A`), xattrs (`-X`), or sparse handling beyond basics (`-S`).

Transfer path: checksum/size+mtime compare → delta send → set attributes on DEST. Interrupted runs leave a partial DEST; `--partial` keeps temp files so a rerun resumes.

Exit codes matter in cron: `0` ok, `23`/`24` partial (vanished files — common on live trees), `>=` 1 other failure. Do not treat every non-zero as “retry with `--delete`”.

## Key Commands

```bash
# Always start here
rsync -a -n -i /source/ /destination/

# Real copy with usable progress
rsync -a --info=progress2 --partial /source/ /destination/

# SSH
rsync -a -e ssh /source/ user@host:/destination/
rsync -a -e 'ssh -p 2222 -i /opt/keys/backup' /source/ user@host:/dest/

# Delete extras on DEST — dry-run first, every time
rsync -a --delete -n -i /source/ /destination/
rsync -a --delete /source/ /destination/

# Excludes
rsync -a --exclude '.git/' --exclude '*.tmp' --exclude-from=excludes.txt /src/ /dst/

# Include-only pattern (directory scaffolding + match)
rsync -a --include '*/' --include '*.conf' --exclude '*' /etc/ /backup/etc/

# WAN / courtesy
rsync -a -z --bwlimit=10000 /src/ user@host:/dst/     # ~10 MiB/s

# Backup-grade attributes
rsync -aHAXS --numeric-ids /src/ /dst/

# Itemize after the fact (second pass should be quiet)
rsync -a -n -i /src/ /dst/

# Live tree: tolerate files that vanish mid-run
rsync -a --delete --ignore-missing-args --timeout=60 /src/ /dst/
```

`--checksum` compares file contents, not mtime+size. Use it to verify a replica, not for every nightly run — it reads both sides fully.

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks / fix |
|---------|---------------|--------------------|
| DEST emptied or missing trees | `--delete` + wrong SRC/DEST or slash | Stop; restore from backup; never rerun blindly |
| Extra directory layer on DEST | SRC without trailing `/` | Dry-run; fix slash; move into place |
| Permission denied | Non-root cannot set owner; dest not writable | Run as the right user; check SSH forced-command |
| UIDs look like numbers / nobody | Name maps differ across hosts | `--numeric-ids`; create users first |
| Interrupted copy, DEST half-baked | Killed mid-run, no `--partial` | Re-run same command; avoid `--delete` until synced |
| Painfully slow over WAN | Millions of small files, no `-z`, high RTT | `-z`, `--bwlimit`, or `tar | ssh` for the first seed |
| Symlinks / hard links / sparse holes exploded | Missing `-l`/`-H`/`-S` | Add flags; compare `du --apparent-size` vs `du` |
| Cron “fails” every night on a live queue | Vanished files → exit 24 | Accept 24 or exclude the spool |
| Replica drifts after “successful” run | Excludes, or dest writes | `-n -i` should be empty; check dest-side jobs |

## Investigation Tips

- `-n -i` until the itemized list is a set you would sign off on. Then drop `-n` and keep the rest of the line identical.
- For backups, restrict the SSH key with `command="rsync --server ..."` in `authorized_keys`. Full root shells are not a backup protocol.
- First copy of a huge tree: `tar -C /src -cf - . | ssh host 'tar -C /dst -xf -'`, then rsync for the delta. rsync’s per-file setup dominates when files are tiny.
- `--delete` only affects the destination path you named. A typo in that path is still enough.
- After a migration, a quiet `rsync -a -n -i` is the verification. Follow with application-level checks (row counts, checksum manifests).
- Log the exact argv and the exit code. “rsync failed” without the line is not an incident note.
- Do not rsync a live database datadir and call it a backup. Use the engine’s backup tool, then rsync the *backup files*.

## Related Notes

- [[Backup Strategy]]
- [[tar and Compression]]
- [[find Deep Dive]]
- [[SSH Hardening and Troubleshooting]]
- [[Disaster Recovery]]
- [[Restore Testing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Trailing-slash mixup plus `--delete` turned `/srv/app` into an empty directory during a “quick sync to the new box”. The dry-run had been skipped because “it’s just rsync”. Restore took the rest of the night.
- A nightly job used name-based owners across two LDAPs that disagreed about `uid=1001`. Files were writable by the wrong user after every run. `--numeric-ids` and creating the account first fixed it.
- Exit code 24 on a mail spool ran for months as a “failed backup” page. The data was fine. We excluded the spool from the delete pass and stopped paging on 24.
