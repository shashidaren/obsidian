# Alert Design

## Concept

An alert is a signal that something requires human attention *now*. Good alerts are tied to symptoms that matter to users or to clear risk thresholds; bad alerts fire on every metric that looks slightly off.

## Why it matters

- Alert fatigue is the fastest way to train on-call staff to ignore pages
- Noisy alerts hide the few that actually need action
- Well-designed alerts shorten MTTR; poorly designed ones lengthen it and burn people out
- Alerts are part of the observability contract: they should map to runbooks and known failure modes

The goal is high signal, low noise, and clear next steps.

## Mental Model

```
Symptom (user-visible or risk) → Signal (metric / log / probe) → Alert → Human + Runbook

Good alert properties:
- Actionable (someone can do something useful)
- Urgent (needs attention soon)
- Specific (points to a system or service)
- Understood (linked to a runbook or known cause)
```

Severity is not the same as priority. A critical severity alert that fires every hour is still noise.

## Key Principles & Patterns

```bash
# Prefer symptom-based over cause-based where possible
# Bad:  CPU > 90% for 5m
# Better: Request latency p99 > SLO for 5m  OR  error rate > 1%

# Multi-window / multi-burn-rate (common for SLOs)
# Fast burn: 1h window, high burn rate → page immediately
# Slow burn: 6h/24h window → ticket or lower severity

# Always include:
# - What is broken / at risk
# - Which service / host / cluster
# - Link to dashboard and runbook
# - Clear severity and expected response time
```

Useful design checklist:

- Does this alert fire only when a human should act?
- Is there a runbook or known first step?
- Will it auto-resolve when the condition clears?
- Is the threshold based on user impact or pure resource usage?
- Have you tested the alert in a controlled failure?

## Common Failure Modes & Symptoms

| Problem                              | Typical cause                              | Result / Fix                              |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| Constant paging                      | Threshold too tight or no hysteresis       | Raise threshold, add duration, use multi-window |
| Silent real outages                  | Only monitoring causes, not symptoms       | Add synthetic checks / error-rate / latency alerts |
| Alert never resolves                 | Missing recovery condition or sticky state | Ensure "for" duration and clear recovery  |
| Duplicate pages from many sources    | Overlapping rules across tools             | Deduplicate / route by service owner      |
| No one knows what to do              | Alert has no runbook or owner              | Attach runbook URL and escalation path    |
| Alerts on every deploy               | No maintenance window / change correlation | Suppress or lower severity during known changes |

## Investigation Tips

- When an alert fires, first confirm the symptom is still present (dashboard + recent logs) before deep diving.
- Look at the *rate of change* and correlated signals (deploy markers, traffic spikes, dependency health).
- If the same alert fires repeatedly with no lasting impact, treat it as a design problem, not just an ops problem.
- Prefer fewer, higher-quality alerts over comprehensive coverage of every metric.
- Review alert history monthly: which ones were acted on, which were silenced, which were ignored?

## Related Notes

- [[Metrics Logs and Traces]]
- [[Logging Architecture]]
- [[Incident Management]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]
- [[High Availability]]

## Personal Lessons Learned

> 
