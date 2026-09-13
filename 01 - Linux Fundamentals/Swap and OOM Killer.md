# Swap and OOM Killer

## Concept

Swap is block storage the kernel uses as a backing store for anonymous pages when RAM is tight. It is not “extra RAM”. Every page that goes to swap comes back through the disk path later, with disk latency.

The OOM killer is the kernel’s last resort when reclaim cannot produce enough memory for an allocation that cannot fail. It picks a victim, kills it with `SIGKILL`, and hopes the system can continue.

These are two stages of the same pressure curve, not separate mysteries.

## Why it matters

- Heavy `si`/`so` turns a slightly overcommitted host into a latency disaster long before OOM fires
- OOM is abrupt: no shutdown hooks, no clean flush, just a dead process and a kernel log
- Containers and cgroups have their own OOM path. The host can look healthy while a pod is being murdered every few minutes
- “Add more swap” without finding the growth source buys time and then a worse outage

If users say the box is “stuck” and CPU is idle, check swap activity before you reboot.

## Mental Model

```
Allocation request
    → reclaim page cache / slab
    → swap anonymous pages out   (vmstat so)
    → if reclaim cannot meet the request
         → OOM in that domain (host or cgroup)
         → pick victim by oom_score + oom_score_adj
         → SIGKILL, dump a report to dmesg
```

Useful knobs and facts:

- `MemAvailable` falling + `si`/`so` rising = real pressure. High cache + low free is not.
- `vm.swappiness` (default 60) biases how eagerly the kernel steals anonymous pages versus cache. Lower values keep apps in RAM longer; they do not disable swap.
- `oom_score` is computed; `oom_score_adj` (−1000..1000) is the operator override. `-1000` makes a process almost unkillable. Use that sparingly (sshd, the failover agent), never on the leak itself.
- systemd `OOMScoreAdjust=` and `MemoryMax=` are how you express this for services.
- A cgroup with `memory.max` set will OOM *inside the cgroup* even if the host has free RAM.

Swap on a busy SSD can hide a leak for days. Swap on a contended SAN disk takes the whole node with it.

## Key Commands

```bash
# Is swap even there, and is it being used?
free -h
swapon --show
cat /proc/swaps
cat /proc/meminfo | grep -E 'Swap|MemAvailable|AnonPages|Dirty'

# Activity, not just occupancy. si/so per second is the signal.
vmstat 1 10
# si = pages swapped in, so = pages swapped out

# Who holds anonymous memory?
ps -eo pid,user,rss,vsz,cmd --sort=-rss | head -20
grep -E 'VmRSS|VmSwap|Name' /proc/<PID>/status

# Per-process swap usage (bytes)
for p in /proc/[0-9]*; do
  awk -v p="$p" '/VmSwap/{s=$2} /Name/{n=$2} END{if(s+0>0) printf "%8d kB  %s  %s\n", s, n, p}' "$p/status" 2>/dev/null
done | sort -nr | head

# OOM history
dmesg -T | grep -iE 'out of memory|oom-killer|killed process|Memory cgroup'
journalctl -k --since '7 days ago' | grep -iE 'oom|out of memory|killed process'

# Current scores (higher = more attractive victim)
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  score=$(cat "$p/oom_score" 2>/dev/null) || continue
  adj=$(cat "$p/oom_score_adj" 2>/dev/null)
  comm=$(cat "$p/comm" 2>/dev/null)
  printf '%6s %6s %s %s\n' "$score" "$adj" "$pid" "$comm"
done | sort -nr | head -20

# Cgroup memory (v2)
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events        # oom, oom_kill counters
find /sys/fs/cgroup -name memory.events -exec grep -l 'oom_kill [1-9]' {} +

# Protect or expose a systemd service
# /etc/systemd/system/foo.service.d/oom.conf
# [Service]
# OOMScoreAdjust=-500
# MemoryMax=4G
```

Read the **full** OOM report, not just the “Killed process” line. It lists the memory breakdown and the top consumers at the moment of death.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Load high, `%wa` high, CPU idle | Thrashing: working set does not fit | `vmstat` `si`/`so`, `free -h` |
| Process vanished, restart loop | OOM; supervisor brought it back | `dmesg -T`, unit `Restart=` |
| Same service killed repeatedly | Leak or `MemoryMax` too tight | RSS over time, cgroup `memory.events` |
| Host fine, one container dying | Cgroup OOM, not host OOM | `memory.max` vs `memory.current` inside the slice |
| Swap full, then OOM anyway | Swap too small *and* leak | `swapon --show`, growth of `AnonPages` |
| Critical PID killed, leak survives | Default scoring picked the fat but important process | `oom_score_adj` on sshd / etcd / db |
| “We disabled swap” and latency cliffs | No reclaim cushion; OOM is now the first symptom | Revisit whether a small swap is actually the enemy |

## Investigation Tips

- Occupied swap (`free` showing used swap) can be leftover from an earlier spike. **Rate** (`si`/`so`) tells you if you are thrashing *now*.
- Graph RSS of the top processes. A sawtooth that climbs across restarts is a leak; a flat high RSS is undersizing.
- In the OOM dump, find `oom_memcg` / `memory: usage` lines. If the kill was memcg-scoped, adding host RAM will not help.
- Do not set every important service to `oom_score_adj=-1000`. If nothing is killable, the kernel may panic or lock up instead.
- `echo 3 > /proc/sys/vm/drop_caches` is not a memory-pressure fix. It only throws away cache; it does not shrink anonymous memory.
- After an OOM, check whether the killed process left a core, a supervisor restart, or a half-written file. The user-visible failure is often the *next* process that needed the victim.
- On databases, swapping the buffer pool is usually worse than refusing a few connections. Prefer cgroup limits and connection caps over huge swap.

## Related Notes

- [[Memory Management]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[Capacity Planning]]
- [[Resource Requests and Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random” API restart every night was cgroup OOM from a batch job scheduled into the same slice. Host `free -h` never looked bad. `memory.events` on the slice had a non-zero `oom_kill` and ended the debate.
- We added 32 GiB of swap to a VM that was leaking 1 GiB/hour. The host stayed up, and every request picked up 20–50 ms of disk latency until someone read `vmstat`. Killing the leak was the fix; the swap just hid the page-in cost.
- Leaving `sshd` at default score on a memory-starved bastion meant the OOM killer dropped the only way in. A modest negative `OOMScoreAdjust` on sshd and the node exporter, and a tight `MemoryMax` on the actual offender, is the right shape.
