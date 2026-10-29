# Softirqs and NAPI

## Concept

Softirqs are the deferred half of interrupt handling. Hardware IRQs (hardirq) run with interrupts disabled and must finish fast; the heavy work is scheduled as a softirq. NAPI is the networking softirq path that switches from interrupt-driven to poll mode under load so one NIC does not monopolise a CPU.

The softirq that matters most on a network or storage host is `NET_RX` / `NET_TX` and `BLOCK`. High softirq time with low user/system time is a classic “the box is busy but top looks quiet” symptom.

## Why it matters

- A single RX softirq can pin one core at 100 % while the rest of the machine is idle. Latency for everything on that core suffers.
- NAPI poll budget and weight determine how much work one softirq does before yielding. Too high and you get latency; too low and you get interrupt storms.
- Interrupt coalescing and softirq deferral interact. Disabling coalescing “to reduce latency” can explode softirq rate and make latency worse.
- Container and CPU-isolation setups that move hardirqs but leave softirqs behind still see the load.

## Mental Model

```
NIC packet arrives
  → hardirq (very short) → schedule NET_RX softirq
  → ksoftirqd or current context runs net_rx_action
       → NAPI poll (budget of packets)
       → if more work, rearm softirq; else re-enable interrupts
```

`/proc/softirqs` is cumulative counts per CPU. Rate of change matters, not the absolute number. `ksoftirqd/N` is the thread that runs softirqs when they cannot be done in the interrupt return path.

## Key Commands

```bash
# Cumulative softirq counts per CPU
cat /proc/softirqs
watch -d -n 1 'cat /proc/softirqs'

# Per-CPU softirq time (and hardirq)
mpstat -P ALL 1
top -H -p 1   # or look for ksoftirqd

# Which softirq is hot
awk '{print $1, $NF}' /proc/softirqs | sort -k2 -n

# NAPI / interrupt coalescing on a NIC
ethtool -c eth0
ethtool -C eth0 rx-usecs 50   # careful, test

# Softirq budget (rarely needed)
sysctl net.core.netdev_budget
sysctl net.core.netdev_budget_usecs
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| One core at 100 % si, others idle | RX softirq pinned to that CPU | `/proc/softirqs`, `mpstat -P ALL` |
| Latency spikes under moderate traffic | NAPI budget too high or coalescing off | `ethtool -c`, softirq rate |
| `ksoftirqd` high, packet drops | budget exhausted or CPU saturated | `netdev_budget`, `ss -s`, NIC drops |
| Isolation did not help | softirqs still on the isolated CPU | `cat /proc/irq/*/smp_affinity`, softirq CPU |
| After “disable coalescing” latency worse | interrupt storm → softirq thrashing | restore default coalescing |
| Softirq count huge but rate flat | old counter, not current load | watch the delta |

## Investigation Tips

- Always look at the *rate* of softirqs, not the lifetime total. `watch -d` or a one-second delta.
- Map the hot softirq CPU back to the NIC queues (`/proc/interrupts` and `/sys/class/net/eth0/device/msi_irqs`).
- NAPI poll is per-device. A single overloaded queue can still pin one CPU even with multiple queues if RSS is unbalanced.
- Changing `netdev_budget` is a last resort. Prefer queue count, RSS, and coalescing first.
- In a container the softirq still runs on the host CPU; cgroup accounting does not hide it from `mpstat`.

## Related Notes

- [[CPU Isolation and Affinity]]
- [[Pressure Stall Information]]
- [[Bonds Bridges VLANs and ethtool]]
- [[TCP IP Troubleshooting Model]]
- [[Performance Investigation Framework]]
- [[iostat Deep Dive]]

## Personal Lessons Learned

- A “CPU isolation” change moved the hardirq but left `NET_RX` softirq on the isolated core. Latency for the real-time process stayed bad until the softirq CPU was also moved.
- Disabling interrupt coalescing on a 10 G NIC to “reduce latency” turned a 5 % softirq into 40 % and made p99 worse. Restoring a modest `rx-usecs` fixed it.
- `ksoftirqd` at 100 % on one core with zero packet drops was still a problem: the application on that core was being delayed by the softirq.
