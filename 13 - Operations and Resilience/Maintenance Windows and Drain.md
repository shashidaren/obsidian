# Maintenance Windows and Drain

## Concept

A maintenance window is a bounded period where you accept reduced capacity or brief unavailability in exchange for a change you cannot (or should not) do live. Draining is the act of moving work off a node before you touch it so the window does not become an incident.

## Why it matters

- An undrained node that you reboot takes every in-flight request with it.
- A window that overruns becomes an unplanned outage and destroys the next team’s change.
- Load balancers, orchestrators, and databases all have a “stop sending me new work” signal. Using it is the difference between a controlled blip and a cascading failure.
- Documented drain + verify steps make the window repeatable and reviewable.

## Mental Model

```
1. Announce / freeze other changes
2. Drain (stop new work, finish or migrate old work)
3. Verify drain (no new connections, replicas caught up, pods gone)
4. Change
5. Verify change
6. Undrain / return to service
7. Watch the metrics you alert on
8. Close the window
```

Skip step 2 or 3 and step 4 becomes the incident.

## Key Commands

```bash
# Load-balancer / keepalived style
# (exact command depends on the LB; concept is the same)
# mark the real-server down, wait for active connections to finish

# Kubernetes
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node>

# systemd service that should stop taking work
systemctl stop myapp.service   # after you have removed it from the LB

# Database (example: stop accepting, let replicas catch up)
# mysql: SET GLOBAL read_only=1; then wait for replica lag = 0
# postgres: pg_ctl promote or just stop the primary after failover

# Confirm nothing is listening / no established from clients
ss -tnp | grep ':443'
conntrack -L -d <this-node-ip> | head
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Reboot caused 5xx storm | node still in the LB pool | LB status, `ss` before reboot |
| Drain hangs forever | PDB, local volume, or stuck pod | `kubectl describe` the blocking pod |
| Window overruns, next change collides | no hard stop time, no rollback owner | clock, comms channel |
| “Drained” but clients still arrive | health-check still passing, or DNS TTL | LB health, DNS, conntrack |
| Replica lag grows during drain | you stopped the primary too early | lag metric before promote |
| Undrain too fast | application not ready, probes failing | readiness, error rate |
| Two teams drain the same cluster | no freeze / no shared calendar | change ticket links |

## Investigation Tips

- Write the drain verification into the change ticket before the window: “`ss` shows 0 client connections to :443 and LB marks the node down”.
- For stateful services, drain means “failover first, then stop”. Stopping the primary while it still owns the VIP is not a drain.
- Kubernetes `drain` respects PodDisruptionBudgets. If it blocks, either the PDB is correct (do not force) or it is wrong (fix the PDB, do not `--force` in prod without understanding the consequence).
- Watch the same dashboards you alert on for 15 minutes after undrain. A successful change that slowly leaks errors is still a failed window.
- Have a rollback that is faster than the original change. If rollback needs another drain, say so in the plan.
- Clock skew, full disks, and expired certs love maintenance windows. Check the basics (`date`, `df`, cert expiry) before you start the real work.

## Related Notes

- [[Change Management]]
- [[Incident Management]]
- [[High Availability]]
- [[Keepalived and VRRP]]
- [[On-Call Practices]]
- [[Troubleshooting Methodology]]
- [[Kubernetes Architecture]]

## Personal Lessons Learned

- We rebooted a node that was still in the HAProxy pool because the “drain” was a comment in the ticket, not a command. Five minutes of 502s. The next template had the exact `disable server` line and a verification step.
- A Kubernetes drain sat for 40 minutes on a PDB that required 2 replicas while we only had 2. Raising the replica count first, then draining, fitted the window. Forcing the drain would have dropped the service.
