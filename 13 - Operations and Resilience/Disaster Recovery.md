# Disaster Recovery

## Concept

Disaster Recovery (DR) is the plan and capability to restore service after a major loss of systems, site, region, or critical dependency — beyond ordinary incident response. It covers people, process, data, and infrastructure, not just “failover the VM”.

## Why it matters

- Incidents are local; disasters remove whole failure domains (datacenter, cloud region, identity provider, primary storage)
- Without a rehearsed plan, recovery time expands dramatically under stress and incomplete information
- RTO/RPO targets are meaningless if dependencies, runbooks, and communication paths are untested
- Regulatory and contractual obligations often require documented and exercised DR

HA keeps you up for component failures. DR gets you back when the primary environment is gone.

## Mental Model

```
Scope ladder:
  Component failure     → HA / local restart
  Host / AZ failure     → multi-AZ or standby
  Region / site loss    → DR (this note)
  Provider / identity loss → often out of scope unless multi-cloud / offline plans exist

DR ingredients:
  - Clear declaration criteria (“when do we call a disaster?”)
  - Prioritised recovery order (what must come up first)
  - Data recovery path (backups, replicas, snapshots)
  - Infrastructure rebuild or standby activation
  - DNS / traffic shift
  - Communication (internal + external)
  - Regular exercise (tabletop + technical)
```

Cold / warm / hot standby trade cost against RTO. Choose deliberately; do not assume “we have backups” equals “we have DR”.

## Key Commands

```bash
# Inventory and health of critical services (example starting points)
systemctl list-units --failed
journalctl -p err -b --no-pager | head -50

# Data plane checks during recovery
df -h
lsblk
mount | column -t

# DNS / traffic cutover verification
dig +short service.example.com
curl -vI https://service.example.com

# Backup / restore status (tool-specific)
# e.g. check last successful backup timestamps, replica lag, snapshot age

# Cloud / IaC rebuild (conceptual)
# terraform plan / apply from known-good state
# or cloud console / CLI to promote secondary region resources

# Communication readiness
# Confirm runbook links, contact lists, and status-page access from a non-primary network
```

Exact commands depend on your stack; the discipline is having them written and practised before the event.

## Common Failure Modes & Symptoms

| What goes wrong                              | Likely cause                                         | Mitigation / first action                          |
|----------------------------------------------|------------------------------------------------------|----------------------------------------------------|
| Nobody knows who can declare DR              | Missing decision authority                           | Pre-define roles and criteria                      |
| Backups exist but restore path unknown       | Never practised                                      | Scheduled restore tests; written procedure         |
| Secondary site missing configs / secrets     | Drift; secrets only on primary                       | IaC + secret replication with separate controls    |
| DNS TTL too long; traffic stuck on primary   | No pre-planned low TTL or traffic manager            | Review TTL and cutover mechanism                   |
| Dependencies recovered in wrong order        | No priority list                                     | Explicit recovery sequence (identity → data → app) |
| Communication fails when primary email/Slack is down | Single channel dependence                    | Out-of-band contacts and status page               |
| DR runbook outdated                          | No ownership or review cycle                         | Treat runbooks as living docs; exercise them       |

## Investigation Tips

- Separate “incident” from “disaster” early. Treating a region loss like a single-host restart wastes critical time.
- Keep a printed or offline copy of the DR runbook and key contacts; the wiki may be in the affected region.
- Exercise at least annually: tabletop for decision-making, technical for actual restore and cutover.
- Measure actual restore time during drills and compare to stated RTO; update the plan or the target.
- Map every critical dependency (DNS, IdP, package mirrors, license servers, monitoring). DR fails on the forgotten ones.
- After activation, run a controlled failback plan; staying on the secondary indefinitely creates a new single point of failure.

## Related Notes

- [[Backup Strategy]]
- [[Restore Testing]]
- [[High Availability]]
- [[Incident Management]]
- [[Root Cause Analysis]]
- [[Change Management]]
- [[Capacity Planning]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
