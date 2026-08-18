# Memory Pressure Runbook

**Purpose**: Diagnose memory pressure / OOM situations and recover safely.

**When to use**: High memory usage, swapping, OOM killer events, applications slow or being killed, or memory alerts.

---

## 1. Quick Triage (30–60 seconds)

```bash
# Current memory picture
free -h

# Detailed view
cat /proc/meminfo | grep -E 'MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|Dirty|Writeback'

# Who is using memory
ps aux --sort=-%mem | head -15

# Recent OOM events
dmesg -T | grep -iE 'out of memory|oom-killer|killed process' | tail -20
journalctl -k | grep -iE 'out of memory|oom' | tail -10
```

**Key questions**:
- Is `MemAvailable` low?
- Is the system swapping heavily?
- Did the OOM killer already run?
- Which process is the biggest consumer?

---

## 2. Distinguish common patterns

| Pattern                     | What you see                              | First focus                     |
|-----------------------------|-------------------------------------------|---------------------------------|
| True memory exhaustion      | MemAvailable very low, little cache       | Large processes / leaks         |
| Cache pressure              | High Cached/Buffers, low Available        | Usually normal – can be reclaimed |
| Heavy swapping              | High si/so in vmstat, Swap used           | Memory + disk I/O               |
| OOM killer triggered        | Entries in dmesg / journal                | Victim process + why            |
| Memory leak                 | One process steadily growing over time    | That process                    |

---

## 3. Investigation Steps

### 3.1 Understand current usage

```bash
# Top memory consumers
ps -eo pid,user,%mem,rss,cmd --sort=-rss | head -20

# Human readable RSS
ps -eo pid,user,rss,cmd --sort=-rss | awk 'NR==1{print; next} {printf "%s %s %.1f MB %s\n", $1,$2,$3/1024,$4}' | head -15

# Slab / kernel memory (sometimes important)
slabtop -o | head -20
```

### 3.2 Check swapping and pressure

```bash
vmstat 1 5
# Look at si / so columns (swap in / swap out)

# Pressure stall information (if available)
cat /proc/pressure/memory
```

### 3.3 OOM details

```bash
# Full OOM report
dmesg -T | grep -A 30 -i 'invoked oom-killer'

# Or from journal
journalctl -k -b | grep -A 20 -i 'oom-killer'
```

---

## 4. Safe Remediation (ordered by safety)

### Immediate safe actions

1. **Stop or restart the obvious heavy / leaking process** (after noting its PID and command):
   ```bash
   systemctl restart <service>
   # or graceful stop
   kill -TERM <PID>
   ```

2. **Clear reclaimable cache** (usually safe, temporary relief):
   ```bash
   sync
   echo 3 > /proc/sys/vm/drop_caches
   ```

3. **Reduce load**:
   - Disable non-essential services or batch jobs
   - Scale down application workers if possible

### Higher-risk actions

- Adding swap (temporary band-aid, can make things slower)
- Killing processes with `kill -9`
- Rebooting (last resort – you lose evidence)

---

## 5. Verification

```bash
free -h
ps aux --sort=-%mem | head -10
vmstat 1 3

# Confirm no new OOM events
dmesg -T | tail -20
```

**Success criteria**:
- MemAvailable is healthy again
- Swap activity has dropped significantly
- No new OOM killer messages
- Application is stable

---

## 6. Prevention & Follow-up

- Alert on MemAvailable, swap usage, and OOM events
- Set proper memory limits (systemd MemoryMax=, cgroups, Kubernetes limits)
- Investigate any process that keeps growing over time (leak)
- Consider memory cgroup accounting and early OOM notifications
- Document the process that was killed and why

---

## Related Notes

- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[vmstat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> Add real incidents here later.
