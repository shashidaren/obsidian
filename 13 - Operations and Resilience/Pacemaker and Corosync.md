# Pacemaker and Corosync

## Concept

Pacemaker is the cluster resource manager. Corosync provides the messaging and membership layer (and quorum). Together they decide which node should run a resource, move it when a node disappears, and fence the node that must not write anymore.

A resource is anything you can start/stop/monitor: a VIP, a filesystem, a database, a systemd unit.

## Why it matters

- Without fencing (STONITH) a network partition produces two writers. That is worse than an outage.
- Quorum loss stops the minority side on purpose. Understanding why a node is “offline” prevents you from forcing it back into a split-brain.
- Resource stickiness, constraints, and location scores decide where things run after a recovery. Drift in those scores creates “it always fails back to the wrong node”.
- A cluster that has never been tested with a real power-off or network partition will fail in the way you least expect.

## Mental Model

```
corosync  — membership, quorum, totem ring
pacemaker — CIB (cluster information base), policy engine, resource agents
stonith   — fence the node that must not continue (IPMI, power, hypervisor)
resource  — primitive / group / clone / promotable
constraint — location, colocation, order

Quorum lost → minority side stops resources
Node unreachable + no quorum response → fence, then recover resources elsewhere
```

`pcs` (RHEL-like) or `crm` (Debian-like) are the usual front-ends. The underlying CIB is the same.

## Key Commands

```bash
# Status (pcs style)
pcs status
pcs status --full
pcs cluster status

# Corosync / quorum
corosync-cfgtool -s
corosync-quorumtool -s
corosync-cmapctl | grep members

# Resource detail
pcs resource status
pcs resource config <resource>

# Fence
pcs stonith status
pcs stonith history
stonith_admin -l

# Move / clear (incident only)
pcs resource move <resource> <node>   # sets a temporary constraint
pcs resource clear <resource>         # remove the move constraint

# Config sanity
pcs config
crm_verify -L -V
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Node shows offline, resources stopped | Lost quorum or corosync partition | `corosync-quorumtool`, network between nodes |
| Two nodes both running the same resource | STONITH disabled or fence failed | `pcs stonith status`, fence history |
| Resource fails to start on the remaining node | Missing package, config drift, dependency | Resource agent logs, `pcs resource debug-start` |
| Cluster flaps every few minutes | Too-aggressive monitor interval or network loss | Monitor op timeout, corosync token timeout |
| “Could not connect to the CIB” | pacemakerd down or IPC broken on that node | `systemctl status pacemaker`, local journal |
| Fence succeeds but resource never moves | Constraint or stickiness keeps it | `pcs constraint`, resource meta stickiness |
| Works after `pcs cluster start` but not on boot | systemd ordering or corosync not enabled | `systemctl is-enabled corosync pacemaker` |

## Investigation Tips

- `pcs status` first. Note who has quorum, who is DC, and which resources are started where.
- Never disable STONITH to “make it start”. Fix the fence device or accept that the cluster will not recover automatically.
- Resource agent failures are usually in the journal of the node that tried to start it (`journalctl -u pacemaker`).
- After a fence, confirm the fenced node is actually powered off or isolated before you clear constraints. A node that reboots into the cluster while the other side still owns the disk is how you get corruption.
- Test three failure modes on a schedule: `systemctl stop` of a resource, network partition (iptables drop between nodes), and real power-off (IPMI/OOB). Record the observed time to recovery.
- Keep the CIB under version control or in your configuration management. Manual `pcs resource create` on one node drifts.

## Related Notes

- [[High Availability]]
- [[Keepalived and VRRP]]
- [[Out of Band and IPMI]]
- [[Disaster Recovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We once “fixed” a lab cluster by setting `stonith-enabled=false`. The same change appeared in production six months later. Split-brain on a shared filesystem cost a restore. Fence devices stay enabled.
- A VIP resource kept returning to the original node after every recovery because stickiness was 0 and a location constraint preferred it. Explicit stickiness plus a tested fail-back procedure made the behaviour predictable.
- Corosync token timeout was shorter than the network blip our switches produced during firmware upgrades. Raising the token timeout (and testing it) stopped the false partitions.
