# Alert Design

## Concept

An alert is a contract: a signal that a human should spend attention *now*, plus enough context to start. It is not a graph annotation, not a log line, and not a badge that a metric exists.

Good alerts fire on **symptoms users feel** or on **clear risk that will become a symptom soon** (disk will fill, cert expires in 7 days, replica lag crossing RPO). Bad alerts fire because a gauge looked slightly rude.

## Why it matters

- Alert fatigue trains on-call to mute the pager. After that, real pages arrive into a silenced channel
- Noisy alerts hide the two that matter during a multi-service incident
- Well-designed alerts shorten MTTR because the page already names the service, the SLO, the dashboard, and the runbook
- Poorly designed alerts lengthen incidents *and* burn people out, which then causes the next incident

The goal is high signal, low noise, and an obvious first action. Coverage of every time series is not a goal.

## Mental Model

```
User / risk symptom
        ↓
   Signal (metric, probe, log pattern, SLO burn)
        ↓
   Alert (severity, for-duration, routing)
        ↓
   Human + runbook + dashboard + recent change list
```

Properties of a page-worthy alert:

- **Actionable** — someone can do a useful thing in the next 15 minutes
- **Urgent** — waiting until morning makes it worse
- **Specific** — names a service, cluster, or dependency, not "the platform"
- **Understood** — linked to a runbook or a known class of failure
- **Reversible in the UI** — it auto-resolves when the condition clears

Severity ≠ priority. A "critical" alert that fires every deploy is still noise. Page on **user impact or imminent risk**. Ticket or Slack on **capacity trends**.

Two useful taxonomies:

| Style | Example | Use when |
|-------|---------|----------|
| Symptom / SLO | p99 latency > SLO, error rate > 1%, probe fail | User-facing services |
| Resource / USE | disk 90% and rising, FD exhaustion, replica lag | You can name the next action |
| Predictive | cert TTL < 14d, backup last-success > 24h | Failure is certain if ignored |
| Cause-based | CPU > 90% | Rarely page-worthy by itself |

## Key Principles & Patterns

```text
# Symptom over cause
Bad:    instance:cpu_usage > 0.90 for 5m
Better: job:http_request_error_ratio > 0.01 for 5m
        OR probe_success == 0 for 2m
        OR job:http_request_duration:p99 > SLO

# Multi-window multi-burn (Google SRE style, adapted)
# Fast burn:  1h window, high burn  → page now
# Slow burn:  6h / 24h window       → ticket, not a 03:00 page

# Every page payload should answer:
# - What is broken or at risk?
# - Which service / cluster / env?
# - Since when? (annotation + query window)
# - Dashboard URL, runbook URL, owner / escalation
# - What "better" looks like (recovery condition)
```

Design checklist before you ship a new rule:

- Would I want to be woken for this on a Sunday?
- If it fires, is there a first command or a runbook step?
- Does it stay firing after the problem is gone?
- Is the threshold tied to user impact or to a round number someone liked?
- Have you forced the failure in staging and watched the alert open *and* close?
- Who owns silence / inhibit / routing when this service is under planned change?

Routing matters as much as the threshold. Page the service owner, not a global channel. Inhibit node-down child alerts when the host is already known dead. Deduplicate the same symptom arriving from Prometheus, the cloud vendor, and the uptime probe.

## Common Failure Modes & Symptoms

| Problem | Typical cause | Result / Fix |
|---------|---------------|--------------|
| Constant paging | Tight threshold, no `for`, no hysteresis | Raise threshold, add duration, multi-window burn |
| Silent real outages | Only watching CPU/RAM, no probes or error rate | Add synthetic checks + RED signals |
| Alert never resolves | Missing recovery expr, sticky recording rule | Explicit `for` + clear "OK" condition |
| Duplicate pages | Same symptom in three tools | One source of truth; inhibit the rest |
| Nobody knows what to do | No runbook, no owner label | Block merge of alert PRs without `runbook_url` |
| Pages on every deploy | No maintenance window / deploy marker | Silence window or lower severity during known change |
| Flap on sparse traffic | Error *ratio* on 2 requests | Minimum request volume gate |
| Dashboard-only "alerts" | Someone stared at a graph | If it is not routed, it is not an alert |
| Cert / backup alerts ignored | Severity too high or too low | Predictive alerts as tickets with SLA, not pages at 3am unless expiry is hours away |

## Investigation Tips

- When paged: confirm the *symptom* is still present (dashboard + probe + last 15 minutes of logs) before you open a profiler.
- Look at rate of change and at **what changed** (deploy marker, config push, cert rotation, traffic spike, dependency SLO).
- If the same alert fires and self-resolves with no lasting impact, that is an alert-design bug. File it against the rule, not against the on-call.
- Prefer fewer, higher-quality pages. "We monitor everything" is how you monitor nothing.
- Review alert history monthly: acted-on, silenced, ignored, never-fired. Delete or demote the last two categories.
- Test the *recovery* path. An alert that cannot return to OK will page forever and then get muted forever.
- Keep runbooks next to the rule in git. A Confluence page that drifted last year is how people "just restart it".

## Related Notes

- [[Metrics Logs and Traces]]
- [[Logging Architecture]]
- [[Incident Management]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]
- [[High Availability]]
- [[Change Management]]
- [[Capacity Planning]]

## Personal Lessons Learned

- CPU-at-90% pages trained the team to ignore the pager. The outage that got through was a dependency returning 502s while our boxes sat at 20% CPU. Symptom alerts first; resource alerts as tickets unless you can name the action.
- A ratio alert with no volume floor paged every night when a cron hit a dead endpoint once. Two failures in a window of two requests is 100%. Gate on request count.
- We once had four tools page the same disk-full host. After the third acknowledgement people stopped reading. One owner, one page, inhibit the children.
- If the alert text does not contain the service name and a link, the first five minutes of the incident are spent asking "which one?". Put the context in the payload; do not assume the on-call has your Grafana folder memorised.
