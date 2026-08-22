# Capacity Planning

## Concept

Capacity planning is the continuous process of measuring demand, understanding saturation points, and ensuring enough headroom exists (or can be added in time) so that growth or spikes do not turn into outages.

## Why it matters

- Resources do not scale infinitely; CPU, memory, disk, network, connection limits, and cloud quotas all have ceilings
- Waiting until saturation to react produces emergencies and poor purchasing decisions
- Lead time for hardware, quota increases, or architectural changes is often weeks; planning must account for that
- Cost and reliability trade off; over-provisioning hides problems, under-provisioning causes incidents

Capacity work is cheaper than firefighting, but only if trends are visible early.

## Mental Model

```
Demand  →  utilisation  →  saturation  →  queueing / errors

Watch:
  - Absolute usage (cores, GB, IOPS, connections)
  - Rate of growth
  - Headroom to known limits
  - Time to provision more capacity

Useful ratios:
  utilisation = current / limit
  days of runway = remaining headroom / daily growth

Plan for:
  organic growth, seasonal peaks, launch events, failure of one replica (N+1)
```

A system at 70% average with a weekly peak of 95% and a 14-day lead time for new nodes is already late.

## Key Commands

```bash
# Current resource snapshot
uptime
free -h
df -h
nproc

# Trends (if sysstat / sar available)
sar -u 1 5          # CPU
sar -r 1 5          # memory
sar -d 1 5          # disk
sar -n DEV 1 5      # network

# Process-level consumers
top -b -n 1 -o %CPU | head -20
pidstat 1 5

# Connection / file descriptor pressure
ss -s
cat /proc/sys/fs/file-nr
ulimit -n

# Container / cgroup limits (when relevant)
cat /sys/fs/cgroup/cpu.max 2>/dev/null
cat /sys/fs/cgroup/memory.max 2>/dev/null

# Cloud quotas (tool-specific)
# aws service-quotas ..., gcloud compute regions describe, etc.
```

Long-term trends belong in metrics systems (Prometheus, CloudWatch, etc.); CLI tools are for point-in-time and validation.

## Common Failure Modes & Symptoms

| Symptom                                      | Likely capacity issue                             | First checks                                      |
|----------------------------------------------|---------------------------------------------------|---------------------------------------------------|
| Latency climbs under load, CPU high          | CPU saturation                                    | `top`, load average vs core count                 |
| OOM kills, swapping                          | Memory undersized or leak                         | `free`, OOM logs, growth of RSS                   |
| High iowait, slow writes                     | Disk IOPS/throughput ceiling                      | `iostat`, queue depth, device limits              |
| “Too many open files” / connection refused   | FD or connection limit                            | `ss -s`, ulimits, app pool size                   |
| New instances cannot launch                  | Cloud quota or IP space exhausted                 | Quota dashboards, subnet free IPs                 |
| One replica fails and the rest fall over     | No N+1 headroom                                   | Utilisation with one member removed               |
| Sudden traffic spike causes outage           | No burst capacity or autoscaling lag              | Peak vs provisioned; autoscaler history           |

## Investigation Tips

- Track both average and peak. Decisions based only on averages fail at the worst time.
- Include the “one less” scenario: if a node or AZ disappears, do the remainder stay under safe utilisation?
- Set alerting on runway (e.g. “disk full in < 14 days at current growth”) not only on hard thresholds.
- Separate organic growth from leaks or inefficiency; fixing a leak is often cheaper than buying more RAM.
- Document known hard limits (DB max connections, LB backend limits, API rate limits) in one place.
- When adding capacity, verify the bottleneck actually moved; sometimes the next layer saturates immediately.
- Review capacity after major incidents and before large launches or marketing events.

## Related Notes

- [[High Availability]]
- [[Performance Investigation Framework]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[High CPU Runbook]]
- [[Change Management]]
- [[Incident Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
