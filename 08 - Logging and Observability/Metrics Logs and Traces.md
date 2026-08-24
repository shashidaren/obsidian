# Metrics Logs and Traces

## Concept

The three pillars of observability: **metrics** (numeric time series), **logs** (discrete events with context), and **traces** (request/path journeys across services). Together they answer “what is broken, where, and why”.

## Why it matters

- Metrics tell you *that* something is wrong and how widespread it is
- Logs tell you *what* happened on a specific host or process
- Traces tell you *where* latency or errors occurred across a distributed path

Relying on only one pillar leaves blind spots. Senior ops correlates all three with consistent timestamps and identifiers.

## Mental Model

```
Metrics  →  “Is the system healthy / trending?”   (RED / USE / golden signals)
Logs     →  “What exactly happened here?”         (events, errors, state changes)
Traces   →  “Where did this request spend time?”  (spans across services)

Correlation keys: timestamp + host + service + request-id / trace-id / pod
```

- Metrics are cheap to store and query at scale; good for alerting and dashboards.
- Logs are high-cardinality and expensive; use structured logging and sampling.
- Traces require instrumentation (OpenTelemetry, Jaeger, Zipkin, vendor APM).

## Key Commands / Checks

```bash
# Local metrics (host level)
uptime
vmstat 1 5
iostat -xz 1 5
ss -s

# Logs
journalctl -u <service> --since "10 min ago" -o short-iso
journalctl -p err -b
tail -f /var/log/<app>.log

# Trace-related (when present)
# Look for traceparent / X-Request-ID / correlation IDs in logs
grep -E 'trace|request.id|X-Request' /var/log/<app>.log | tail

# Quick health correlation
date; uptime; systemctl --failed; journalctl -p err -b --no-pager | tail -20
```

In production you usually query Prometheus/Grafana, Elasticsearch/Loki, and a tracing backend rather than raw host tools.

## Common Failure Modes & Symptoms

| Symptom                              | Likely gap                              | First checks                                      |
|--------------------------------------|-----------------------------------------|---------------------------------------------------|
| Alert fires but no useful detail     | Metrics without linked logs/traces      | Does the alert include host + service + time?     |
| “It was slow” with no evidence       | Missing traces or high-cardinality logs | Was request-id logged? Was tracing enabled?       |
| Logs present but hard to search      | Unstructured / no consistent fields     | Check for JSON logs, common labels, retention     |
| Metrics look fine, users complain    | Wrong golden signals or lagging metrics | Check user-facing latency/error rate, not just CPU|
| Trace shows gap with no span         | Missing instrumentation or sampling     | Verify SDK / agent on that service                |
| Clock skew between systems           | NTP / timezone issues                   | Compare timestamps across hosts                   |

## Investigation Tips

- Start with the symptom timeline: when did metrics deviate, when did logs start showing errors, where do traces show the first slow span?
- Always pull a request-id / trace-id from a failing user request and follow it.
- Prefer RED (Rate, Errors, Duration) for services and USE (Utilisation, Saturation, Errors) for resources.
- High-cardinality labels in metrics (user-id, full path) will burn storage and query performance — design labels carefully.
- During incidents, the first useful action is often “show me the error rate and p99 latency for the last 30 minutes”, then drill into logs/traces for that window.

## Related Notes

- [[Logging Architecture]]
- [[Alert Design]]
- [[journald and Persistent Storage]]
- [[logrotate]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
