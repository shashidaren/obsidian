# High Load Low CPU

**Purpose**: Diagnose situations where load average is high but CPU utilization is modest.

**When to use**: `uptime` shows high load, yet `top`/`mpstat` show low %CPU. System feels slow or unresponsive.

---

## 1. Quick Triage

```bash
uptime
mpstat -P ALL 1 3
vmstat 1 5
ps aux | awk '$8 ~ /D/ {print}'     # processes in uninterruptible sleep
```

**Key questions**:
- How many CPUs does the system have? (`nproc`)
- Is load >> number of CPUs?
- Are there processes in **D** state?
- Is `%wa` (iowait) high?

---

## 2. Common Causes

| Cause                        | What you see                          | Next step                      |
|------------------------------|---------------------------------------|--------------------------------|
| Disk I/O saturation          | High %wa, high await                  | `iostat -xz 1`, `iotop`        |
| NFS / remote filesystem hang | Processes in D state, network issues  | `nfsstat`, check NFS server    |
| Heavy swapping               | High si/so in vmstat                  | `free -h`, [[Memory Pressure Runbook]] |
| Too many runnable tasks      | High `r` in vmstat                    | Process list, application queues |
| Lock contention / kernel     | High load, low user CPU               | `perf`, kernel traces          |

---

## 3. Investigation

```bash
# CPU vs I/O breakdown
mpstat -P ALL 1 5
iostat -xz 1 5

# Blocked processes
ps aux | awk '$8 ~ /D/'
cat /proc/meminfo | grep -i dirty

# Who is doing I/O
iotop -o

# Network filesystems
mount | grep nfs
nfsstat -c
```

---

## 4. Safe Remediation

1. **Identify the resource that is saturated** (disk, NFS, memory, etc.).
2. Reduce load on that resource if possible:
   - Stop or throttle heavy jobs
   - Fix the NFS server or network path
   - Address memory pressure
3. Avoid simply adding CPU — it will not help if the bottleneck is I/O.

---

## 5. Verification

```bash
uptime
vmstat 1 3
mpstat 1 3
```

Load average should start falling and the system should become responsive again.

---

## Related Notes

- [[CPU Scheduling and Load Average]]
- [[Disk Full Runbook]]
- [[Memory Pressure Runbook]]
- [[iostat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> 
