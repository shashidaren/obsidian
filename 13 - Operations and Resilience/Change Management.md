# Change Management

## Concept

Change management is the set of practices that make production changes safer: clear purpose, risk assessment, validation steps, and an explicit rollback path. It ranges from lightweight peer review for low-risk changes to formal CAB processes for high-impact ones.

## Why it matters

- Most outages are caused or triggered by a change
- Small, reversible, well-validated changes are dramatically safer than large, irreversible ones
- Without a shared language for risk, teams either move too slowly or ship dangerous changes casually
- Good change discipline shortens recovery because rollback is already planned

The goal is not bureaucracy; it is predictable, recoverable change.

## Mental Model

```
Propose → Assess risk → Review → Implement → Validate → (Rollback if needed) → Record

Risk roughly = blast radius × uncertainty × irreversibility
```

Classify changes:

- **Standard** — pre-approved, low risk, automated or well-rehearsed (e.g. routine package update with canary)
- **Normal** — needs review; moderate risk
- **Emergency** — required to restore service; still record and review after the fact

## Key Practices

```bash
# Minimum viable change record (even for small changes)
# - What is changing and why
# - Risk / blast radius
# - Validation steps (what “success” looks like)
# - Rollback steps (exact commands or revert PR)
# - Window / freeze considerations
# - Who is executing and who is on standby

# Prefer:
# - Feature flags / config toggles over code deploys when possible
# - Canary or progressive delivery
# - Automated tests + smoke checks post-change
# - Explicit maintenance windows for high-impact work
```

Useful guardrails:

- Change freeze during peak business periods or major events
- Peer review for anything that touches production config, schema, or traffic paths
- Automated rollback triggers where safe (e.g. error-rate spike after deploy)

## Common Failure Modes & Symptoms

| Failure mode                         | Typical symptom                            | Mitigation                                |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| No rollback plan                     | “We’ll figure it out if it breaks”         | Require rollback steps before approval    |
| Giant change                         | Multi-hour, multi-service deploy           | Split into smaller, independently releasable pieces |
| Validation is “looks fine”           | No metrics or synthetic check              | Define concrete success criteria + dashboards |
| Emergency changes never reviewed     | Same class of mistake repeats              | Blameless post-change review              |
| Process theatre                      | Long forms that nobody reads               | Right-size process to actual risk         |
| Silent config drift                  | Manual hotfixes that never reach IaC       | Treat config as code; reconverge          |

## Investigation Tips

- After any incident, the first question is often “what changed?” — keep a searchable change log (tickets, PRs, deploy markers).
- Correlate alert start times with deploy and config-change timestamps.
- For risky changes, practice the rollback *before* the change window when possible.
- Document the actual commands run; future you (or the next on-call) will need them.
- Distinguish “we followed the process” from “the change was safe”. Process is a tool, not the goal.

## Related Notes

- [[Incident Management]]
- [[Root Cause Analysis]]
- [[High Availability]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[IaC Drift]]
- [[Documentation and Runbooks]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
