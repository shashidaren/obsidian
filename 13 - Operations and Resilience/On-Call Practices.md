# On-Call Practices

## Concept

On-call is the operational contract that someone will answer when the system pages, with enough context to mitigate, and with a path to hand off or escalate. It is not “be available and figure it out.”

Good on-call is mostly preparation: alerts that name a runbook, a rotation that is sustainable, and a hand-off that does not depend on memory.

## Why it matters

- An alert with no runbook is a 3 a.m. research project.
- Hero culture burns people out and hides single points of knowledge.
- Poor hand-off recreates the same incident on the next shift.
- Pages that are not actionable train the team to ignore the pager.
- After-action notes that never become runbook updates guarantee the sequel.

## Mental Model

```
Before the page:
  alert → runbook link → known mitigation → escalation path

During:
  acknowledge → mitigate → communicate → preserve evidence → hand off or resolve

After:
  timeline → contributing factors → owned action (runbook, alert, code)
```

The goal of the first 15 minutes is to stop user pain or to know why you cannot, not to find the root cause.

## Key Commands / Practices

```bash
# Snapshot before you change anything
date -Is; hostname; uptime
journalctl -u <service> --since "30 min ago" --no-pager | tail -100 > /tmp/pre-change.log

# Declare in the channel
# "Sev-2, IC is me, next update 15 min, mitigating via <action>"

# Hand-off note (even to yourself)
cat > /tmp/handoff.md <<EOF
Impact: …
Started: …
What we tried: …
Current state: …
Next action: …
EOF
```

Practices that reduce toil:

- Every page links to a runbook or is deleted.
- Rotation length and load are visible. If one person is always primary, the system is not ready.
- Post-incident, the runbook is updated before the ticket is closed.
- Secondary is real: they can take the page if primary is in a change window or asleep after a previous page.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First correction |
|---------|--------------|------------------|
| Page, then 20 min of “what does this mean?” | No runbook or alert text is useless | Fix the alert; link the runbook |
| Same person always on-call | Rotation fiction or knowledge silo | Enforce rotation; pair on hard pages |
| Incident ends, nothing written | No hand-off or postmortem habit | Timeline file + one owned action |
| Alert ignored | Previously noisy, no trust | Tune or delete; do not train silence |
| Mitigation applied, no status | Comms treated as optional | Cadence even when “no change” |
| Next shift rediscovers the same state | Hand-off was verbal only | Written note in the channel or ticket |

## Investigation Tips

- Acknowledge quickly so others know someone has it. Silence looks like “nobody is on-call.”
- Mitigate first if a safe action exists (rollback, failover, scale, feature flag). Root cause can wait.
- Write the hand-off even if you are about to resolve it. The next page may be related.
- If the runbook is wrong, fix it in the same incident window or create the ticket before you close.
- Track page volume. A sustainable on-call is a leading indicator of system health.
- Escalation is not failure. Use it when you are stuck or when the blast radius needs more eyes.

## Related Notes

- [[Incident Management]]
- [[Alert Design]]
- [[Documentation and Runbooks]]
- [[Root Cause Analysis]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The page that took 40 minutes was an alert whose only text was the metric name. After we added “runbook: [[Disk Full Runbook]]” and the exact `df` command, the same condition was mitigated in four minutes the next time.
- I used to resolve and go back to sleep without a note. The follow-up page two hours later had no context. A three-line hand-off in the incident channel would have saved the next person (me) the re-discovery.
- We kept a “temporary” secondary who was never paged. When primary was in a maintenance window the alert sat. Making secondary real — and testing it — removed the single point of failure.
