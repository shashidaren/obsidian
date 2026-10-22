# Capacity Signals

## Concept

Capacity signals are the early, quantitative warnings that a resource will be exhausted before it actually is. They are not the same as the hard failure (disk 100 %, OOM, connection refused). Good signals are leading, specific, and actionable.

## Why it matters

Most incidents are capacity incidents that were visible for hours or days. A page at 95 % disk is better than a page at 100 % with a full filesystem and a crashed database. The difference is whether you measured the slope, not just the level.

## Mental Model

```
level (current use) + slope (rate of change) = time-to-exhaustion

Alert on:
  - absolute threshold (disk > 85 %)
  - rate (inode use +10 % in 1 h)
  - time-to-full (projected < 24 h)

Not every high number is a signal. A backup that uses 40 % CPU for 20 minutes every night is not a capacity problem.
```

## Key Commands

```bash
# Disk growth rate (rough)
df -h /var
# compare to yesterday's df or use sar -F

# Memory pressure trend
sar -r 1 5
vmstat 1 5

# Connection table growth
ss -s
cat /proc/sys/net/netfilter/nf_conntrack_count

# File descriptor pressure
cat /proc/sys/fs/file-nr
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Disk alert fires every night | Backup or log rotation not accounted for | timing, `sar`, exclude the window |
| “Sudden” full disk | No rate alert, only 100 % | add 80/90 % and growth rate |
| Memory alert but no OOM | Cache counted as used | `free -h`, `sar -r`, exclude cache |
| Conntrack full with low traffic | Leak or scan | `conntrack -L`, nf_conntrack note |
| Alert fatigue | Threshold too sensitive or no slope | raise threshold, add rate |

## Investigation Tips

- Always ask “how fast is it growing?” before you declare an emergency. A disk at 92 % that grows 0.1 % per day is a ticket; 5 % per hour is an incident.
- Separate cache from used memory in every memory alert. Otherwise you page on healthy page cache.
- For disks, alert on both bytes and inodes. Running out of inodes looks like a full disk to many applications.
- Record the baseline. A host that has always run at 70 % CPU is not suddenly “high” at 75 %.
- After you add a signal, verify it would have fired on the last three real incidents and would not have fired on the last three non-incidents.

## Related Notes

- [[Capacity Planning]]
- [[Alert Design]]
- [[Disk Full Runbook]]
- [[Memory Pressure Runbook]]
- [[Incident Management]]

## Personal Lessons Learned

- We paged on disk > 90 % for months. The real failures were always inode exhaustion on `/var/lib/docker`. Adding an inode signal and a growth-rate signal eliminated the surprise full-disk pages.
- A memory alert that included cache woke people up every time a large file was copied. Changing the alert to `MemAvailable` ended the noise and still caught real pressure.
