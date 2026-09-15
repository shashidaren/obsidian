# Capacity Planning

## Concept

Capacity planning is measuring demand against known ceilings, watching the *rate* at which you approach those ceilings, and buying or reclaiming headroom *before* queueing turns into an incident.

It is not “make the graphs look empty.” It is “know how many days of runway you have at peak, including the failure of one replica, including the lead time to get more.”

CLI tools give you a point-in-time truth check. Trends live in the metrics system. Both are required.

## Why it matters

- CPU, RAM, disk, IOPS, NICs, FDs, DB connections, LB backends, and cloud quotas all have hard stops. The kernel will not negotiate.
- Lead time is the hidden variable. A disk that fills in 11 days with a 14-day procurement cycle is already an incident, just scheduled.
- Average utilisation lies. A fleet at 55% average and 94% at the weekly peak has no spare for a node loss.
- Cost and reliability trade. Blind over-provisioning hides leaks; chronic under-provisioning trains the org to live in SEV-2.
- Autoscaling is capacity planning with a robot. If the robot is slower than the spike, you still needed static headroom.

## Mental Model

```
Demand → utilisation → saturation → queues / errors / retries → worse demand

utilisation = current / limit          (per resource, per failure domain)
runway      = remaining / growth_rate  (use peak growth, not mean)
N+1 test    = same demand on N-1 members

Plan for, separately:
  organic growth
  seasonal / launch peaks
  retry storms (errors create demand)
  one replica / one AZ gone
  lead time to add capacity
```

A system at 70% daily average, 95% Friday peak, 14-day node lead time is late. Act on runway, not on “it has not broken yet.”

Hard limits worth listing in one inventory:

- Host: cores, RAM, disk inodes and bytes, NIC, `fs.file-max`
- Process: `ulimit -n`, app pool size, JVM heap
- Data plane: DB `max_connections`, Redis clients, LB backend slots
- Control plane: API rate limits, cloud vCPU / IP / disk quotas, certificate SANs

## Key Commands

```bash
# Snapshot (validate what dashboards claim)
uptime
nproc
free -h
df -hT
df -i
ss -s
cat /proc/sys/fs/file-nr

# sysstat history if it exists — this is the poor-man trend
sar -u 1 5
sar -r 1 5
sar -d 1 5
sar -n DEV 1 5
sar -q               # run queue / load

# Who is actually consuming
top -b -n 1 -o %CPU | head -25
pidstat -urd 1 3

# cgroup ceilings (containers / systemd slices)
cat /sys/fs/cgroup/cpu.max 2>/dev/null
cat /sys/fs/cgroup/memory.max 2>/dev/null
systemctl show <unit> -p CPUQuota -p MemoryMax -p TasksMax

# Connection / listen pressure
ss -lntup
ss -tan state syn-recv | wc -l

# Growth of a filesystem (compare to last week’s ticket paste)
df -B1 /var | tail -1
```

Long-term answers come from Prometheus/CloudWatch/etc.: p95 and max over 30/90 days, not a single `top`.

## Common Failure Modes & Symptoms

| Symptom | Likely capacity issue | First checks |
|---------|----------------------|--------------|
| Latency climbs, CPU high | CPU saturation or throttle | `top` + `1` for per-CPU; cgroup `cpu.stat` throttled |
| OOM / swap `si/so` | RAM undersized or leak | `free`, RSS over days, OOM in journal |
| High `%wa`, write stalls | IOPS / throughput ceiling | `iostat -xz 1`, volume IOPS limit |
| `too many open files` / refused | FD or accept queue | `ss -s`, ulimits, somaxconn |
| Cannot launch instances | Quota, IP space, or SKU | Cloud quota page, subnet free IPs |
| One replica dies, the rest melt | No N+1 | Model peak / (N-1) |
| Spike outage despite autoscale | Cold start / scale lag | Autoscale history vs spike duration |
| Disk “fine” last month, full now | Growth or a leak (logs, core dumps) | `du` offenders vs `df` trend |
| Next layer dies after you scale this one | You moved the bottleneck | Re-measure the whole path |

## Investigation Tips

- Always record *peak* and *N+1*, not only 24h average.
- Alert on runway (“full in < 14 days at current peak growth”), not only on 90% used. 90% of a 20 TB volume is a different emergency than 90% of 8 GB.
- Separate “we got popular” from “we leak.” A leak you buy RAM for will be back in a quarter.
- After adding capacity, verify the bottleneck moved. Scaling web nodes into a saturated DB makes things worse.
- Include non-host limits in the same review: cert expiry batch, NAT ports, API rate limits, license seats.
- Review capacity after every saturation incident and before every launch. That is the whole process.
- In cloud, reserved + burst is not the same as dedicated IOPS. Burst credits empty at the worst time.

## Related Notes

- [[High Availability]]
- [[Performance Investigation Framework]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[High CPU Runbook]]
- [[Change Management]]
- [[Incident Management]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We once “had 40% CPU headroom” on a 12-node pool. Losing one AZ took four nodes. Friday peak on eight nodes was 96%. The outage was a maths problem we refused to write down.
- Disk-full-in-N-days is the only disk alert I still trust. Percent-used on mixed volume sizes pages you late on the small volumes and nags you early on the large ones.
- The cheapest capacity I ever added was deleting 800 GB of rotated logs that `copytruncate` had abandoned. Measure waste before you buy.
