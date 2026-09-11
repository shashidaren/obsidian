# Metrics Logs and Traces

## Concept

The three working surfaces of observability:

- **Metrics** — numeric time series. Cheap to store, good for "is it broken / how big / since when".
- **Logs** — discrete events with context. Good for "what exactly happened on this process".
- **Traces** — a request's path across services as a tree of spans. Good for "where did the time / error start".

Together they answer *what is broken, where, and why*. One pillar alone always leaves a hole: metrics without logs are a red graph, logs without metrics are a haystack, traces without either are a pretty waterfall of a problem you already missed.

## Why it matters

- Metrics tell you *that* something is wrong and how widespread it is — they are what you alert on
- Logs tell you *what* a specific host, container, or thread did — they are what you quote in the RCA
- Traces tell you *which hop* ate the latency or returned the 500 — they stop the "restart all the things" reflex

Senior ops correlates all three with **the same clock and the same IDs**. If timestamps disagree or there is no request-id, you are reading three different stories.

## Mental Model

```
Metrics  →  "Is the system healthy / trending?"     RED / USE / golden signals
Logs     →  "What exactly happened here?"           events, errors, state changes
Traces   →  "Where did this request spend time?"    spans across services

Join keys: timestamp (NTP-sane) + env + service + host/pod + request-id / trace-id
```

Two vocabularies worth memorising:

- **RED** (services): Rate, Errors, Duration
- **USE** (resources): Utilisation, Saturation, Errors

Golden signals for a user-facing HTTP service are usually: traffic, errors, latency, saturation. CPU is a cause candidate, not a golden signal.

Cost shape:

- Metrics: cheap if cardinality is disciplined. `user_id` as a label will melt Prometheus.
- Logs: expensive and high-cardinality by nature. Structure them (JSON), sample debug, retain hot vs cold differently.
- Traces: require instrumentation (OpenTelemetry, vendor APM, Jaeger/Tempo/Zipkin). Tail-based sampling keeps the interesting failures.

## Key Commands / Checks

```bash
# Host-level metrics when you are on the box
uptime
vmstat 1 5
iostat -xz 1 5
ss -s
free -h
cat /proc/loadavg

# Logs
journalctl -u <service> --since "10 min ago" -o short-iso
journalctl -p err -b --no-pager | tail -50
journalctl -u <service> -o json-pretty | head
tail -f /var/log/<app>.log

# Correlation crumbs in app logs
grep -E 'trace_id|traceparent|request.id|X-Request-ID|cf-ray' /var/log/<app>.log | tail

# Clock sanity — do this before you trust a cross-host timeline
timedatectl
chronyc tracking 2>/dev/null || ntpq -p 2>/dev/null
date -u

# One-screen incident snapshot
date -u; uptime; systemctl --failed
journalctl -p err --since "20 min ago" --no-pager | tail -30
```

In production you query Prometheus/Grafana (or equivalent), Loki/ELK, and a tracing backend. The host tools above are for "I am SSH'd in and the observability stack is itself on fire".

What "good" instrumentation looks like on an app:

- Metrics: RED + saturation, with `service`, `env`, `code`, `route` *class* (not raw URL) as labels
- Logs: JSON, level, `request_id` / `trace_id`, `user` hashed if needed, error type, not a 4 KB stack on every 200
- Traces: incoming context propagated (`traceparent`), outbound clients instrumented, spans named after *operations* not after framework internals

## Common Failure Modes & Symptoms

| Symptom | Likely gap | First checks |
|---------|------------|--------------|
| Alert fires, no useful detail | Metrics without join keys in the page | Does the alert include service, instance, time window? |
| "It was slow" with no evidence | No traces, or logs without request-id | Was the id logged? Was the SDK even on that service? |
| Logs present but unsearchable | Unstructured text, inconsistent field names | JSON? common labels? retention window? |
| Metrics green, users angry | Watching CPU instead of latency/errors | p99 + error rate + synthetic probe |
| Trace with a hole | Missing library / agent, or sampled out | Confirm SDK on that hop; check sampling policy |
| Timeline makes no sense | Clock skew, mixed TZ in log formats | `timedatectl` on both ends; store UTC |
| Prometheus OOM / slow queries | High-cardinality labels | Drop `user_id`, full path, raw email from metric labels |
| "We have traces" but 1% of requests | Aggressive head sampling | Tail-based sampling on errors and slow requests |
| Observability outage during the incident | Single cluster, same failure domain | Treat the telemetry pipeline as a production service |

## Investigation Tips

- Start from the **symptom timeline**, not from a favourite tool. When did RED deviate? What do logs say in that exact window? Which span is first to go red or slow?
- Pull one failing user request's `request_id` / `trace_id` and follow it. Do not grep for `ERROR` across an hour if you have an id.
- Saturating a disk or an fd table shows up in USE long before RED if the app is buffering. Check both.
- High-cardinality labels belong in logs and trace attributes, not in metric label sets.
- During an incident the first useful question is often: "error rate and p99 for 30 minutes, plus last deploy marker". Then drill.
- If the observability stack is dark, fall back to host tools and access logs. Do not wait for Grafana to recover before you look at the box.
- Sampling is a product decision. Debug-level logs and 100% traces in prod are how you page yourself for the collector.

## Related Notes

- [[Logging Architecture]]
- [[Alert Design]]
- [[journald and Persistent Storage]]
- [[logrotate]]
- [[rsyslog]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]
- [[Incident Management]]

## Personal Lessons Learned

- We once spent forty minutes arguing about order of events because one container image set `TZ=Local` and another logged Zulu. Force UTC in the image and in the shipper. Argue about causes after the clocks agree.
- A "perfect" dashboard of CPU and RAM stayed green through a 15-minute user outage. The app was waiting on a dependency; our process was idle. RED on the *service*, USE on the *box*.
- Adding `customer_id` as a Prometheus label made queries pretty and then made Prometheus fall over during a traffic spike. That field lives in the log line now.
- The first time the tracing collector died we had no traces *and* no fallback plan. Treat collectors like production: disk, saturation, and a documented "SSH and journalctl" path.
