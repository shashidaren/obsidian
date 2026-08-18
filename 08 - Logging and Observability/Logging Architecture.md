# Logging Architecture

## Concept

Logs can be written in several places and then collected, forwarded, and stored. A typical path looks like:

```
Application
    ↓
stdout / stderr / log file / journald / syslog
    ↓
Local agent (Fluent Bit, rsyslog, Promtail, etc.)
    ↓
Central system (Loki, Elasticsearch, Splunk, cloud logging…)
```

## Why it matters

When someone says “the logs are missing”, you need to know:
1. Where the application actually writes
2. Whether a local agent is collecting them
3. Whether they are being forwarded and retained centrally
4. Retention and disk limits on each stage

## Mental Model

```
Generation → Local storage / journal → Collection agent → Central store → Retention / search
```

Each hop can drop, delay, or filter messages.

## Common Local Destinations

| Destination     | Typical use                              |
|-----------------|------------------------------------------|
| stdout / stderr | Containers (Kubernetes, Docker)          |
| journald        | systemd services                         |
| Files under /var/log | Traditional applications, rsyslog     |
| Application-specific files | Java, custom apps                   |

## Key Investigation Commands

```bash
# systemd / journal
journalctl -u <service> -b
journalctl --disk-usage

# Classic files
ls -l /var/log
tail -f /var/log/syslog

# Container logs
kubectl logs <pod>
docker logs <container>

# Disk pressure from logs
du -sh /var/log/*
journalctl --disk-usage
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely stage                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| No logs for a service                | Generation or local collection            | Is the app writing? journald/file permissions |
| Logs stop after some time            | Disk full / retention limits              | `df`, journald config, logrotate |
| Logs present locally, missing centrally | Agent or network                       | Agent status, forwarder logs     |
| High disk usage by logs              | Rotation / retention misconfigured        | logrotate, journald SystemMaxUse |

## Investigation Tips

- Always establish the full path from application to final storage.
- In Kubernetes, applications should log to stdout/stderr; node agents collect them.
- Check both retention settings and disk space — they interact.
- Timestamps and timezones frequently cause confusion when correlating logs across systems.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[logrotate]]
- [[rsyslog]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
