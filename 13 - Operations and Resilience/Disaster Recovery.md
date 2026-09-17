# Disaster Recovery

## Concept

Disaster Recovery (DR) is the plan and capability to restore service after a major loss of systems, site, region, or critical dependency — beyond ordinary incident response. It covers people, process, data, and infrastructure, not just "failover the VM".

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
  - Clear declaration criteria ("when do we call a disaster?")
  - Prioritised recovery order (what must come up first)
  - Data recovery path (backups, replicas, snapshots)
  - Infrastructure rebuild or standby activation
  - DNS / traffic shift
  - Communication (internal + external)
  - Regular exercise (tabletop + technical)
```

Cold / warm / hot standby trade cost against RTO. Choose deliberately; do not assume "we have backups" equals "we have DR".

A workable declaration line looks like: *"If region X cannot serve service Y for N minutes and the blast radius includes the data plane, the incident commander may declare DR."* Vague criteria guarantee delayed decisions.

Typical recovery order that people skip and then regret:

1. People and comms (who is in charge, where we talk if Slack is gone)
2. Identity and access to the *DR* account
3. DNS / traffic manager control plane
4. Data (restore or promote)
5. Stateless compute and config
6. Supporting tools (monitoring, CI) — after users work, not before

## Key Commands

```bash
# Inventory and health of critical services (example starting points)
systemctl list-units --failed
journalctl -p err -b --no-pager | head -50

# Data plane checks during recovery
df -hT
lsblk -f
findmnt -D

# DNS / traffic cutover verification — from *outside* the failed site
dig +short service.example.com @8.8.8.8
dig +short service.example.com NS
curl -vI --max-time 10 https://service.example.com/

# Backup / restore status (tool-specific)
# last successful backup timestamps, replica lag, snapshot age
restic snapshots
borg list /backup/repo
# PostgreSQL: SELECT now() - pg_last_xact_replay_timestamp();

# Cloud / IaC rebuild (conceptual)
# terraform plan / apply from known-good state in the DR account
# or vendor CLI to promote secondary region resources

# Communication readiness
# Confirm runbook links, contact lists, and status-page access from a non-primary network
```

Exact commands depend on your stack; the discipline is having them written and practised before the event. Keep a copy of the DR runbook *outside* the primary region.

## Common Failure Modes & Symptoms

| What goes wrong | Likely cause | Mitigation / first action |
|-----------------|--------------|---------------------------|
| Nobody knows who can declare DR | Missing decision authority | Pre-define roles and criteria |
| Backups exist but restore path unknown | Never practised | Scheduled restore tests; written procedure |
| Secondary site missing configs / secrets | Drift; secrets only on primary | IaC + secret replication with separate controls |
| DNS TTL too long; traffic stuck on primary | No pre-planned low TTL or traffic manager | Review TTL and cutover mechanism |
| Dependencies recovered in wrong order | No priority list | Explicit sequence (identity → data → app) |
| Communication fails when primary Slack/email is down | Single channel dependence | Out-of-band contacts and status page |
| DR runbook outdated | No ownership or review cycle | Treat runbooks as living docs; exercise them |
| Failback never planned | Team lives on the secondary | Controlled failback is part of DR, not a sequel |
| "Hot" standby is cold in practice | Unreplicated state, expired certs | Promote in a drill; fix what breaks |

## Investigation Tips

- Separate "incident" from "disaster" early. Treating a region loss like a single-host restart wastes critical time.
- Keep a printed or offline copy of the DR runbook and key contacts; the wiki may be in the affected region.
- Exercise at least annually: tabletop for decision-making, technical for actual restore and cutover.
- Measure actual restore time during drills and compare to stated RTO; update the plan or the target.
- Map every critical dependency (DNS, IdP, package mirrors, license servers, monitoring, artefact registry). DR fails on the forgotten ones.
- After activation, run a controlled failback plan; staying on the secondary indefinitely creates a new single point of failure.
- Test access to the DR cloud account and break-glass identities on a calendar. Expired MFA devices show up only during disasters if you never log in.
- Decide in writing what you will *not* recover in the first 24 hours. Everything-is-critical is how nothing is.

## Related Notes

- [[Backup Strategy]]
- [[Restore Testing]]
- [[High Availability]]
- [[Incident Management]]
- [[Root Cause Analysis]]
- [[Change Management]]
- [[Capacity Planning]]
- [[Secrets Management]]
- [[Certificates and PKI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The DR runbook lived in the wiki that ran in the region we lost. The printed packet in the office was two years old. Keep an offline copy and a copy in a second account.
- We could restore the database and still could not serve users because IdP, DNS, and the artefact registry were all primary-region only. Draw the dependency graph *before* the drill; recover identity and DNS first.
- Tabletop went smoothly because the same three people who wrote the plan played every role. The first technical drill with a different incident commander stalled on "who can declare." Write the declaration line and practise with substitutes.
- Failover worked; failback six weeks later collided with schema drift on the original primary. DR is not finished when the secondary is live. Schedule failback while the event is still a project, not folklore.
