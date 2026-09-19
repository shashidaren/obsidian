# Connection Exhaustion

## Concept

Connection exhaustion is when something in the path cannot open or accept another connection because a finite slot is full: process FDs, listen backlog, worker count, pool size, or the database `max_connections`.

CPU is idle. Disk is idle. Clients time out. That combination is the tell.

## Why it matters

- One of the most common “the site is down but the box looks fine” outages
- Raising the cap without finding the leak buys a longer fuse, not a fix
- Pools multiply: `instances × pool_size × databases` can exceed the server before any host looks busy
- Occupancy is often CLOSE-WAIT, idle-in-transaction, or leaked clients — not active queries

A restart that “fixes” it is evidence of a leak until the graph stays flat across a traffic cycle.

## Mental Model

```
clients → proxy → app workers → pool → db / cache / upstream
              ↓         ↓         ↓         ↓
           somaxconn   LimitNOFILE  pool_size  max_connections
           listen Q    threads      wait      idle-in-xact
```

The first full bucket wins. Check them in that order during an incident; do the multiplication *before* you touch `max_connections`.

```
needed ≈ replicas × (pool_size + overflow) × distinct backends
```

Sidecars and batch jobs count as replicas.

## Key Commands

```bash
# Socket census
ss -s
ss -tan | awk 'NR>1 {c[$1]++} END {for (s in c) print c[s], s}'
ss -tan state established | wc -l
ss -tan state time-wait | wc -l
ss -tan state close-wait | wc -l
ss -tulpn | grep -E ':5432|:3306|:6379|:8080|:443'
ss -ltn                     # Recv-Q on LISTEN = accept queue depth

# Per-process FDs
PID=$(systemctl show -p MainPID --value <service>)
ls /proc/$PID/fd | wc -l
awk '/open files/ {print}' /proc/$PID/limits
lsof -n -p $PID | awk '{print $5}' | sort | uniq -c | sort -nr | head
ls -l /proc/$PID/fd | awk '{print $NF}' | sed 's/.*://' | sort | uniq -c | sort -nr | head

systemctl show <service> -p LimitNOFILE -p LimitNPROC

# Kernel queues
sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog net.ipv4.ip_local_port_range

# Postgres occupancy (run on the DB)
# SELECT usename, datname, state, wait_event_type, count(*)
# FROM pg_stat_activity GROUP BY 1,2,3,4 ORDER BY 5 DESC;
# SELECT count(*) FILTER (WHERE state = 'idle in transaction') AS idle_xact FROM pg_stat_activity;

# MySQL
# SHOW STATUS LIKE 'Threads_connected';
# SHOW VARIABLES LIKE 'max_connections';
# SHOW PROCESSLIST;
```

Application metrics that should already exist: pool active / idle / pending, acquire wait time, DB `numbackends`. If they do not exist, that is part of the incident.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Too many open files` | `LimitNOFILE` or leaked sockets/files | FD count vs `limits` |
| `FATAL: too many connections` / `ER_CON_COUNT_ERROR` | pool × instances > `max_connections` | Multiply; list clients on the DB |
| Timeouts, idle CPU, rising latency | Pool threads blocked on stuck sessions | CLOSE-WAIT, idle-in-xact, locks |
| LISTEN Recv-Q climbing | Workers not accept()-ing | Worker count, GC pause, upstream dead |
| TIME-WAIT storm | Short connections, no keepalive / no pool | Client retry loop |
| Ephemeral ports exhausted | Same, plus narrow `ip_local_port_range` | `ss -s`, `ss -tan state time-wait` |
| One replica dying | Leak on that instance | Compare FD and pool metrics across pods |
| Healthy after restart, fails in N hours | Leak | Graph connections; find who is not closing |
| pgBouncer in front *and* huge app pools | Double pooling, still stampedes the DB | One pool layer owns the cap |

## Investigation Tips

- Graph **active / idle / waiting / idle-in-transaction**, not “port is open”.
- Do the multiplication on a whiteboard before changing the database. Include cron workers and one-off admin laptops that use the same credentials.
- Idle-in-transaction holds a connection *and* often a lock. Capture `pg_stat_activity` (query, `xact_start`, `state_change`) before you `pg_terminate_backend`.
- CLOSE-WAIT means *this* process did not close after the peer did. That is an application bug, not a kernel tuning problem.
- Client retries without jitter turn a 2-second DB hitch into a connection flood. Rate-limit the retry, then size the pool.
- Raising `max_connections` costs RAM per slot on Postgres/MySQL. It is a safety margin, not a capacity plan.
- After mitigation: alert on pool acquire wait and on `numbackends` vs a budget derived from the multiplication, not on “process up”.

## Related Notes

- [[File Descriptors]]
- [[ss Deep Dive]]
- [[lsof Deep Dive]]
- [[Reverse Proxies]]
- [[Database Operational Basics]]
- [[High CPU Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Twelve app pods × Hikari `maximumPoolSize=30` × two datasources = 720 sessions. Postgres `max_connections=200`. The “random” outages were just rolling deploys overlapping the old pods. We cut the pool to 10 and put pgBouncer in transaction mode.
- A restart every dawn “because the API dies overnight” was CLOSE-WAIT piling up behind a HTTP client that never closed error responses. Limits were fine. The leak was not.
- Someone doubled `max_connections` during an incident and the DB OOM’d two hours later. The connection count was a symptom of idle-in-transaction from a missed `COMMIT` in a migration tool.
