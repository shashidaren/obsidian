# Database Operational Basics

## Concept

From an operations seat, a database is a **stateful service** with a small set of concerns you must own regardless of engine (PostgreSQL, MySQL, MongoDB, …):

- Connectivity and authentication
- Process / replication health
- Storage growth, disk, and memory
- Locks, slow queries, and connection limits
- Backup, restore, and point-in-time recovery

You are not a DBA on day one, but you must know how the database fails, how to prove it is healthy, and how to avoid making things worse.

## Why it matters

- Application outages often *surface* as 500s while the *cause* is DB connections, locks, or disk
- Restarts and "just delete the pod" can trigger crash recovery, replica storms, or data loss if storage is misunderstood
- Backup that was never restored is not a backup — ops owns that uncomfortable truth
- Touching data files directly, force-killing at the wrong moment, or running DDL without a plan turns a slowdown into an incident

## Mental Model

```
Clients / pools
      │
      ▼
  DB process(es)  ── memory (shared buffers / cache)
      │
      ├── WAL / redo / journal   (durability, replication)
      ├── data files             (tables, indexes)
      └── temp / sort            (disk pressure under load)

Ops questions:
  Can clients connect?
  Is the primary accepting writes?
  Are replicas current enough for the RPO?
  Is disk/inode/memory headroom positive?
  When was the last *successful restore test*?
```

Treat the database as a dependency with its own SLIs: availability, lag, connection usage, disk, query latency — not just "process is up".

## Key Commands & Checks

```bash
# Host / process (engine-agnostic starting points)
systemctl status <db-service>
ss -tulpn | grep -E '5432|3306|27017'
df -hT <data-mount>
df -i  <data-mount>
free -h
journalctl -u <db-service> --since "30 min ago" -p warning

# Connectivity from the app tier (prefer the app's user and DB name)
psql  "host=… user=… dbname=…" -c 'SELECT 1'
mysql -h … -u … -e 'SELECT 1'
mongosh --eval 'db.runCommand({ ping: 1 })'

# PostgreSQL sketch
psql -c 'SELECT version();'
psql -c 'SELECT pg_is_in_recovery();'          # replica?
psql -c 'SELECT count(*) FROM pg_stat_activity;'
psql -c 'SELECT * FROM pg_stat_activity WHERE state <> \'idle\' LIMIT 20;'
psql -c 'SELECT pg_database_size(current_database());'

# MySQL sketch
mysql -e 'SHOW STATUS LIKE "Threads_connected";'
mysql -e 'SHOW STATUS LIKE "Innodb_buffer_pool%";'
mysql -e 'SHOW PROCESSLIST;'
mysql -e 'SHOW REPLICA STATUS\\G'              # or SHOW SLAVE STATUS

# Kubernetes
kubectl get pods -n <ns> -l app=<db>
kubectl logs <pod> -n <ns> --tail=100
kubectl exec -it <pod> -n <ns> -- df -h
```

Know where your engine keeps:

- Data directory and WAL/binlog location (often separate disks)
- Auth config (`pg_hba.conf`, MySQL users/host, SCRAM vs md5)
- Slow query log / `pg_stat_statements` / Performance Schema

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| App timeouts, DB process up | Connection pool exhausted, max_connections | `ss`/processlist; pool config vs DB limit |
| "Too many connections" | Leak, thundering herd after restart | Who holds connections; app pool sizes |
| Sudden disk full | WAL growth, temp files, runaway logging | `df` on data *and* WAL volume; open transactions |
| High latency, CPU high | Missing index, bad plan, vacuum/analyze debt | Slow query log; active queries |
| High latency, CPU low | Locks, I/O wait, remote storage | Locks; `iostat`; cloud volume metrics |
| Replica lag | Apply rate, long transactions on primary | Lag metrics; long tx on primary |
| Auth failures after change | pg_hba / password / TLS requirement | DB auth log; test one connection with same params as app |
| Data "missing" after Pod reschedule | emptyDir or wrong PVC | Volume mounts; see [[Persistent Storage]] |
| Crash loops on start | Corrupt recovery, wrong permissions, full disk | DB logs before restart; disk; file ownership |

## Investigation Tips

- Establish **scope**: one client, one pool, whole primary, all replicas? That splits app vs DB vs network quickly.
- Prefer evidence over restart. A restart may clear locks and destroy the processlist you needed for the RCA.
- Connection problems: test with the **same host, user, TLS, and database name** the app uses. Admin localhost success proves little.
- Disk: check the filesystem that holds data *and* the one that holds WAL/binlogs. They are often different mounts.
- Locks: look for long-running transactions holding locks, not only for "slow queries". A forgotten `BEGIN` from a admin session can stall writers.
- After any incident, ask: was this visible in metrics before pages fired? Connection usage, lag, and disk need anticipatory alerts — see [[Alert Design]].
- Never run undocumented repair tools or delete WAL because disk is full without engine-specific procedure and a snapshot if possible.

## Related Notes

- [[Database Backup and Restore]]
- [[Connection Exhaustion]]
- [[Persistent Storage]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We paged on app 500s while `systemctl status postgresql` was green. `max_connections` and the app pool had grown past each other after a horizontal scale-out. Process up ≠ accepting useful work.
- A "temporary" `DELETE` without index held locks far longer than the change window. Long transactions belong in the same risk class as DDL.
- Replica lag looked fine in a 5-minute metric but a report ran against the replica and saw half-hour-old data. Match lag SLOs to the consumers of that replica.
- The only backup that mattered in a real restore was the one we had actually restored to a scratch instance the month before. Untested backups are optimism.
