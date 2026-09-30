# Documentation and Runbooks

## Concept

Operational documentation is the interface between the system and the next human who has to fix it under time pressure. A runbook is a tested procedure: symptoms, checks, commands, expected output, decision points, and rollback. Design docs and wiki archaeology are not runbooks.

If a procedure cannot be executed by a teammate who did not write it, it is not documented yet.

## Why it matters

- During an incident, memory and Slack folklore do not scale
- On-call quality is mostly "can a competent stranger follow this page?"
- Automation without a written expected state becomes un-debuggable automation
- Stale runbooks are actively dangerous: they send people to the wrong host with the wrong command
- Good docs shorten MTTR and make post-incident work visible instead of heroic
- Alerts without a linked runbook train people to ignore alerts

## Mental Model

```
Four layers that get mixed up:

  Architecture notes  → how it is supposed to work
  Inventory / source  → what is actually deployed (IaC, CMDB, tags)
  Runbooks            → what to do when a symptom appears
  Postmortems         → what we learned and which runbook to change

A runbook page should answer, in order:
  1. What does this alert / symptom mean?
  2. How bad is it (user impact, blast radius)?
  3. What do I look at first?
  4. What are the safe next actions, with rollback?
  5. How do I know it is fixed?
  6. Who owns this if I am stuck?
```

Store runbooks next to the service (repo or wiki with an owner), link them from the alert, and treat a failed runbook step as a defect.

Two pages that should never be merged:

- *Symptom runbook* — "checkout 5xx": short, executable tonight
- *System overview* — topology, dependencies, data stores: link out, do not paste in

## Key Commands

Documentation is not a CLI, but every runbook should contain *copy-pasteable* commands with placeholders and expected output.

```bash
# Identity of this host / unit
hostnamectl; date -Is; uptime
systemctl status <service> --no-pager
journalctl -u <service> -n 100 --no-pager

# Dependency health (edit per service)
curl -fsS --max-time 5 http://127.0.0.1:<port>/health
ss -lntp | grep <port>

# Evidence pack *before* destructive steps
journalctl -u <service> --since "30 min ago" > /tmp/<service>-$(date +%Y%m%dT%H%M).log
# systemctl show <service> --no-pager >> /tmp/<service>-$(date +%Y%m%dT%H%M).meta

# Prefer reload; restart only when the runbook says so
# systemctl reload <service>
# systemctl restart <service>
```

Maintenance of the docs themselves:

```bash
# Name the source of truth on the page
git log -n 5 -- docs/runbooks/<service>.md
# Last time this page moved is a freshness signal
```

Skeleton every symptom page should share (see `99 - Templates/Runbook Template.md`):

1. Alert name / exact wording
2. Impact and severity guess
3. Preconditions (access, cluster, namespace)
4. Diagnose (commands + expected output)
5. Mitigate (ordered, with blast radius)
6. Rollback
7. Done when
8. Escalate to

If the commands need "you just have to know" flags, the page is unfinished.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| On-call ignores the wiki | Page is a novel, not a procedure | Rewrite to symptom → checks → action |
| Two conflicting runbooks | Copy-paste drift, no owner | Single canonical link from the alert |
| Commands fail as written | Hostnames, paths, versions changed | Execute the page on a staging twin |
| "Just restart it" is the whole doc | No diagnosis path | Add evidence steps and when *not* to restart |
| Alert has no link | Tooling gap | Alert body must include runbook URL |
| Docs updated, production not | Docs not in the change checklist | [[Change Management]] requires a doc diff |
| Only the author can use it | Hidden context, private dashboards | Cold-read by another engineer |
| Page ranks above living systems | Retired service never deleted | Quarterly prune |
| Runbook works, restore does not | Procedure never timed | [[Restore Testing]] |

## Investigation Tips

- Write runbooks from the last three incidents, not from architecture diagrams.
- Prefer short pages per symptom (`High error rate on checkout`) over one encyclopaedia per product.
- Put expected output under each command (`you should see Active: active (running)`).
- Mark destructive steps explicitly. Separate "diagnose" from "mitigate".
- After every incident, the last action item is "update the runbook with what we actually did".
- Link dashboards, log queries, and the escalation path on the same page. Tab-hunting is not a procedure.
- Review quarterly: delete pages for retired systems; they outrank living ones in search.
- Version the page with the service. A runbook in a wiki that nobody PRs will rot next to a repo that ships weekly.
- Cold-run the page during a game day. The first person who has to ask Slack has found the missing sentence.

## Related Notes

- [[Incident Management]]
- [[Root Cause Analysis]]
- [[Change Management]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]
- [[Performance Investigation Framework]]
- [[Restore Testing]]
- Incident Postmortem Template
- Runbook Template

## Personal Lessons Learned

- The runbook that saved a night was one screen long, started with the exact alert name, and had a "do not restart until you have captured `--previous` logs" warning. The 20-page design doc was not opened.
- We once had three "restart nginx" pages. Two of them still pointed at a hostname decommissioned a year earlier. Search rank is not correctness; the alert link is.
- A game-day cold-read by a new hire found that every command assumed you were already in the right kubectl context. That one line at the top of the page has paid for itself repeatedly.
