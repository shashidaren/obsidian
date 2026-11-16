# Backup Job Health and False Greens

## Concept

A backup job that exits zero only proves the job ran. It does not prove the archive is complete, restorable, or covers the data you think it covers. False greens are jobs that report success while skipping files, writing empty dumps, using expired credentials, or targeting the wrong dataset.

## Why it matters

- The first time you discover the backup is empty or truncated is during the incident restore
- Credential expiry, permission changes, and exclude-rule drift produce green jobs that protect nothing
- Incremental chains that miss a full or a parent are unusable even if every job exited zero
- Disk-full on the backup target mid-write often still returns success to the scheduler

If you cannot point at a recent successful *restore test* for the dataset, the green status is an untested claim.

## Mental Model

```
Scheduler → backup command → exit code 0
                │
                ├── files actually read?
                ├── archive size / checksum sane?
                ├── target has space and is the right target?
                └── restore identity can read it later?

False green = exit 0 + one of the above failed silently
```

Common silent failures: `pg_dump` of a database the user can no longer see, `tar` that skipped unreadable files, restic/borg that could not lock the repo but still “succeeded” in a wrapper script, rsync that excluded the new mount.

## Key Commands

```bash
# Job status is not enough
systemctl status backup-*.service
journalctl -u backup-db --since "2 days ago" --no-pager | tail -40

# Artifact sanity (examples)
ls -lh /backup/db-$(date +%F).dump
# size should be in a known band; zero or tiny is a red flag
pg_restore -l /backup/db-*.dump | head
tar -tzf /backup/app.tar.gz | wc -l
restic snapshots
borg list /backup/repo | tail

# Compare to source
# (row count, file count, or checksum sample)
psql -c "SELECT count(*) FROM important_table;" 
# vs what the dump claims

# Target health
df -h /backup
# quota, object-store credentials, tape status — whatever the target is
```

A wrapper that only checks `$?` is how false greens survive. The wrapper should also check archive size against a minimum, or run a list/header command, and fail the unit if either is wrong.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Job green, archive 0 bytes or tiny | Dump failed after open, wrong DB, permission | file size history, dump stderr in journal |
| Job green, restore missing recent tables | User lost grants, exclude added | dump contents vs `\dt`, exclude rules |
| Incremental “success”, full missing | Parent job failed earlier or was purged | chain listing, snapshot parents |
| Green for weeks, restore auth fails | Backup role cannot read, or key rotated | test restore identity, not the backup writer |
| Target full, job still green | Wrapper ignored write errors | `df` on target, job log for ENOSPC |
| New mount not in backup | rsync/tar started before mount, or exclude | `findmnt` at job time, include list |

## Investigation Tips

- Alert on archive size (or file count) outside a band, not only on unit failure. A sudden drop to near-zero is the page.
- Once a week, have the job itself run a non-destructive list (`pg_restore -l`, `tar -t`, `restic check` or equivalent) and fail if it errors.
- Keep the last-known-good size and a one-line “what this backup contains” in the job log so the next person can see the drift.
- Test the restore *credentials* on a schedule. The writer identity succeeding does not prove the reader identity works.
- After any schema change, permission change, or new mount, explicitly confirm the next backup contains the new object.
- False greens are why restore testing exists. A green dashboard without a tested restore is not a backup strategy.

## Related Notes

- [[Restore Testing]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Local Mail for Cron and Alerts]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A `pg_dump` cron had been green for months. The connecting user lost `SELECT` on a new schema; the dump was valid but missing the tables that mattered. `pg_restore -l | wc -l` in the job would have failed the night the grant disappeared.
- An rsync wrapper ignored the exit status of `rsync` when the target filled. The unit stayed active (exited) because the script always exited 0. Checking `df` and the rsync exit code fixed the class of failure.
- We trusted the backup vendor’s “last success” timestamp. The success was a metadata heartbeat; the data job had been failing. The only reliable signal was a restore test and an artifact size check.
