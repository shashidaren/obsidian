# High Availability

## Concept

High Availability (HA) is the design and operational practice of keeping a service running through the failure of individual components (hosts, processes, disks, network paths) by using redundancy, health checks, and automated or rapid failover.

## Why it matters

- Single points of failure turn routine hardware or process crashes into full outages
- Redundancy without correct failure detection still produces downtime (or split-brain)
- Clients and operators need predictable behaviour when a node disappears
- HA is cheaper than full DR for common failures, but it does not replace DR for site/region loss

“We have two servers” is not HA until failover is reliable, tested, and understood.

## Mental Model

```
HA building blocks:
  Redundancy     → multiple instances of the critical component
  Health checks  → decide when a member is unfit
  Failover       → move traffic or role to a healthy member
  State          → shared, replicated, or carefully partitioned data
  Quorum         → avoid split-brain when the cluster partitions

Common patterns:
  Active/passive   → one primary, standby takes over
  Active/active    → multiple primaries sharing load
  Load balancer + N backends
  Database primary + replicas (with promotion)
  Floating IP / VIP + keepalived / Pacemaker
```

The hard parts are state, split-brain, and false positives from flappy health checks.

## Key Commands

```bash
# Process and unit health
systemctl status <service>
systemctl list-units --failed

# Cluster / membership examples (tool-specific)
pcs status                    # Pacemaker
corosync-quorumtool -s
keepalived -t -f /etc/keepalived/keepalived.conf
ip -br addr                   # check VIP presence

# Load balancer / backend health (examples)
curl -sI http://backend:port/healthz
ss -lntp | grep :443

# Database replication / lag (examples)
# PostgreSQL: SELECT * FROM pg_stat_replication;
# MySQL: SHOW REPLICA STATUS\G

# Kernel / network path basics during failover
ip route
ping -c 3 <peer>
journalctl -u keepalived -u corosync -u pacemaker -n 50 --no-pager
```

Know the exact health-check endpoint and failover trigger for every HA pair you own.

## Common Failure Modes & Symptoms

| Symptom                                      | Likely cause                                      | First checks                                      |
|----------------------------------------------|---------------------------------------------------|---------------------------------------------------|
| Both nodes think they are primary            | Split-brain; lost quorum or fencing               | Quorum status, fencing logs, data divergence      |
| Failover never happens                       | Health check too weak or VIP stuck                | Health endpoint, keepalived/Pacemaker logs        |
| Failover flaps                               | Flappy check, network blips, resource pressure    | Check thresholds, history of events               |
| Service up but clients still fail            | DNS / LB still pointing at dead node              | VIP, LB pool, client caches                       |
| Standby cannot take over                     | Config drift, missing packages, unreplicated state| Compare configs, test promotion on schedule       |
| HA works for process crash, not host crash   | No fencing or shared storage not handled          | Simulate host power-off in a maintenance window   |

## Investigation Tips

- Always ask: what is the single point of failure left? (VIP host, shared disk, license server, external DNS.)
- Prefer automatic failover for well-understood failure modes; require human confirmation for ambiguous ones if the cost of wrong promotion is high.
- Test failover regularly (process kill, network partition, host reboot). Document the observed RTO.
- Fencing (STONITH) exists to prevent split-brain; never disable it “to make the cluster start”.
- Health checks should reflect user-visible health, not only “process is running”.
- Keep standby configuration in sync with primary via automation; manual drift is the usual reason standby fails when needed.
- HA does not protect against bad deploys or data corruption — that is change management, backups, and DR.

## Related Notes

- [[Disaster Recovery]]
- [[Backup Strategy]]
- [[Capacity Planning]]
- [[Incident Management]]
- [[Change Management]]
- [[Load balancing concepts in Services DNS and Ingress]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
