# PostgreSQL Operational Basics

## Concept

PostgreSQL is a multi-process database. The postmaster accepts connections; backends run queries; checkpointer, walwriter, and autovacuum keep the on-disk state consistent. From an ops seat you own connectivity, replication lag, disk (data + WAL), connection count, and the ability to restore.

You do not need to be a DBA to know when the primary is accepting writes and whether the replica is usable.

## Why it matters

- App 500s with a green `systemctl status postgresql` are usually connection exhaustion, locks, or a full WAL volume.
- A restart can trigger crash recovery that takes minutes. "Just restart" destroys the processlist you needed.
- Untested backups are not backups. The restore is the only proof.
- Long transactions hold back VACUUM and can make the disk fill with dead tuples or WAL.

## Mental Model

```
clients / pool
    → postmaster (listen, auth via pg_hba.conf)
        → backend processes (one per connection)
            → shared buffers + WAL
                → data files on disk

Replica: recovery.conf / primary_conninfo + wal receiver
pg_is_in_recovery() true = standby
```

`max_connections` is a hard ceiling. The app pool size times the number of app instances must stay under it. Idle connections still count.

## Key Commands

```bash
systemctl status postgresql --no-pager
ss -tlnp | grep 5432
df -hT /var/lib/postgresql   # and the WAL mount if separate
journalctl -u postgresql -n 50 --no-pager

# As the postgres user or via peer/ident
sudo -u postgres psql -c 'SELECT version();'
sudo -u postgres psql -c 'SELECT pg_is_in_recovery();'
sudo -u postgres psql -c 'SELECT count(*) FROM pg_stat_activity;'
sudo -u postgres psql -c "SELECT pid, usename, state, wait_event_type, left(query,80) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start LIMIT 20;"
sudo -u postgres psql -c 'SELECT pg_database_size(current_database());'

# Replication
sudo -u postgres psql -c 'SELECT * FROM pg_stat_replication;'
sudo -u postgres psql -c 'SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) FROM pg_stat_replication;'

# Locks
sudo -u postgres psql -c 'SELECT * FROM pg_locks WHERE NOT granted;'
```

Config that matters operationally: `postgresql.conf` (listen_addresses, max_connections, shared_buffers, wal_level), `pg_hba.conf` (who can connect from where).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| "too many connections" | Pool leak or scale-out past max_connections | pg_stat_activity count vs max_connections |
| App timeouts, process up | Locks or long tx | pg_locks, long-running queries |
| Disk full | WAL not recycled (replica lag or archive failure) or temp files | df on data and WAL; pg_stat_replication |
| Replica lag growing | Long tx on primary or apply CPU | lag query, long queries on primary |
| Auth failure after change | pg_hba.conf or password | test with the exact host/user/db the app uses |
| Crash recovery on start | Unclean shutdown or full disk | journal, df before you restart again |
| VACUUM not keeping up | Long transactions or autovacuum throttled | age of oldest xmin, autovacuum logs |
| Works locally, fails from app | listen_addresses or pg_hba | ss, pg_hba, curl-equivalent psql from app host |

## Investigation Tips

- Count connections before you raise max_connections. The leak is usually in the app pool.
- A single forgotten `BEGIN` from a reporting session can block writers. Look at query_start and state, not only the slow query log.
- WAL volume full is often a replica that stopped consuming or an archive_command that failed. Fix the consumer before you delete WAL by hand.
- Test connectivity with the same user, database, and TLS settings the application uses. Local peer auth success proves little.
- Prefer `pg_stat_activity` and `pg_locks` over a restart. The restart erases the evidence and may take longer than the original problem.
- After any incident, confirm the last successful restore test date. See [[Database Backup and Restore]].
- `shared_buffers` is not a substitute for OS cache. Raising it blindly can increase pressure elsewhere.

## Related Notes

- [[Database Operational Basics]]
- [[Database Backup and Restore]]
- [[Connection Exhaustion]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[Time Sync and chrony]]
- [[sysctl and Resource Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The page was "too many connections" after a horizontal scale-out. Each new app pod opened a pool of 20. max_connections was 200. Process was up; no new backends could start.
- A reporting query that ran for 40 minutes held back VACUUM. The next day the disk filled with dead tuples. Long transactions belong in the same risk class as DDL.
- The replica looked healthy in a 5-minute graph and was 25 minutes behind when a report ran against it. Lag SLO has to match the consumers of that replica.
