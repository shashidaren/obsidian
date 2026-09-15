# Incident Management

## Concept

Incident management is how a team detects, declares, mitigates, recovers from, and learns from unplanned degradation. Diagnosis is one slice. Coordination, evidence, and follow-up decide whether you recover cleanly and whether the same page fires next quarter.

Severity measures user impact and blast radius, not how clever the bug is.

## Why it matters

- Skilled people without roles duplicate work and step on each other’s changes.
- Restart-first destroys the only evidence you will have for RCA.
- Late declaration turns a contained fault into a multi-team scramble and angry stakeholders who heard it from customers.
- An incident with no tracked actions is a rehearsal for the sequel.
- Honest status (“still investigating, next update 11:20”) beats silence and beats fiction.

## Mental Model

```
Detect → Declare + triage → Mitigate → Investigate → Recover → Communicate → Review

Live incident, in order:
  1. Stop user pain (rollback, failover, feature flag, scale)
  2. Preserve evidence
  3. One change at a time, announced
  4. Status on a clock, even when the status is “no new news”

After recovery:
  1. Fact timeline (not narrative)
  2. Contributing factors (plural)
  3. Owners and dates
```

Roles can be combined on a small team. They still need names spoken out loud:

| Role | Job |
|------|-----|
| Incident Commander | Priority, who may change what, when we update |
| Technical lead | Hands on the systems |
| Communications | Users and leadership |
| Scribe | Timestamped actions and findings |

If nobody is IC, everybody is IC, which means nobody is.

## Key Commands

Capture a snapshot *before* you restart, scale-to-zero, or delete a pod.

```bash
# Host identity and load
date -Is; hostname; uptime; who
free -h; df -hT; ip -br a
systemctl --failed

# Top consumers
ps aux --sort=-%cpu | head
ps aux --sort=-%mem | head

# Logs around impact start — copy off box if you can
journalctl -b -p err --no-pager | tail -n 200
journalctl -u <service> --since "2 hours ago" --no-pager \
  > /tmp/${HOSTNAME}-$(date +%H%M)-service.log

# If the symptom is connectivity
ss -lntup
curl -sv --max-time 5 https://127.0.0.1:<port>/health || true

# Kubernetes slice
kubectl get nodes -o wide
kubectl get pods -A -o wide | grep -Ev 'Running|Completed'
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous --tail=200

# Running timeline (crude is fine)
printf '%s %s\n' "$(date -Is)" "declared Sev-X: <one-line symptom>" \
  >> /tmp/incident-timeline.txt
```

## Common Failure Modes & Symptoms

| What you see | Likely cause | First correction |
|--------------|--------------|------------------|
| Five people applying fixes | No IC / no change queue | Stop. Name an IC. Serialize. |
| “Fixed” with no idea how | Restart was step one | Pull pre-bounce logs; treat as mitigation only |
| Leadership learns from Twitter | Late or no comms | Cadence: “next update at T+N” |
| Same page next month | No owned actions | Postmortem with dates, not vibes |
| Evidence gone | Log wrap, pod deleted, disk wiped | Capture first; only then remediate |
| Severity thrash | Impact never defined | Users × duration × data risk |
| Debug on the last healthy node | No capacity thought | Drain or scale; then debug |
| Heroics instead of a 10-line runbook | Knowledge stayed in one head | Write it before the review ends |

## Investigation Tips

- Declare early. Downgrade is cheap. The lost first hour is not.
- One sentence: *who* is affected, *what* fails, *since when*. Put it at the top of the channel topic.
- Separate mitigate from root-cause. Rollback / failover / flag first if that restores users.
- One hypothesis, one change, one expected signal. Announce it before you hit enter.
- Keep the ugly timeline. Timestamps plus commands beat memory.
- Verify the *user* path after recovery. `systemctl is-active` has lied to every team I have been on.
- Schedule the review while the night is still in working memory. Use `99 - Templates/Incident Postmortem Template.md`.
- Page hygiene matters: if the alert cannot name a runbook, the incident started in [[Alert Design]].

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

- The incident that taught me to declare early was “we’ll know in ten minutes.” Forty minutes later half the company was in the channel with no IC and three competing restarts. Ten seconds of “this is a Sev-2, I am IC” would have been cheaper than the restart lottery.
- I used to skip the scribe role on small pages. Then we could not answer “what did we change at 03:14?” The timeline file in `/tmp` is not glamorous. It is how you write the RCA.
- Mitigate first felt like cheating until a feature flag restored checkout in four minutes and the actual bug took two days. Users do not award points for elegance during an outage.
