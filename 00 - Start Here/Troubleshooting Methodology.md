# Troubleshooting Methodology

## Concept

Troubleshooting is a disciplined loop: name the user-visible symptom, bound the scope, gather evidence *before* you change anything, test one hypothesis at a time, verify recovery the same way the user would see it, then write down what you learned.

Talent is useful. Sequence is what keeps you from thrashing a production box.

This note is the operating system for every other note in the vault. The command deep-dives tell you *what to look at*. This note tells you *in what order and why*.

## Why it matters

- “Server is slow” is a feeling, not a ticket. Without who / what / since when, you will measure the wrong layer.
- The first restart often restores service and deletes the only evidence of *why*.
- Scope errors are expensive: you patch one host while the real fault is DNS, a shared NFS export, or a cloud quota.
- Stakeholders forgive a slow diagnosis more than they forgive silent, conflicting changes.
- A written timeline is the difference between an incident and a story you cannot reconstruct next week.

If you skip observe-and-scope, every later command is entertainment.

## Mental Model

```
1. Symptom   — one sentence: who, what fails, since when
2. Scope     — one host, one AZ, one service, one client path?
3. Timeline  — first bad sample vs last change (deploy, cert, config, traffic)
4. Observe   — snapshot before you touch anything
5. Hypothesize — name the layer (CPU, mem, disk, net, app, identity, capacity)
6. Test      — one change or one probe, expected signal written down
7. Verify    — user-facing path, not only systemctl is-active
8. Prevent   — detection gap, runbook line, or capacity/change fix
```

Work from the outside in only when you must. Most outages announce themselves at a specific layer if you look at the right counters first.

A useful first split:

| If the complaint is… | Start here |
|----------------------|------------|
| Slow / timed out     | [[Performance Investigation Framework]] |
| Cannot connect       | [[Networking Command Workflow]] |
| Disk / write errors  | [[Disk Full Runbook]], [[Filesystems and Mounts]] |
| After a change       | [[Change Management]], rollback first |
| After a failover     | [[High Availability]] |
| Data missing         | [[Backup Strategy]], stop writing if corruption is possible |

## Key Commands

A baseline you can paste into the ticket *before* remediation. Adapt, do not skip.

```bash
# Identity of the moment
hostnamectl; date -Is; uptime; who

# Compute / memory / disk at a glance
free -h
df -hT
df -i
ps aux --sort=-%cpu | head
ps aux --sort=-%mem | head

# Units and recent errors
systemctl --failed
journalctl -b -p err --no-pager | tail -n 100

# Network path the kernel will actually use
ip -br link
ip -br addr
ip route get 1.1.1.1
ss -s
ss -lntup | head

# “What changed?” hints
journalctl --since "2 hours ago" -p warning --no-pager | tail
ls -lt /etc | head
# package / deploy logs are distro-specific; grab them if this host was patched
```

Then pick the layer-specific note. Do not run `tcpdump` or `fsck` because they feel thorough.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First correction |
|--------------|----------------|------------------|
| Vague ticket, everyone SSHing in | No symptom sentence, no commander | Write the sentence; serialize changes |
| Fix “worked”, root cause unknown | Restart was the first action | Next time snapshot first; compare logs pre/post |
| Healthy by `systemctl`, users still failing | You verified the wrong thing | Hit the same URL/query the user hits |
| One host “broken”, three more identical | Shared dependency (DNS, NFS, LB, DB, IAM) | Compare a healthy peer immediately |
| Counters look fine, latency terrible | You averaged away the hot core / tail | Per-CPU, p99, one-slow-request trace |
| Change made two things at once | Cannot tell which fixed or broke it | Revert to last known good, then one knob |
| Happens only after 02:00 | Batch job, logrotate, backup, cron | Timeline vs timers (`systemctl list-timers`) |
| Recurs next month | No owner on the follow-up | [[Incident Management]], [[Root Cause Analysis]] |

## Investigation Tips

- Write the symptom in the channel before you type a privileged command. It keeps the team honest.
- Compare. A single number without a healthy peer or a yesterday baseline is decoration.
- Prefer read-only probes until you have a hypothesis that a change would confirm.
- Preserve evidence: copy logs, `sosreport` / `supportconfig` if your shop uses them, `kubectl logs --previous` before deleting the pod.
- Time is a first-class field. `date -Is` on the host, not your laptop. Clock skew lies.
- If the box is the last healthy replica, do not debug *on* it under full traffic. Drain or scale first.
- “I restarted it” is a mitigation. Record it as such. It is not a root cause.
- Stop when the original symptom is gone *and* the dependency chain is quiet. Do not keep tuning.

## Related Notes

- [[Performance Investigation Framework]]
- [[Networking Command Workflow]]
- [[Incident Management]]
- [[Root Cause Analysis]]
- [[Change Management]]
- [[Alert Design]]
- [[Documentation and Runbooks]]
- [[Home]]

## Personal Lessons Learned

- The worst hour of my career started with “just bounce it so users are happy.” We were happy for twenty minutes. Then it bounced again, and the journal had already wrapped. Snapshot first is not pedantry.
- Scope is a superpower. Three “broken” app nodes were fine; the NFS server’s export had gone read-only. Comparing one healthy client would have saved the first forty minutes.
- A one-line symptom (“checkout POST p99 8s since 14:12, only region B, after cert reload”) is a better runbook than a page of theory. Force that sentence out loud.
