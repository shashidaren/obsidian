# Root Cause Analysis

## Concept

Root Cause Analysis (RCA) is how you turn an incident into a weaker version of the same failure next time. You identify the trigger, the conditions that made the trigger lethal, and the detection/response gaps that made it last.

It is not a hunt for a villain. "Human error" is the start of the question, not the end. People work inside tools, incentives, and systems that either catch mistakes or amplify them.

Most incidents do not have one root cause. They have a stack of contributing factors. Write them all down.

## Why it matters

- Symptom-only fixes schedule the sequel
- A good RCA produces prevention *and* earlier detection, owned and dated
- A bad RCA produces "be more careful", a new form, or a 12-page document nobody reads
- Customers, auditors, and your future on-call need a story that is true and short enough to use

A useful RCA answers four things: what happened, why it was possible, how we detect it sooner, how we make it harder.

## Mental Model

```
Evidence-first timeline (UTC)
    → Trigger          (what pushed it over)
    → Conditions       (why the system was already fragile)
    → Detection gaps   (why we learned late)
    → Response gaps    (why it lasted)
    → Actions          (prevent, detect, respond — each with an owner)
```

Techniques, used lightly:

- **5 Whys** — useful until it turns into philosophy or blame. Stop at a *controllable* cause.
- **Causal graph** — boxes and arrows beat a paragraph when there are three systems and a freeze window.
- **Timeline + artefacts** — metrics, logs, traces, ticket comments, deploy SHAs. Memory is a hostile witness.

Separate language:

- Facts: timestamps, graphs, commands, versions
- Hypotheses: labelled as such until evidence lands
- Counterfactuals: "if we had paged on error rate" — useful for actions, dangerous as fanfic

## Key Practices

```text
# Collect while the incident is still warm
# - Start / detect / mitigate / resolve times (UTC)
# - Deploy and change markers in the window
# - Queries you actually ran (not "we checked logs")
# - Pages, silences, who joined when
# - What you tried that did *not* work

# Short RCA shape
# 1. Summary (half a page, readable by someone not on the call)
# 2. Impact (who, how long, severity, data at risk?)
# 3. Timeline
# 4. Contributing factors (technical + operational)
# 5. What went well in response
# 6. Actions: owner, due date, how we will know it worked
# 7. Follow-up date to verify the actions shipped
```

Action quality bar:

- Bad: "Improve monitoring", "train the team", "be careful with deploys"
- Good: "Page on payment error ratio > 1% for 5m, runbook linked, owner platform-sre, due date"
- Good: "Add a pre-migrate check that aborts if rollback SQL is missing from the PR"
- Good: "Restore test the nightly backup of cluster P on the 15th; ticket on failure"

If an action cannot fail a follow-up review, it is a slogan.

## Common Failure Modes & Symptoms

| Failure mode | What it looks like | Better approach |
|--------------|--------------------|-----------------|
| Blame-focused | Named a person as the cause | Ask what safeguard was missing |
| Single-cause fetish | Ignored the other three factors | List contributors; rank them |
| Vague actions | No owner, no date, no test | Reject the doc until they exist |
| Never finished | Draft in a folder for a quarter | Time-box to one week after mitigate |
| Only the immediate fix | Patch applied, hole remains | Require at least one detect *or* prevent item |
| No evidence | Narrative with no graphs | Timeline from data first |
| RCA as punishment | People hide near-misses | Blameless write-up; still honest about decisions |
| Action theatre | Twenty items, none shipped | Three items max that would have changed *this* night |
| Wrong altitude | "DNS" as root cause | DNS failed *because* TTL/provider/runbook — keep going one level |

## Investigation Tips

- Write the timeline from evidence before you write the story. Then fit the story to the timeline, not the other way around.
- Keep hypotheses labelled. "We think the pool exhausted because of a leak" is not the same as "ss showed 64k FIN_WAIT2".
- Near-misses belong in the same document. The near-miss is often the previous incident without the last contributing factor.
- Search previous RCAs for the same service. Recurrence is the loudest signal you have.
- Schedule a 20-minute follow-up. Unowned actions die at the retro snack table.
- Include what went *well*. People copy what you praise. If the canary saved you, say so so the next change keeps the canary.
- Share a one-page version widely; keep the appendix of graphs for the people who need it. Length is not rigour.

## Related Notes

- [[Incident Management]]
- [[Change Management]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]
- [[Documentation and Runbooks]]
- [[Metrics Logs and Traces]]

## Personal Lessons Learned

- The first RCA I wrote ended with "engineer error" and a reminder to follow the runbook. Six months later the same class of failure came back with a different engineer. The runbook was wrong under that load; the system invited the mistake.
- We once filed fourteen actions. Two shipped. The useful RCA since then is capped at three actions that would have changed the night we had.
- A timeline built from Slack memory put the deploy *after* the error spike. Grafana annotations put it two minutes before. Build the timeline from systems, then invite humans to fill gaps.
- "Improve monitoring" sat in a tracker for a year. Rewriting it as a specific alert with a runbook URL made it a one-day PR. If you cannot paste the action into a ticket title, it is not an action.
