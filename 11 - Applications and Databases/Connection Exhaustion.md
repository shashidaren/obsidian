# Connection Exhaustion

## Concept

Connection exhaustion is when an application, proxy, or database cannot accept or open more connections because a limit was hit — process file descriptors, listen backlog, pool size, or the database's `max_connections`. The service looks "down" or "slow" even when CPU and disk are fine.

## Why it matters

- Classic production outage: traffic is normal, boxes look idle, clients get timeouts
- Raising the limit without finding the leak just delays the next outage
- Connection pools multiply: app instances × pool size × services can exceed the database before any single host looks busy
- CLOSE-WAIT / idle-in-transaction connections are often the real occupancy, not active queries

Treat "too many connections" as a resource leak or fan-out bug until proven otherwise.

## Mental Model

```
Client  →  proxy  →  app process  →  pool  →  database / upstream
              |            |           |
           FD limit     workers     max_connections
           backlog      threads     wait_timeout
```

Limits stack. The first one that fills wins:

- Process `ulimit -n` / systemd `LimitNOFILE`
- Kernel `somaxconn` / listen backlog
- App server worker/thread count
- App pool size (Hikari, SQLAlchemy, pgBouncer pool_size)
- Database `max_connections`
- Proxy upstream keepalive / max conn

A restart clears leaked sockets and looks like a fix. It is not.

## Key Commands

```bash
# What is listening, and how many sockets are open?
ss -s
ss -tan state established | wc -l
ss -tan state time-wait | wc -l
ss -tan state close-wait | wc -l
ss -tulpn | grep -E ':5432|:3306|:6379|:80|:443'

# Per-process FD usage
ls /proc/<PID>/fd | wc -l
cat /proc/<PID>/limits | grep 'open files'
lsof -p <PID> | awk '{print $5}' | sort | uniq -c | sort -nr | head

# Who holds DB connections (Postgres example)
# psql: SELECT usename, datname, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC;
# MySQL: SHOW PROCESSLIST;  SHOW VARIABLES LIKE 'max_connections';

# Systemd service limits vs current usage
systemctl show <service> -p LimitNOFILE
cat /proc/$(systemctl show -p MainPID --value <service>)/limits | grep 'open files'

# Kernel listen / port pressure
sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog
ss -ltn   # look at Recv-Q on LISTEN sockets
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Too many open files` in app logs | Process FD limit or FD leak | `/proc/PID/fd` count vs `limits` |
| DB error `too many connections` | Pool × instances > `max_connections` | Count app instances and pool size |
| Timeouts, idle CPU | Pool exhausted waiting on stuck sessions | `CLOSE-WAIT`, idle-in-transaction |
| Listen Recv-Q growing | Accept queue full, workers saturated | `ss -ltn`, worker count, upstream health |
| Burst of `TIME-WAIT` | Short connections, no keepalive | Client reconnect storm, missing pool |
| Only one backend dying | That instance leaked; others still healthy | Compare FD counts across instances |
| Fine after restart, fails in N hours | Leak (unclosed clients, forgotten pool) | Graph connections vs time |

## Investigation Tips

- Graph **active / idle / waiting** connections, not just "is the port up".
- Multiply: `replicas * pool_size * (1 + sidecar)` before you blame the database.
- Idle-in-transaction (Postgres) holds a connection and often a lock. Kill the query/session only after capturing `pg_stat_activity`.
- Proxies (pgBouncer, ProxySQL, Envoy) exist specifically to multiplex. Confirm you are not pooling *and* opening raw connections around them.
- Client retries without backoff turn one slow DB into connection stampedes.
- Raising `max_connections` increases memory on the database. Fix ownership first; raise second.
- After mitigation, leave a dashboard and an alert on pool wait time / connection count — not just process up.

## Related Notes

- [[File Descriptors]]
- [[ss Deep Dive]]
- [[lsof Deep Dive]]
- [[Reverse Proxies]]
- [[Database Operational Basics]]
- [[High CPU Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
