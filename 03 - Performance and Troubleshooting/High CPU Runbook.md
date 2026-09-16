# High CPU Runbook

**Purpose**: Identify *which* CPU (user, system, iowait, steal) is busy, *which* process or interrupt is responsible, and apply the safest remediation that preserves evidence.

**When to use**: Load average high, `top`/`mpstat` showing sustained saturation, applications slow or timing out, or CPU alerts firing.

This is a runbook. For the underlying model see [[CPU Scheduling and Load Average]] and [[top Deep Dive]].

---

## Concept

High CPU is a *symptom*. Load average can be high because of runnable tasks, uninterruptible I/O, or (on VMs) steal. Treating every alert as "kill the top PID" misses kernel issues, interrupt storms, runaway cron, and noisy neighbours.

## Why it matters

- CPU saturation increases latency before it shows as a hard outage
- Wrong remediation (`kill -9` a database, reboot a node holding locks) turns a slowdown into data loss
- Distinguishing user CPU vs system vs iowait vs steal changes the entire investigation path in the first minute

## Mental Model

```
uptime / loadavg
        |
        +-- runnable tasks  → user or system CPU
        |         |
        |         +-- one PID / one thread  → runaway, tight loop, GC, crypto
        |         +-- many PIDs             → traffic, fork storm, cron pile-up
        |
        +-- D-state / iowait → disk, NFS, or storage path (not a CPU problem)
        +-- %st high         → hypervisor contention
        +-- %si / %hi high   → interrupt / softirq / network / storage IRQ
```

Rule: classify the *kind* of busy before you touch a process.

---

## 1. Quick Triage (30–60 seconds)

```bash
uptime
mpstat -P ALL 1 5
top -c -o %CPU
ps -eo pid,ppid,user,stat,psr,%cpu,%mem,cmd --sort=-%cpu | head -20
vmstat 1 5
```

**Key questions**:

- One process or many?
- `%us` vs `%sy` vs `%wa` vs `%st` vs `%si`?
- Sudden spike or gradual climb?
- Deploy, cron, traffic, or backup window?

If `%wa` dominates, stop this runbook and switch to [[High Load Low CPU]] / [[iostat Deep Dive]].

---

## 2. Distinguish common patterns

| Pattern | What you see | First focus |
|---------|--------------|-------------|
| Single process runaway | One PID at ~100% × N cores | That process + threads (`top -H -p`) |
| Many app workers | Several related PIDs sharing CPU | Traffic, query, or tight retry loop |
| High system CPU | `%sy` high, often with context switches | Syscalls (`strace -c`), locks, overlayfs |
| High iowait | `%wa` high, load up, CPU idle | Disk / NFS — not CPU |
| Steal (VMs) | `%st` high | Hypervisor / noisy neighbour / undersized vCPU |
| Interrupt storm | `%si`/`%hi` high, `si` in vmstat | `mpstat -I`, NIC queues, storage IRQs |
| Cron pile-up | Same job overlapping, many children | `systemctl list-timers`, crontab, flock |

---

## 3. Investigation Steps

### 3.1 Identify the consumer

```bash
ps -eo pid,ppid,user,stat,psr,%cpu,nlwp,cmd --sort=-%cpu | head -20
ps -T -p <PID>
top -H -p <PID>
pidstat -t -p <PID> 1 5
```

`nlwp` / `-H` matter: one process with 32 spinning threads is not "one task".

### 3.2 What is it doing?

```bash
# Syscall summary (short window; can stall the target)
strace -p <PID> -c -f -e trace=network,file,desc 2>&1 | tail

# On-CPU profile if perf is available
perf top -p <PID>
perf record -p <PID> -g -- sleep 10 && perf report --stdio | head -40

# Language-specific (only if you already know the runtime)
# jcmd <PID> Thread.print
# py-spy dump --pid <PID>
```

Do not leave `strace` attached on a latency-sensitive production process.

### 3.3 System and change context

```bash
journalctl --since "1 hour ago" -p err
systemctl list-timers --all | head
crontab -l; ls /etc/cron.* 2>/dev/null
vmstat 1 5          # r, cs, in, us, sy, wa, st
cat /proc/pressure/cpu 2>/dev/null
```

---

## 4. Safe Remediation (ordered by safety)

### Low-risk

1. Watch 1–2 minutes. Confirm it is not a short spike (backup, compile, GC).
2. Capture evidence first: `ps`, `top -b -n 1`, last 100 journal lines, deploy time.
3. Restart a *non-critical* runaway unit after capture:
   ```bash
   systemctl restart <service>
   kill -TERM <PID>
   ```
4. Shed load: disable the overlapping cron, pause a batch queue, enable maintenance / rate limit.

### Higher-risk

- `kill -9` — only if the process ignores SIGTERM *and* you accept possible corruption
- Changing live app config under saturation
- Host reboot — last resort; you lose the on-CPU picture

Never kill a database, broker, or hypervisor agent because it is "the top CPU". Profile it first.

---

## 5. Verification

```bash
uptime
mpstat -P ALL 1 3
ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -10
systemctl status <service>
journalctl -u <service> -n 30 --no-pager
```

**Success**: load trending down, no stuck 100% thread, application SLOs recovering — not just "top looks quieter for 10 seconds".

---

## 6. Prevention & Follow-up

- Alert on *sustained* saturation (e.g. >80% for 5+ minutes) and on load vs runnable vs iowait separately
- Put CPUQuota / cgroup limits on batch and sidecar units so they cannot starve latency-critical services
- After the incident: one paragraph on *which pattern* it was, plus a link to the profile or thread dump
- Recurring user-CPU in one runtime → add a standing profiler path (perf, async-profiler, py-spy), not another restart playbook

---

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Load high, `%wa` high | Disk / NFS | `iostat`, `vmstat`, [[High Load Low CPU]] |
| Load high, `%us` low, many `D` | Uninterruptible I/O | `ps -eo stat,wchan,cmd` |
| One Java/Node at 800% | Thread explosion or GC | `top -H`, runtime dump |
| CPU fine on host, app slow | Steal, noisy neighbour, or lock | `mpstat` `%st`, guest tools |
| Fine after restart, back in N hours | Leak, unbounded queue, missing cron lock | Graph CPU + job concurrency |

## Investigation Tips

- `mpstat -P ALL` before `kill`. Per-CPU imbalance often means one IRQ or one pinned thread.
- Load average includes D-state; it is not a CPU meter. Pair it with `vmstat` every time.
- In containers, check *both* the container cgroup quota and the host. Throttling looks like "the app is slow" with idle host CPUs.
- Capture first. A restart that "fixes" it without a profile guarantees a repeat.

## Related Notes

- [[top Deep Dive]]
- [[ps Deep Dive]]
- [[pidstat Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[High Load Low CPU]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> The first time I treated high load as high CPU I restarted an app that was only waiting on a wedged NFS mount. `mpstat` already showed `%wa`; I had ignored it. Classify us/sy/wa/st before you touch PIDs.
>
> A "runaway" Python worker was 32 threads in a retry loop against a 504. Killing the worker hid the proxy timeout. Fix the hop that is failing; the CPU is the messenger.
