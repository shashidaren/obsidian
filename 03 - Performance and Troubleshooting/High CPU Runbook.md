# High CPU Runbook

**Purpose**: Quickly identify the source of high CPU usage and apply the safest remediation.

**When to use**: Load average high, `top`/`htop` showing sustained high %CPU, applications slow/timing out, or CPU saturation alerts.

---

## 1. Quick Triage (30–60 seconds)

```bash
# Overall load and uptime
uptime

# Who is using CPU right now
top -c -o %CPU
# or better
htop          # if available

# Quick process summary
ps aux --sort=-%cpu | head -15

# Per-CPU view
mpstat -P ALL 1 3
```

**Key questions**:
- Is it one process or many?
- User CPU, system CPU, or iowait?
- Sudden spike or gradual rise?
- Did anything change recently (deploy, cron, traffic)?

---

## 2. Distinguish common patterns

| Pattern                    | What you see                          | First focus                    |
|----------------------------|---------------------------------------|--------------------------------|
| Single process runaway     | One PID at 100%+                      | That process + its threads     |
| Many processes             | Several processes sharing high CPU    | Application / traffic / loop   |
| High system CPU            | `%sy` high in top/mpstat              | Kernel, syscalls, drivers      |
| High iowait                | `%wa` high                            | Disk, not pure CPU problem     |
| Steal time (VMs)           | `%st` high                            | Hypervisor / noisy neighbour   |

---

## 3. Investigation Steps

### 3.1 Identify the top consumers

```bash
# Detailed process view
ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -20

# Threads of a specific process (replace PID)
ps -T -p <PID>
top -H -p <PID>

# What the process is doing (if permitted)
strace -p <PID> -c -f          # summary of syscalls
perf top                       # if available – live CPU profile
```

### 3.2 Check for common causes

```bash
# Recent changes / cron
journalctl --since "1 hour ago" | grep -iE 'started|deploy|cron'

# Systemd services that might be looping
systemctl list-units --state=running --type=service

# Check for high context switching or interrupts
vmstat 1 5
```

### 3.3 Application-level clues

- Look at application logs around the time CPU rose
- Check request rate / queue length if it’s a web or worker service
- For Java/Python/Node: thread dumps or profiling can help later

---

## 4. Safe Remediation (ordered by safety)

### Low-risk actions

1. **Confirm it’s not just a short spike** – watch for 1–2 minutes.
2. **Restart a clearly runaway non-critical process** (after gathering evidence):
   ```bash
   systemctl restart <service>
   # or
   kill -TERM <PID>          # graceful
   ```
3. **Reduce load temporarily** (if possible):
   - Scale down traffic / disable a heavy cron
   - Rate-limit or put service in maintenance mode

### Higher-risk / needs care

- `kill -9` – only if the process is unresponsive and you accept data loss risk
- Changing application config under load
- Rebooting the host (last resort)

---

## 5. Verification

```bash
uptime
top -c -o %CPU
ps aux --sort=-%cpu | head -10

# Application health
systemctl status <service>
journalctl -u <service> -n 30 --no-pager
```

**Success criteria**:
- Load average trending down
- No single process stuck at high CPU
- Application responding normally again

---

## 6. Prevention & Follow-up

- Alert on sustained high CPU (e.g. >80% for 5+ minutes) and on load average
- Ensure applications have proper resource limits (cgroups / systemd / Kubernetes)
- Review recent deploys and cron jobs after any incident
- Consider adding profiling (perf, py-spy, async-profiler, etc.) for recurring issues

---

## Related Notes

- [[top Deep Dive]]
- [[ps Deep Dive]]
- [[pidstat Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> Add real incidents here later.
