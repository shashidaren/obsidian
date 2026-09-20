# Database Backup and Restore

## Concept

Database backups are either **logical** (SQL dump / export) or **physical** (data-file snapshot, base backup + WAL/binlog). They have different consistency rules, sizes, and restore times. A backup that has never been restored is a hope, not a control.

## Why it matters

- RPO and RTO for the database usually *are* the RPO and RTO for the application
- File-copying a live data directory produces an unrestorable mess unless the engine is frozen or the snapshot is crash-consistent
- "Dump job succeeded" does not mean the dump is complete, readable, or recent enough
- Point-in-time recovery (PITR) needs both a base copy **and** continuous WAL/binlog shipping
- Backups stored next to the database, with the same credentials, die in the same incident that needed them

## Mental Model

```
Logical  (pg_dump, mysqldump, mongoexport)
  + portable, good for small/medium DBs and migrations
  − slower restore, not incremental, easy to miss roles/grants/extensions

Physical (pg_basebackup + WAL, Percona XtraBackup, snapshots)
  + fast restore of large DBs, supports PITR
  − tied to version/architecture, needs careful consistency

PITR = base backup at T0 + WAL/binlog from T0 → T_target

Restore is a procedure, not a file:
  stop writers → restore files or load dump → replay WAL →
  verify rows/app login → only then point traffic back
```

Storage snapshots (LVM, ZFS, cloud volume) are valid physical backups only if the database is flushed/frozen or the snapshot is atomic across all data + WAL volumes. Two volumes snapshotted 3 seconds apart are not a backup.

Decide RPO/RTO in writing before you pick the tool. A nightly dump cannot meet a 15-minute RPO no matter how green the job is.

## Key Commands

```bash
# --- PostgreSQL (illustrative) ---
pg_dump -Fc -f /backup/appdb_$(date +%F).dump appdb
pg_dumpall -g -f /backup/globals_$(date +%F).sql     # roles + tablespaces
pg_restore -l /backup/appdb.dump | head              # list TOC; proves file is readable
# Physical + WAL
pg_basebackup -D /backup/base -Ft -z -P
# archive_command / restore_command must actually ship and retrieve WAL

# --- MySQL / MariaDB ---
mysqldump --single-transaction --routines --triggers --events -r /backup/appdb.sql appdb
# or: mariabackup / xtrabackup for physical
mysql --one-database appdb < /backup/appdb.sql       # restore to a scratch instance first

# --- Prove the artifact ---
ls -lh /backup/
file /backup/appdb.dump
pg_restore -l /backup/appdb.dump >/dev/null && echo dump_ok
gunzip -t /backup/appdb.sql.gz

# Job plumbing
systemctl list-timers | grep -i -E 'backup|dump|pgback'
journalctl -u db-backup -n 50 --no-pager
df -h /backup

# After restore, basic sanity (adapt)
psql -c 'SELECT now(), count(*) FROM app.critical_table;'
mysql -e 'CHECK TABLE app.critical_table; SELECT COUNT(*) FROM app.critical_table;'
```

Restore first onto a scratch instance or cloned volume. Do not practice on the only remaining copy.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Dump file exists but restore errors | Partial dump, wrong flags, version skew | `pg_restore -l` / dry-run load on scratch |
| Restore missing users / extensions | Dumped schema only, not globals | `pg_dumpall -g`, extension list |
| PITR stops short of target time | WAL/binlog gap, archive_command failing | archive directory continuity, replica lag history |
| Snapshot unrestorable | Snapshot while writes hit another volume | confirm data + WAL on same consistency group |
| Backup "green" but 0 bytes / days old | Timer failed, disk full, creds expired | timer, destination `df`, job journal |
| Restore exceeds RTO | Dump too large, single-thread load, no parallel restore | time a real restore; consider physical + PITR |
| Ransomware / admin deleted DB and backups | Backups on the same host and credentials | off-host, immutable, separate identity |
| App writes during logical dump | No `--single-transaction` / inconsistent snapshot | dump flags, engine support for MVCC dump |
| Replica used as backup source, then promoted | Slot / timeline mismatch, missing WAL | treat replicas as sources only with documented lag policy |

## Investigation Tips

- Start from [[Restore Testing]]. Schedule restores; record wall-clock time and who ran them.
- Inventory *everything* the app needs: data, roles, grants, extensions, scheduled jobs, replication slots, `pg_hba` / user plugin, TLS certs.
- Size the backup target for full + incrementals + at least one restore workspace. Full disks fail silently mid-dump.
- Prefer engine-native consistent methods over `tar` of `/var/lib/mysql` while mysqld is running.
- Version-match restore tools to the dump. A PG 16 dump may not load cleanly everywhere you expect.
- Encrypt dumps and protect keys separately. A world-readable dump on the backup NFS share is a breach waiting for a ticket.
- After restore, verify with application-level checks (login, a known row, a write-then-read), not only `systemctl is-active`.
- Alert on backup *age and size*, not only job exit code. A 0-byte file is a successful `>` redirect.
- Document who is allowed to run a restore and which identity owns the backup store. Shared root on the DB host is not a backup identity.

## Related Notes

- [[Backup Strategy]]
- [[Restore Testing]]
- [[Disaster Recovery]]
- [[Database Operational Basics]]
- [[Secrets Management]]
- [[Capacity Planning]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The nightly dump had exited 0 for six weeks. The destination NFS filled up on week two and every file after that was truncated. Exit code watched the process, not the artifact. We now alert on size + `pg_restore -l` in the same job.
- A volume snapshot of the data disk without the WAL volume restored cleanly and then replayed nothing. PITR target was "ten minutes ago"; we got last night. Consistency groups are not optional.
- First restore test took 4 hours against an RTO of 60 minutes. That was the day we stopped calling dumps a DR plan and scheduled physical base backups.
- Restoring onto the same instance "because scratch would take too long" overwrote the only good copy mid-procedure. Scratch first. Always.
