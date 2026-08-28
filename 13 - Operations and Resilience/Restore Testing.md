# Restore Testing

## Concept

A backup job that exits 0 proves bytes were written somewhere. Restore testing proves those bytes can become a working system inside the RTO, with the RPO you claimed. Untested backups are a hypothesis.

## Why it matters

- The first restore that happens during an incident is the most expensive restore you will ever run
- Backup software lies politely: skipped files, empty dumps, wrong dataset, expired credentials still “succeed”
- RTO is a measured number (clock time + people + dependencies), not a slide
- Encryption keys, IAM roles, DNS, and license files fail restores more often than the data files do
- Auditors and ransomware events both ask the same question: show me the last successful restore

## Mental Model

```
Backup success  ≠  restore success

A useful test specifies:
  What     → which dataset / which point-in-time
  Where    → isolated target (not production overwrite)
  Who      → the people who would actually do it at 03:00
  How long → wall-clock from “declare restore” to “app answers”
  How good → checksum / row counts / app smoke test, not just “files exist”

Types of test, cheapest first:
  1. Readability     — list / restore-header / tar -t / pg_restore -l
  2. File-level      — extract to scratch and compare sizes/checksums
  3. Application     — bring up DB or VM and run a real query / login
  4. Full DR         — new site, new identity, documented runbook only
```

Rotate *what* you test. Always restoring the same small share trains you to miss the 2 TB database that actually matters.

## Key Commands

```bash
# Prove the artifact is readable before you book a maintenance window
tar -tzf /backup/app_$(date +%F).tar.gz | head
pg_restore -l /backup/db.dump | head
gpg --list-packets /backup/db.dump.gpg | head
restic snapshots
borg list /backup/repo

# Isolated file restore (example)
mkdir -p /mnt/restore-scratch && mount /dev/backupvg/scratch /mnt/restore-scratch
rsync -aHAX /backup/data/ /mnt/restore-scratch/data/
diff -rq --no-dereference /data /mnt/restore-scratch/data | head

# Database restore to a side instance, not production
pg_restore -C -d postgres /backup/db.dump     # creates DB; point at a scratch cluster
mysql --host=scratch < /backup/db.sql

# Time the real thing
date -Is | tee /tmp/restore-start
# ... restore steps from the runbook only ...
date -Is | tee /tmp/restore-end

# After restore: identity and time, then app smoke
hostnamectl; timedatectl; df -hT; systemctl --failed
curl -fsS http://127.0.0.1/health || true

# Job plumbing that makes tests possible
systemctl list-timers | grep -iE 'backup|restore'
journalctl -u backup-job -u restore-test --since "7 days ago" --no-pager
```

Write the exact commands you used into the runbook. If the test required a tribal flag or an undocumented vault path, the test already failed.

## Common Failure Modes & Symptoms

| What you discover | Likely cause | First checks |
|-------------------|--------------|--------------|
| Archive will not list | Truncated job, full target mid-write, wrong file | Size vs expected, job logs, checksum |
| Restore missing files | Exclude rules, unfinished incremental chain | Compare file counts; restore parent full + incrementals |
| DB restore errors on roles / extensions | Dump lacked globals, target Postgres major differs | `pg_dumpall --globals`; version matrix |
| Restored app cannot decrypt | Key only lived on the dead host | Key escrow; separate secret store |
| Restore works, app does not | DNS, TLS cert, license, `/etc` not in scope | Dependency checklist in the runbook |
| Took 14 hours vs 2-hour RTO | Network, single-stream restore, cold cache | Measure throughput; test parallel restore |
| Works for operator A only | Privileges and tribal knowledge | Have a second person execute the runbook cold |
| Scratch restore poisoned production | Wrong target, reused connection string | Isolated network / separate credentials |

## Investigation Tips

- Schedule restores like patching: calendar, owner, success criteria, recorded duration.
- Test the *runbook*, not the expert. If only one person can restore, you have an availability problem.
- Include secrets, machine identity, TLS material, and DNS in scope. Data files alone rarely boot a service.
- Keep restore targets isolated. A “quick restore over prod to save time” is how you get two incidents.
- Record four numbers every test: dataset size, restore duration, verification result, surprises.
- After every real incident restore, update the test plan — production just taught you the gaps.
- Immutable / object-locked backups need a tested *read* path (different role) or you will discover the lock during the outage.

## Related Notes

- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Database Backup and Restore]]
- [[High Availability]]
- [[Incident Management]]
- [[Change Management]]
- [[Secrets Management]]
- [[Documentation and Runbooks]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> The restore that “worked in staging” used staging credentials baked into the runbook. Production restore stalled on an IAM role nobody had exercised. Test with the identities you will actually have when the primary account is gone.
