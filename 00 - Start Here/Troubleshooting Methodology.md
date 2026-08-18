# Troubleshooting Methodology

## 1. Define the problem precisely
“Server is slow” is not a diagnosis. Determine:
- Which service or users are affected?
- When did it begin?
- Is every request slow or only some?
- Is the issue isolated to one host?
- What changed shortly before the problem?

## 2. Establish scope
Compare healthy and unhealthy systems when possible. Scope prevents local symptoms from being mistaken for platform-wide failures.

## 3. Build a timeline
Correlate deployments, configuration changes, certificate expiry, capacity growth and alerts with the first known symptom.

## 4. Observe before changing
Useful baseline:

```bash
date
uptime
free -h
df -hT
df -i
systemctl --failed
journalctl -p err -b
ip route
ss -s
```

## 5. Test hypotheses
Change one variable at a time. “Restart everything” may restore service but destroys evidence and can hide the real failure.

## 6. Verify
Confirm the original symptom is gone, dependencies are healthy and error rates/latency have returned to normal.

## 7. Prevent recurrence
Document root cause, contributing factors, detection gaps and concrete corrective actions.
