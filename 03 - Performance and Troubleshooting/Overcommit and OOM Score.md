# Overcommit and OOM Score

## Concept

Linux allows processes to allocate more virtual memory than physical RAM + swap (overcommit). `vm.overcommit_memory` controls the policy. When the kernel cannot fulfill a real page fault it invokes the OOM killer, which scores processes by size, niceness, and `oom_score_adj`.

Overcommit is why a host can show free RAM while `Committed_AS` is already near the limit, and why a large allocation can succeed until the pages are touched.

## Why it matters

- Databases and JVMs often allocate large virtual spaces; heuristic overcommit lets them start, then kills them under load.
- Setting `overcommit_memory=2` (never overcommit) changes OOM from “random victim” to “allocation fails with ENOMEM” — better for some workloads, fatal for others.
- `oom_score_adj` is how you protect sshd, the monitoring agent, or a critical database from being the first kill target.
- Container `memory.oom.group` and Kubernetes eviction interact with the same scoring.

## Mental Model

```
malloc / mmap (virtual)
    → overcommit check (policy 0/1/2)
        → success (pages not yet backed)
            → later page fault
                → reclaim or OOM killer

oom_score = (rss + swap) * factor + oom_score_adj
Higher score → more likely victim
oom_score_adj -1000 = never kill; +1000 = always prefer
```

Policy:
- 0 heuristic (default)
- 1 always overcommit
- 2 strict (CommitLimit)

## Key Commands

```bash
# Current policy and limits
sysctl vm.overcommit_memory vm.overcommit_ratio
grep -E 'Commit|Overcommit' /proc/meminfo

# Per-process score
cat /proc/PID/oom_score /proc/PID/oom_score_adj
# or
awk '{print $1,$2}' /proc/*/oom_score_adj 2>/dev/null | sort -k2 -n

# Protect a process (example)
echo -1000 > /proc/PID/oom_score_adj
# or in unit: OOMScoreAdjust=-1000

# Recent OOM decisions
dmesg -T | grep -A 30 'oom-killer'
journalctl -k -b | grep -A 20 'Killed process'
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Process killed despite free RAM | Overcommit + late fault | `Committed_AS`, dmesg OOM |
| `Cannot allocate memory` on malloc | overcommit_memory=2 | sysctl, CommitLimit |
| sshd or agent killed first | Default score, no adj | `/proc/sshd/oom_score_adj` |
| Container dies, host fine | cgroup memory limit | memory.current, OOMScoreAdjust |
| Large JVM starts then dies under load | Heap larger than realistic RAM | overcommit policy, RSS graph |

## Investigation Tips

- Compare `Committed_AS` to `CommitLimit` before blaming a leak. A sudden jump often means a new large allocation, not gradual growth.
- `oom_score_adj` of -1000 is common for sshd and systemd itself; do not remove it casually.
- In Kubernetes, set `oom_score_adj` via the downward API or a mutating webhook if you need to protect sidecars relative to the main container.
- Policy 2 is useful for some real-time or database setups that prefer fail-fast; test it on a staging host first — many applications assume overcommit.

## Related Notes

- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[Memory Pressure Runbook]]
- [[sysctl and Resource Limits]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A PostgreSQL host with `overcommit_memory=0` survived a traffic spike by killing the largest connection process instead of the postmaster. After we set `OOMScoreAdjust=-500` on the database unit and raised shared_buffers carefully, the next spike produced connection errors instead of a full outage.
- Strict overcommit (mode 2) on a build server made every large `git clone` fail with ENOMEM even though free RAM was high. We reverted to heuristic and added cgroup limits instead.
