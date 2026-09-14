# Performance Investigation Framework

## Concept

A performance incident is “someone is waiting”. The job is to name the resource they are waiting on — CPU, memory reclaim, disk, network, a lock, a thread pool, a downstream — and prove it with utilization, saturation, and errors (USE), not with the first graph that is red.

This note is the spine. Runbooks are the limbs. Do not skip the spine because a dashboard already shouted “CPU”.

## Why it matters

- Jumping to a restart burns the evidence and often “fixes” a symptom for one cycle of the underlying leak.
- Utilization without saturation is capacity headroom, not a bottleneck. A disk at 40% throughput with 50 ms `await` is already saturating IOPS.
- Host metrics without application queues send you to the wrong layer. The box can be idle while the app’s work queue is 10,000 deep.
- A 15-minute ritual that always produces the same artifacts makes the next person faster than your memory of this incident.

## Mental Model

```
1. Symptom     what is slow / who feels it / since when / what changed
2. Snapshot    date, uptime, USE across CPU/mem/disk/net/app  (do not change anything yet)
3. Locate      which resource is saturated or erroring
4. Identify    which task / device / peer / pool
5. Hypothesis  one cause, one test
6. Act         smallest reversible change
7. Verify      symptom gone AND saturation/errors down AND nothing new on fire

USE per resource
  Utilization  busy fraction
  Saturation   queue length / wait / throttle / swap
  Errors       retries, resets, alloc failures, 5xx
```

If utilization is high and saturation is not, you may just be efficiently busy. If saturation is high and utilization is modest, you are waiting (locks, I/O, remote, quota).

## Key Commands

Baseline *before* you touch a service. Paste this block into the ticket.

```bash
date --iso-8601=seconds; hostnamectl | grep -E 'hostname|System|Kernel'
uptime; nproc
free -h
df -hT; df -i
vmstat 1 5
mpstat -P ALL 1 3
iostat -xz 1 3
ss -s; ip -s link
ps -eo pid,ppid,user,stat,nlwp,pcpu,pmem,rss,wchan:16,comm --sort=-pcpu | head -15
ps -eo pid,user,rss,comm --sort=-rss | head -15
```

Then only the tools that match the layer you actually suspected:

```bash
# CPU / runqueue
top -b -n 3 -d 1 -o %CPU | head -50
pidstat -w -t 1 5

# Memory / reclaim
awk '/MemAvailable|Dirty|Swap/ {print}' /proc/meminfo
dmesg -T | grep -i oom | tail

# Disk
iostat -xz 1 5
lsblk -d -o NAME,ROTA,SCHED

# Network
ss -tnp state established
nstat -az | grep -E 'Retrans|Drop|Listen'

# App / unit
systemctl status <unit> --no-pager -l
journalctl -u <unit> -S -15m --no-pager
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| High load, high `%us+%sy` | CPU bound | [[High CPU Runbook]], `top -H` |
| High load, high `%id` | Waiters (I/O, D-state, remote) | [[High Load Low CPU]], `vmstat b` |
| MemAvailable down, si/so > 0 | Memory pressure | [[Memory Pressure Runbook]] |
| `%util` ~100 or `await` high | Storage saturation | [[iostat Deep Dive]], [[Disk I/O and Latency]] |
| Retransmits / listen overflows | Net or accept queue | [[ss Deep Dive]], [[TCP IP Troubleshooting Model]] |
| Host idle, app p99 high | Pool, lock, downstream, quota | app metrics, `cpu.stat` throttle |
| Everything “high” after a deploy | Change first, not capacity | [[Change Management]] |
| Symptom gone after restart, no cause | You reset state; leak will return | capture heap/queue *before* next restart |

## Investigation Tips

- Write the symptom in one sentence with a timestamp and a blast radius before you open `top`. “API p99 2s since 07:12, only checkout, after cache flush” is a plan. “Site is slow” is a mood.
- Compare 1m / 5m / 15m load and a graph with a *before* window. A flat-high 15m after a resolved blip is not a reason to reboot.
- One change at a time. Parallel “just in case” restarts destroy causality.
- Prefer a healthy peer host as control. Same AMI, different symptom → data plane or neighbour, not “Linux is broken”.
- In guests, `%st` and the hypervisor’s view beat any in-guest tuning. In containers, cgroup max beats node idle.
- If you cannot name the *queue* that is growing, you do not have a bottleneck yet. Keep measuring.

## Related Notes

- [[Troubleshooting Methodology]]
- [[High CPU Runbook]]
- [[High Load Low CPU]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[CPU Scheduling and Load Average]]
- [[Memory Management]]
- [[top Deep Dive]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[Root Cause Analysis]]

## Personal Lessons Learned

- The fastest I ever closed a Sev-1 was a pasted baseline block that showed `%st` at 40%. We stopped blaming the JVM in the first five minutes.
- The slowest was a restart that “fixed” checkout for 40 minutes. The leak came back at the same RSS slope. The missing artefact was a heap dump *before* the restart.
- I now treat “the dashboard says CPU” as a rumour. USE on all four host resources plus the app pool almost always moves the story one layer.
