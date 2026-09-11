# Change Management

## Concept

Change management is how you make production different on purpose and still be able to sleep. It is purpose, risk, validation, and an explicit rollback — sized to the blast radius, not to a corporate template.

It is not a CAB slide deck. A one-line PR description plus a canary and a revert button *is* change management when the risk is small. A written plan, a window, a second pair of eyes, and a rehearsed rollback *is* change management when the risk is not.

## Why it matters

- Most production incidents have a change in the timeline. If you cannot answer "what changed?" you cannot close the incident cleanly
- Small, reversible, validated changes fail cheaper than large irreversible ones
- Without a shared language for risk, teams either freeze for weeks or ship schema drops on Friday afternoon
- Rollback designed *before* the change is a recovery procedure. Rollback invented at 02:00 is another incident

The goal is predictable, recoverable change. Paperwork is a tool for that goal, not the goal.

## Mental Model

```
Propose → Assess risk → Review → Implement → Validate → Rollback? → Record

Risk ≈ blast radius × uncertainty × irreversibility × time-to-detect
```

Classify, then apply process *proportional to the class*:

| Class | Meaning | Example | Process |
|-------|---------|---------|---------|
| Standard | Pre-approved, well-rehearsed | Patch with canary, flag flip | Automated + recorded |
| Normal | Needs a look | New listener, Terraform that touches routing | Peer review, validation, window |
| Emergency | Restore service | Revert, failover, hotfix | Do it, then write down what you did |

Irreversibility is the multiplier people forget. Dropping a column, rotating a root key, or shrinking a volume is a different sport from bouncing a service.

## Key Practices

```text
# Minimum change record (even when the change is "small")
# - What and why
# - Blast radius (hosts, regions, data, customers)
# - Success criteria (the metric or probe that must move)
# - Rollback (exact revert PR, flag, snapshot, command)
# - When, who executes, who is awake with them
# - What we will look at for N minutes after

# Prefer, in order:
# 1. Feature flag / config toggle
# 2. Progressive delivery / canary / one box
# 3. Full deploy with automated smoke
# 4. Maintenance window + explicit drain
```

Guardrails that earn their keep:

- Freeze during peak business and during other teams' high-risk windows
- Review anything that touches traffic path, auth, schema, or backup/restore
- Deploy markers in metrics (annotation) so the next incident timeline is not a guessing game
- Automatic rollback *only* when the signal is clean (error rate, probe). Do not auto-revert on CPU
- Config and infra in git. A hotfix that never lands in IaC is just tomorrow's drift

Validation is not "I hit the homepage". Name the check: p99, error ratio, replica lag, queue depth, a specific synthetic, a row count. Write the query in the change ticket.

## Common Failure Modes & Symptoms

| Failure mode | Typical symptom | Mitigation |
|--------------|-----------------|------------|
| No rollback | "We'll figure it out" | No approval without a revert path |
| Giant change | Multi-service, multi-hour bundle | Split until each piece can fail alone |
| Validation is vibes | "Looks fine in the UI" | Concrete metric + probe + time window |
| Emergency never reviewed | Same class of mistake next quarter | Blameless post-change note, even for hotfixes |
| Process theatre | Forms nobody reads, CAB that rubber-stamps | Right-size to risk; kill steps that add no safety |
| Silent drift | Hotfix only on the box | Reconverge from IaC the same day |
| Change during someone else's incident | Two timelines tangled | Freeze non-essential changes when Sev-1 is open |
| Success criteria met the wrong thing | Homepage 200, API 500 | Validate the *path you changed* |
| Rollback untested | Revert PR does not apply, snapshot too old | Rehearse rollback on a sibling env |

## Investigation Tips

- After any incident, ask "what changed?" before "what should we restart?". Keep a searchable log: tickets, PR numbers, deploy annotations, package versions.
- Correlate alert start with deploy and config timestamps. If clocks disagree, fix that second — see [[Metrics Logs and Traces]].
- Practice the rollback in the change window rehearsal, not as creative writing.
- Record the commands you actually ran. The next on-call will not have your shell history.
- Distinguish "we followed the process" from "the change was safe". A completed form does not make a DROP TABLE recoverable.
- If a standard change keeps failing its own validation, it is no longer standard. Demote it until the automation is honest.

## Related Notes

- [[Incident Management]]
- [[Root Cause Analysis]]
- [[High Availability]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[IaC Drift]]
- [[Documentation and Runbooks]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst outage I own started as three "small" changes shipped together so we would only need one window. When it broke we could not tell which piece to revert. One change, one validation, one revert.
- We had a rollback paragraph that said "restore from backup". The backup was 18 hours old and had never been restored on that class of host. Rollback is a *tested procedure*, not a noun.
- Friday flag flips that were "just config" took down checkout because the default in code did not match the default in the flag service. Treat flag changes as deploys: canary, metric, owner awake.
- The change ticket that only said "update packages" taught me to require the package list and the canary host name. Future-me cannot RCA a sentence.
