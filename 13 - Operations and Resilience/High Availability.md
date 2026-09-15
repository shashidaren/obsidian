# High Availability

## Concept

High availability is the practice of surviving the failure of a *component* — process, disk, NIC, host, or path — without a user-visible outage, using redundancy, honest health checks, and failover that has been tested.

HA is not “we bought two servers.” Two servers with untested failover, drifted config, and a VIP that nobody can explain is a more expensive single point of failure.

HA covers component loss. Site or region loss is [[Disaster Recovery]]. Bad deploys and data corruption are [[Change Management]] and [[Backup Strategy]]. Do not ask HA to do those jobs.

## Why it matters

- Hardware and processes die. That should be boring.
- Redundancy without detection still produces downtime. Redundancy without fencing produces split-brain, which is worse than downtime.
- Clients cache. DNS TTLs, LB membership, and connection pools decide whether failover is 2 seconds or 20 minutes.
- False-positive health checks flap a healthy service into an outage you caused.
- Standby that was never promoted in anger will not promote cleanly during an incident. Testing is part of the design.

## Mental Model

```
Redundancy     — more than one of the thing that breaks
Health check   — a probe that matches user-visible health
Failover       — traffic or role moves to a healthy member
State          — shared, replicated, or partitioned on purpose
Quorum/fencing — when the network splits, at most one side writes

Patterns:
  Active/passive + VIP (keepalived, Pacemaker)
  Active/active behind a load balancer
  DB primary + replicas with a promotion story
  Multi-AZ stateless pool + managed data service
```

The hard parts are always: **state**, **split-brain**, and **lying health checks**.

Ask, for every pair you own:

1. What dies?
2. Who notices, and in how many seconds?
3. Who stops the dead side from writing?
4. Where do clients go next, and what do they cache?
5. What is the observed RTO from the last real test?

## Key Commands

Tooling varies. The questions do not. Keep the exact check and the exact failover command next to the service.

```bash
# Local unit health is necessary, not sufficient
systemctl status <service>
systemctl --failed

# VIP / address ownership
ip -br addr
ip -d addr show dev eth0

# keepalived / Pacemaker / corosync sketches
keepalived -t -f /etc/keepalived/keepalived.conf
journalctl -u keepalived -n 80 --no-pager
pcs status
corosync-quorumtool -s
stonith_admin -l

# Did the client-facing path move?
curl -sI --max-time 3 http://127.0.0.1/healthz
curl -sI --max-time 3 http://<vip>/healthz
ss -lntp | grep -E ':80|:443'

# Replication lag is part of HA, not a DB curiosity
# PostgreSQL:  SELECT client_addr, state, replay_lag FROM pg_stat_replication;
# MySQL:       SHOW REPLICA STATUS\G

# After a failover, prove both sides agree who is primary
hostname; ip -br addr; systemctl is-active <service>
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Two primaries | Lost quorum / fencing disabled / network partition | Quorum tool, STONITH history, data divergence |
| Failover never fires | Check too weak, VIP stuck, split DNS | Health URL from *outside*, `ip addr` on both |
| Failover flaps | Tight check + packet loss or GC pause | Raise interval/threshold; fix the real slowness |
| Service “up”, clients fail | LB/DNS/conn pool still on the corpse | Pool members, TTL, client keepalive |
| Standby cannot take over | Config drift, missing package, unreplicated state | Diff config, last successful promotion test |
| Works for `kill`, not for power-off | No fencing / shared disk not released | Schedule a hard-off test |
| Split-brain writes | Two writers, one dataset | Fence first, restore from backup if divergent |
| HA “fine”, deploy takes both sides down | Shared change, no bake time | [[Change Management]] — HA does not save you |

## Investigation Tips

- Draw the remaining single points: VIP host, shared LUN, license server, external DNS, one NAT gateway.
- Health checks must exercise the user path (query the DB, touch the disk). `pidof myservice` is how you fail over too late or not at all.
- Prefer automatic failover when the failure mode is crisp (process dead, peer gone). Prefer human confirmation when promotion can lose data.
- Never disable STONITH “so the cluster starts.” That is how you get two writers.
- Keep standby config in the same automation as primary. Drift is the usual reason standby fails.
- Test three things on a calendar: process kill, network partition, host power-off. Write down the observed RTO.
- After failover, do not forget to *fail back* on purpose later, or the next incident starts from the wrong node with the wrong disk.

## Related Notes

- [[Disaster Recovery]]
- [[Backup Strategy]]
- [[Capacity Planning]]
- [[Incident Management]]
- [[Change Management]]
- [[Services DNS and Ingress]]
- [[Restore Testing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- keepalived was “working” for a year because nobody pulled the primary NIC. The first real host crash left the VIP on a dead machine; VRRP was bound to an interface that never went away in software. Test power-off, not only `systemctl stop`.
- We disabled fencing once to recover a lab cluster and the habit leaked to prod. Split-brain cost more than the outage we were trying to shorten. Fence, then restore.
- A health check that only hit `/` on the local proxy declared the node healthy while the database behind it was gone. Clients failed; the pool did not shrink. Probe what the user needs, not what is convenient to curl.
