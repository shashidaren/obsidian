# Root Cause Analysis

## Concept

Root Cause Analysis (RCA) is the disciplined process of identifying *why* an incident happened (technical causes and contributing conditions) so that the same class of failure is less likely to recur. It is not a blame exercise.

## Why it matters

- Fixing only the symptom guarantees the next similar outage
- Good RCAs produce concrete prevention work (monitoring, tests, process, architecture)
- Poor RCAs produce vague action items that never get done or that simply add more process theatre
- In high-stakes environments, regulators and customers often expect a clear post-incident story

A useful RCA answers: what happened, why it happened, how we will make it harder next time, and how we will detect it earlier.

## Mental Model

```
Incident timeline
  → Immediate trigger (what broke the camel’s back)
  → Underlying conditions (why the system was vulnerable)
  → Detection & response gaps (why it lasted as long as it did)
  → Prevention & detection improvements
```

Common techniques (use judiciously):

- **5 Whys** — keep asking “why” until you reach a controllable cause (easy to stop too early or go off into philosophy)
- **Causal graph / fishbone** — map contributing factors (people, process, technology, environment)
- **Timeline + evidence** — always start from a verified sequence of events and logs/metrics

Prefer “contributing factors” language over a single mythical root cause; most incidents are multi-factor.

## Key Practices

```bash
# Evidence collection (do this while the incident is still warm)
# - Exact start/end times (UTC)
# - Deploy / change markers
# - Metrics, logs, traces around the window
# - Commands that were run and their output
# - Who was paged and when

# Structure a short RCA document:
# 1. Summary (1–2 paragraphs)
# 2. Impact (users, duration, severity)
# 3. Timeline
# 4. Technical root / contributing causes
# 5. What went well / what could be improved in response
# 6. Action items (owner, due date, success criteria)
# 7. Follow-up review date
```

Action items should be specific, owned, and testable. “Be more careful” is not an action item.

## Common Failure Modes & Symptoms

| Failure mode                         | What it looks like                         | Better approach                           |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| Blame-focused RCA                    | “Engineer X made a mistake”                | Focus on system design and safeguards     |
| Single-root-cause fetish             | Ignoring concurrent contributors           | List multiple contributing factors        |
| Vague actions                        | “Improve monitoring” with no owner         | Concrete change + owner + due date        |
| RCA never finished                   | Draft sits for months                      | Time-box; ship a good-enough version      |
| No link to prevention                | Only the immediate fix is done             | Require at least one detection or prevention item |
| Skipping evidence                    | Narrative without timestamps or logs       | Build timeline from data first            |

## Investigation Tips

- Write the timeline from evidence *before* forming a narrative. Memory is unreliable under stress.
- Separate “what happened” from “why we think it happened”. Keep hypotheses labelled as such.
- Include near-misses and partial failures; they often reveal the same weaknesses.
- Review previous RCAs for the same service — patterns of recurrence are gold.
- Close the loop: schedule a short follow-up to confirm action items actually shipped and worked.
- For complex systems, a lightweight causal diagram is often clearer than pure prose.

## Related Notes

- [[Incident Management]]
- [[Change Management]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]
- [[Documentation and Runbooks]]

## Personal Lessons Learned

> 
