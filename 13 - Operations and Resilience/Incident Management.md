# Incident Management

## Concept

Incident management is the process of detecting, responding to, recovering from, and learning from unplanned interruptions or degradations of service.

## Why it matters

Good technical skills alone are not enough during an incident.  
Clear roles, communication, and evidence handling determine how fast you recover and how much you learn.

## Mental Model – Simple Lifecycle

```
1. Detect
2. Triage / Declare
3. Investigate & Mitigate
4. Recover
5. Communicate
6. Post-incident review
```

## Roles (even in a small team)

| Role                  | Responsibility                              |
|-----------------------|---------------------------------------------|
| Incident Commander    | Overall coordination, decisions, priorities |
| Technical Lead        | Hands-on investigation and mitigation       |
| Communications        | Updates to stakeholders / users             |
| Scribe (optional)     | Timeline and actions log                    |

In very small teams one person may wear several of these hats — the important thing is to be explicit.

## Practical Guidelines During an Incident

1. **Declare early** – better to downgrade later than to lose time.
2. **Protect evidence** – capture logs, metrics, and state before restarting or deleting.
3. **One change at a time** – so you know what fixed (or broke) things.
4. **Keep a timeline** – even rough notes help the postmortem.
5. **Communicate status** – even if the update is “still investigating”.

## Useful Commands for the Technical Side

```bash
# Quick system snapshot
date; uptime; free -h; df -hT; systemctl --failed

# Capture relevant logs
journalctl -b -p err > /tmp/errors.txt
journalctl -u <service> --since "1 hour ago" > /tmp/service.log

# Kubernetes
kubectl get pods -A -o wide
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
```

## After the Incident

- Write a short postmortem (use the template in `99 - Templates`).
- Focus on contributing factors and concrete corrective actions, not blame.
- Track follow-up items to completion.

## Related Notes

- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]
- [[Root Cause Analysis]]
- [[Documentation and Runbooks]]
- Incident Postmortem Template

## Personal Lessons Learned

> 
