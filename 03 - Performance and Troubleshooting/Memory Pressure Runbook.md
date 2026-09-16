# Memory Pressure Runbook

**Purpose**: Decide whether the box is actually out of reclaimable memory, whether it is swapping or already in OOM, and recover without destroying the evidence you need for the leak.

**When to use**: MemAvailable collapsing, swap activity, OOM killer events, services killed or stalling, PSI memory alerts.

See also [[Memory Management]] and [[Swap and OOM Killer]].

---

## Concept

Linux will happily use free RAM for page cache. "Used" in a naive graph is not pressure. Pressure is when *reclaim* cannot keep up: MemAvailable falls, PSI stalls rise, swap-in/out appear, then the OOM killer picks a victim.

## Why it matters

- OOM kills the largest eligible process, which is often the database you needed for forensics
- Dropping caches or adding swap can hide a leak for one more night
- Container and cgroup limits OOM a *workload* while the host still looks fine — or the reverse

## Mental Model

```
Allocations + cache
        → reclaim (cache, then anon via swap)
                → stall (PSI / swap storm)
                        → OOM killer

Questions, in order:
1. Is MemAvailable actually low, or is this cache?
2. Is the consumer userspace RSS, slab, or a cgroup limit?
3. Has OOM already fired, and which PID was the victim vs the hog?
4. Is this a leak (monotonic RSS) or a burst (traffic, query, backup)?
```

`MemAvailable` is the headline number. `MemFree` is not.

---

## 1. Quick Triage (30–60 seconds)

```bash
free -h
awk '/MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|Dirty|SReclaimable|AnonPages|Slab/ {print}' /proc/meminfo
ps -eo pid,user,rss,vsz,cmd --sort=-rss | head -15
dmesg -T | grep -iE 'out of memory|oom-killer|killed process' | tail -20
journalctl -k -b | grep -iE 'out of memory|oom' | tail -10
cat /proc/pressure/memory 2>/dev/null
```

**Key questions**:

- Is `MemAvailable` low *and* cache already small?
- Are `si`/`so` moving in `vmstat`?
- Did OOM already run? Victim != necessarily the hog.
- Host pressure or one cgroup / container?

---

## 2. Distinguish common patterns

| Pattern | What you see | First focus |
|---------|--------------|-------------|
| True exhaustion | MemAvailable tiny, cache already reclaimed | Largest RSS / leak |
| Healthy cache | High Cached, MemAvailable still OK | Usually not an incident |
| Swap storm | High `si`/`so`, iowait, latency | Memory + disk; app is thrashing |
| OOM already fired | dmesg oom-killer report | Victim, total-vm, cgroup |
| Slab / kernel | Userspace RSS modest, Slab huge | `slabtop`, directory cache, modules |
| cgroup OOM | Host fine, one unit/pod dying | `MemoryMax`, pod limits |
| Leak | One RSS climbs over hours/days | That process, graphs |

---

## 3. Investigation Steps

### 3.1 Who holds the pages?

```bash
ps -eo pid,user,rss,vsz,cmd --sort=-rss | head -20
pidstat -r 1 5
# smem / pmap if installed
pmap -x <PID> | tail
```

RSS is anonymous + mapped file pages. VSZ is almost useless for pressure.

### 3.2 Swap and PSI

```bash
vmstat 1 5          # si / so / wa
swapon --show
cat /proc/pressure/memory
```

Some PSI (`some`) means at least one task stalled. Full (`full`) means the whole cgroup made no progress — that is an outage in progress.

### 3.3 OOM report

```bash
dmesg -T | grep -A 40 -i 'invoked oom-killer'
journalctl -k -b | grep -A 40 -i 'oom-killer'
```

Read: invoking cgroup, `total_vm` vs `rss`, which process was *chosen*, and whether it was `oom_score_adj` protected.

### 3.4 Kernel / slab (when userspace does not explain it)

```bash
slabtop -o | head -25
awk '/Slab|SReclaimable|SUnreclaim|VmallocUsed/ {print}' /proc/meminfo
```

---

## 4. Safe Remediation (ordered by safety)

### Immediate safe actions

1. Capture `free`, top RSS, OOM snippet, and unit name **before** you restart anything.
2. Stop or restart the obvious leaking *non-data* service:
   ```bash
   systemctl restart <service>
   kill -TERM <PID>
   ```
3. Shed batch work: disable the backup, lower worker counts, drain a queue.
4. Drop caches only if you understand you are buying minutes, not fixing a leak:
   ```bash
   sync
   echo 3 > /proc/sys/vm/drop_caches
   ```

### Higher-risk

- Adding swap on a dying box — can turn OOM into a multi-hour thrash
- `kill -9` on a database or broker
- Reboot — last resort; you lose `/proc` and often the useful OOM context if journal is volatile

Do not "free memory" by unmounting the data filesystem or killing sshd.

---

## 5. Verification

```bash
free -h
ps -eo pid,user,rss,cmd --sort=-rss | head -10
vmstat 1 3
cat /proc/pressure/memory 2>/dev/null
dmesg -T | tail -20
```

**Success**: MemAvailable recovered *and stays recovered*, swap activity near zero, no new OOM lines, application healthy.

---

## 6. Prevention & Follow-up

- Alert on MemAvailable, PSI `full`, swap *rate*, and OOM events — not on "MemUsed including cache"
- Set `MemoryMax=` / cgroup / Kubernetes limits on everything that can leak; leave headroom on the host for page cache and the kernel
- Graph RSS per critical process over days; leaks are obvious there and invisible in a 5-minute page
- After OOM: record victim, hog, limit, and whether the limit was wrong or the code was

---

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Alert on high "memory used" | Cache counted as used | MemAvailable, Cached |
| App killed, host looks fine | cgroup / container limit | unit `MemoryMax`, `kubectl describe` |
| System crawls, disk busy | Swap storm | `vmstat` si/so, iostat |
| Repeated OOM of the same unit | Leak or undersized limit | RSS graph vs limit |
| Slab growing after huge dir scans | dentry/inode cache | `slabtop` |

## Investigation Tips

- OOM victim is chosen by score, not always by guilt. The hog may still be alive.
- `drop_caches` after an incident destroys the cache working set and can make the next hour *worse*. Use it as a controlled experiment, not a reflex.
- In K8s, look at the node *and* the pod. Eviction and cgroup OOM are different events.
- Dirty pages that cannot flush (dead NFS, dying disk) present as memory pressure. Check `Writeback` and storage health together.

## Related Notes

- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[vmstat Deep Dive]]
- [[pidstat Deep Dive]]
- [[Namespaces and cgroups]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> I once added swap "just to get through the night" on a leaking JVM. The box did not OOM; it spent six hours at 100% iowait and took the whole app tier with it. OOM would have been kinder. Fix or stop the leak; do not give it a slower death.
>
> Host-level `free` looked fine while a single systemd unit hit `MemoryMax` and restarted every four minutes. Always check the cgroup that actually died.
