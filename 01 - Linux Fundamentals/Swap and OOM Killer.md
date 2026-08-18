# Swap and OOM Killer

## Concept

**Swap** is disk space used as an extension of RAM. When the kernel needs more memory than is currently free + reclaimable, it can move anonymous pages to swap.

The **OOM Killer** (Out-Of-Memory Killer) is the kernel’s last resort: when it cannot free enough memory, it chooses a process to kill in order to keep the system running.

## Why it matters

- Heavy swapping causes severe latency (disk is orders of magnitude slower than RAM).
- OOM kills are abrupt and can take down critical services.
- Both are symptoms of memory pressure — treating only the symptom (adding swap or restarting) without finding the cause leads to repeated incidents.

## Mental Model

1. Application needs memory → kernel tries to reclaim cache / unused pages.
2. If still not enough → kernel starts swapping anonymous pages.
3. If swapping is not enough or too slow → OOM killer is invoked.
4. OOM killer scores processes (based on memory usage, niceness, oom_score_adj, etc.) and kills the chosen one.

## Key Commands

```bash
# Swap usage
free -h
swapon --show
cat /proc/swaps

# Swap activity (si = swap in, so = swap out)
vmstat 1 5

# OOM events
dmesg -T | grep -iE 'out of memory|oom-killer|killed process'
journalctl -k | grep -iE 'oom|out of memory'

# Current OOM scores (higher = more likely to be killed)
for p in /proc/[0-9]*; do
  echo "$(cat $p/oom_score 2>/dev/null) $(cat $p/oom_score_adj 2>/dev/null) $(cat $p/comm 2>/dev/null)"
done 2>/dev/null | sort -nr | head -15
```

## Common Failure Modes & Symptoms

| Symptom                         | Likely cause                       | First checks                    |
|---------------------------------|------------------------------------|---------------------------------|
| System very slow, high iowait   | Heavy swapping                     | `vmstat`, `free -h`             |
| Process suddenly disappears     | OOM killer                         | `dmesg`, journal                |
| Swap almost full                | Sustained memory pressure          | Top memory consumers            |
| Repeated OOM of same service    | Memory leak or undersized limits   | Process growth over time        |

## Investigation Tips

- After an OOM event, always read the full oom-killer report in `dmesg` — it shows the memory state and the chosen victim.
- `oom_score_adj` can be used to protect critical processes (e.g. -1000) or make others more killable.
- In containers, the OOM killer can act inside the cgroup even when the host still has memory.

## Related Notes

- [[Memory Management]]
- [[Memory Pressure Runbook]]
- [[vmstat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
