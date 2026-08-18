# Performance Investigation Framework

**Purpose**: A repeatable method to diagnose performance problems without jumping to conclusions.

---

## Core Principle

Look at **Utilization**, **Saturation**, and **Errors** across the main resources:

| Resource   | Utilization              | Saturation                     | Errors                    |
|------------|--------------------------|--------------------------------|---------------------------|
| CPU        | %user, %system           | Load average, run queue        | —                         |
| Memory     | Used / Available         | Swapping, OOM                  | Allocation failures       |
| Disk       | Throughput, %util        | Await, queue length            | I/O errors                |
| Network    | Bandwidth, pps           | Dropped packets, retransmits   | Errors, resets            |
| Application| Request rate, latency    | Queue depth, thread pool       | 5xx, timeouts             |

A high utilization number alone is rarely enough. Saturation and errors tell you whether the resource is actually the bottleneck.

---

## 1. Define the Problem Precisely

- What is slow or failing? (login, API, batch job, whole host…)
- When did it start?
- Is it continuous or intermittent?
- Who/what is affected?
- What changed recently?

---

## 2. Quick Baseline (gather before changing anything)

```bash
date
uptime
free -h
df -hT
df -i
vmstat 1 5
mpstat -P ALL 1 3
iostat -xz 1 3
ss -s
ps aux --sort=-%cpu | head -10
ps aux --sort=-%mem | head -10
```

---

## 3. Work Through the Resources

### CPU
- High %CPU + high load → CPU bound → [[High CPU Runbook]]
- High load + low %CPU → usually I/O or waiting → check disk/network

### Memory
- Low MemAvailable + swapping or OOM → [[Memory Pressure Runbook]]
- High cache usage is usually normal

### Disk
- High await / high %util → disk saturation
- Check `iostat -xz`, `iotop`, and whether it is random or sequential I/O

### Network
- Retransmits, drops, errors → [[TCP IP Troubleshooting Model]]
- Use `ss`, `sar -n`, `tcpdump` as needed

### Application
- Look at its own metrics, logs, and thread/connection pools

---

## 4. Form and Test Hypotheses

- Change one thing at a time.
- Prefer gathering more data over restarting services early.
- Compare with a known healthy host when possible.

---

## 5. Verify Recovery

Confirm that:
- The original symptom is gone
- Resource saturation has dropped
- Error rates and latency are back to normal
- No new problems were introduced

---

## Related Runbooks & Notes

- [[High CPU Runbook]]
- [[Memory Pressure Runbook]]
- [[Disk Full Runbook]]
- [[CPU Scheduling and Load Average]]
- [[Memory Management]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> 
