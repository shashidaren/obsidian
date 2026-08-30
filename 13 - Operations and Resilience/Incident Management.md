# Incident Management

## Concept

Incident management is the operational process for detecting, declaring, mitigating, recovering from, and learning from unplanned service degradation or outage. Technical diagnosis is only one slice; coordination and evidence handling decide how fast you recover and whether you learn anything useful.

## Why it matters

- Good individual troubleshooting without roles and comms produces duplicate work, conflicting changes, and silent stakeholders
- Restarting or deleting before capturing state destroys the only evidence you will have for RCA
- Late declaration turns a contained issue into a multi-team scramble
- Incidents without follow-up items just repeat next quarter

Severity is about user impact and blast radius, not how interesting the bug is.

## Mental Model

```
Detect → Declare / triage → Investigate & mitigate → Recover → Communicate → Review

During the live incident, optimize for:
  1. Stop the bleeding (mitigate user impact)
  2. Preserve evidence
  3. One change at a time
  4. Honest status, even if it is "still investigating"

After recovery, optimize for:
  1. Timeline of facts
  2. Contributing factors (not a single villain)
  3. Concrete owners and due dates
```

Roles can be combined on a small team, but they should be named out loud:

| Role               | Job |
|--------------------|-----|
| Incident Commander | Priority, decisions, who talks to whom |
| Technical lead     | Hands-on investigation and changes |
| Communications     | Status to users / leadership |
| Scribe             | Timestamped actions and findings |

## Key Commands

Capture a snapshot *before* you restart services or recycle nodes.

```bash
# Host snapshot
date -Is; uptime; who; free -h; df -hT; ip -br a
systemctl --failed
ps aux --sort=-%cpu | head
ps aux --sort=-%mem | head

# Logs around the start of impact
journalctl -b -p err --no-pager | tail -n 200
journalctl -u <service> --since "2 hours ago" --no-pager > /tmp/${HOSTNAME}-service.log

# Network / listeners if the symptom is "can't connect"
ss -lntup
curl -sv --max-time 5 https://localhost:<port>/health || true

# Kubernetes slice
kubectl get nodes -o wide
kubectl get pods -A -o wide | grep -Ev 'Running|Completed'
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous --tail=200

# Freeze a timeline file
printf '%s %s\n' "$(date -Is)" "declared Sev-X: <symptom>" >> /tmp/incident-timeline.txt
```

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Many people changing things at once | No commander / no change queue | Stop, name an IC, serialize changes |
| "We fixed it" but nobody knows how | Restart-as-first-action | Diff configs, compare logs from before bounce |
| Stakeholders hear about it from users | Late or no comms | Short status cadence; "next update at T+N" |
| Same incident next month | No tracked follow-ups | Postmortem with owners and dates |
| Evidence gone | Logs rotated, pod deleted, disk wiped | Capture first; only then remediate |
| Severity thrash | Impact not defined | Users affected, duration, data risk |
| Heroics instead of process | No runbooks / no paging hygiene | Write the 10-line runbook after |

## Investigation Tips

- Declare early. Downgrade is cheap; lost first hour is not.
- Write the symptom in one sentence: *who* is affected, *what* fails, *since when*.
- Separate mitigate from root-cause. Rollback, failover, or feature-flag first if that restores users.
- One hypothesis, one change, one expected signal. Announce the change in the incident channel.
- Keep a crude timeline even if it is a paste of timestamps and commands.
- Do not debug on the only remaining healthy replica until traffic is drained or capacity exists.
- After recovery, confirm *user-facing* behavior, not just `systemctl is-active`.
- Schedule the review while memory is fresh; use the postmortem template in `99 - Templates`.

## Related Notes

- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]
- [[Root Cause Analysis]]
- [[Change Management]]
- [[Documentation and Runbooks]]
- [[Alert Design]]
- [[High Availability]]
- [[Disaster Recovery]]

## Personal Lessons Learned

> 
