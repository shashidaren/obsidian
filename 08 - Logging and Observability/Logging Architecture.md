# Logging Architecture

## Concept

Logging architecture is the path a message takes from the process that generated it to the place a human (or an alert) will later search. A typical production path is:

```
Application
    ↓
stdout / stderr / log file / journald / syslog
    ↓
Local agent (rsyslog, Fluent Bit, Promtail, Vector, cloud agent)
    ↓
Central store (Loki, Elasticsearch, Splunk, cloud logging)
    ↓
Retention, search, dashboards, alerts
```

If you cannot draw that path for a given service, you do not yet have a logging architecture — you have files on a box.

## Why it matters

- “The logs are missing” is usually a hop problem, not an application problem
- Each hop can drop, delay, filter, reformat, or rewrite timestamps
- Disk-full incidents are often log-retention incidents in disguise
- Central search is useless if local generation never happened, or if the agent is dead
- Incident response speed depends on knowing *where* to look first, not on having every tool installed

Treat logs as a pipeline with SLOs (freshness, completeness, retention), not as a folder.

## Mental Model

```
Generation → Local buffer → Collection → Transport → Index / store → Query / alert

Ask at every hop:
  Who writes?
  What format (plain, JSON, syslog, journal)?
  Where on disk / which socket?
  Who reads and forwards?
  What is filtered or sampled?
  How long is it kept?
  What happens when the next hop is down?
```

Two clocks exist: the application timestamp inside the message, and the ingest timestamp at the collector. They disagree more often than people expect (timezone, NTP drift, container clock, multiline parse).

Local destinations vs central store:

| Destination | Typical producer | Strength | Weakness |
|-------------|------------------|----------|----------|
| stdout / stderr | Containers | Simple, collected by runtime | Lost if the node agent is down and the container is gone |
| journald | systemd units | Structured, metadata-rich | Persistence and size limits are easy to misconfigure |
| `/var/log/*` via rsyslog | Traditional daemons | Familiar, rotateable | Split across files; easy to forget a path |
| App-specific files | Java, nginx extra logs, custom | Often the only place for access/error detail | Agents must be told the path |

## Key Commands

```bash
# Where is this unit sending output?
systemctl cat <service> | grep -E 'Standard(Output|Error)|SyslogIdentifier'
journalctl -u <service> -b --no-pager | tail

# Local journal health
journalctl --disk-usage
ls -ld /var/log/journal /run/log/journal

# Classic files and rotation
ls -lah /var/log
du -sh /var/log/* | sort -h | tail
cat /etc/logrotate.conf /etc/logrotate.d/* | less

# Is the forwarder alive?
systemctl status rsyslog fluent-bit promtail vector amazon-cloudwatch-agent 2>/dev/null
journalctl -u rsyslog -u fluent-bit -u promtail -n 80 --no-pager

# Containers / Kubernetes
docker logs --timestamps --tail 100 <container>
kubectl logs <pod> -n <ns> --timestamps --tail=100
kubectl logs <pod> -n <ns> --previous
# node agent (example)
kubectl -n logging get pods -o wide

# Prove a message left the box (if you control a logger)
logger -t smoke-test "pipeline check $(date -Is)"
journalctl -t smoke-test -n 5 --no-pager
```

When central search is empty, run the smoke-test on the host and watch which hop first fails to show it.

## Common Failure Modes & Symptoms

| Symptom | Likely stage | First checks |
|---------|--------------|--------------|
| No logs for a service at all | Generation | Unit running? logging to a file you are not tailing? stdout discarded? |
| Logs on the host, missing centrally | Collection / transport | Agent status, destination credentials, filter rules, network/firewall |
| Logs stop after hours or days | Retention / disk | `df -h`, `journalctl --disk-usage`, logrotate, agent buffer full |
| Gaps only around deploys or restarts | Volatile journal or short container lifetime | Persistence of journald; agent sidecar vs node agent |
| Multiline stack traces split or missing | Parser | Agent multiline config; journal vs file path |
| Timestamps off by hours | Timezone / clock | `timedatectl`, container TZ, ingest vs event time in the UI |
| Flood of one noisy logger hides others | No rate limit | Rate-limit at journald/rsyslog/agent; fix the app |
| Central query slow or incomplete | Index / retention | Shard health, ingestion lag, retention window vs the incident time |

## Investigation Tips

- Start at generation and walk forward. Do not start in the SIEM and assume the host is fine.
- Confirm wall-clock and timezone on the host before correlating anything (`date -Is`, `timedatectl`).
- In Kubernetes, the contract is stdout/stderr + a node or sidecar agent. `kubectl logs` talks to the kubelet; central search talks to the agent. They can disagree.
- Check *filters* on the agent (drop rules, sampling, exclude paths). “Missing logs” is often “successfully dropped logs”.
- Disk pressure and logging fight each other: full `/var` stops new logs, which then hides the reason `/var` filled.
- Record retention in days *and* in gigabytes at every hop. The shortest hop wins.
- After a change to rsyslog, journald, or an agent, inject a tagged test message and search for that tag end-to-end.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[logrotate]]
- [[rsyslog]]
- [[Alert Design]]
- [[Metrics Logs and Traces]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> Central “no data” is a pipeline ticket until proven otherwise. A one-line `logger` smoke test on the host has closed more of these than any dashboard.
