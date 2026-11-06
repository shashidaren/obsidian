# Steal Time and Hypervisor Accounting

## Concept

Steal time (`%st` in `top`/`mpstat`/`vmstat`) is the percentage of a virtual CPU’s time that the hypervisor could not schedule because the physical CPU was busy with other guests or the host itself. The guest thinks it has a core; the host did not give it one.

It is not guest kernel time and not iowait. It is accounting for “I was ready to run and the hypervisor said no”.

## Why it matters

- High steal looks exactly like a slow application: latency rises, timeouts fire, load average climbs, and the guest’s own `%us`/`%sy` stay modest.
- Noisy-neighbour or oversubscribed hosts make steal bursty. Averages hide it; per-interval `mpstat` shows it.
- Stepping or slewing the clock while the host is stealing time makes chrony fight a moving target. See [[Time Sync and chrony]].
- Capacity planning that only looks at guest CPU utilisation under-provisions. The missing cycles never appear inside the guest.

## Mental Model

```
Physical core
  → hypervisor scheduler
      → this vCPU gets a timeslice   → guest runs (us/sy/idle)
      → this vCPU is ready but not scheduled → %st
      → this vCPU is idle            → idle

%st > 0 means the guest’s view of “100% of a core” is a lie for that interval.
```

Steal is reported by the hypervisor (KVM `kvm-clock` / `steal_time` MSR, Xen, etc.). A container on a bare-metal host has no steal; a container on a VM inherits the VM’s steal.

## Key Commands

```bash
# Live view — look at the st column
mpstat -P ALL 1 5
top -bn1 | head -5          # %st in the header
vmstat 1 5                  # st column

# Per-vCPU history if sysstat is installed
sar -u ALL 1 10

# Confirm you are in a VM
systemd-detect-virt
dmidecode -s system-manufacturer 2>/dev/null || true
cat /proc/cpuinfo | grep -E 'hypervisor|flags' | head

# Host-side (if you have access)
# virsh cpu-stats, or the cloud provider’s host metrics
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| App latency high, guest CPU looks fine | Steal | `mpstat` `%st`, cloud host metrics |
| `%st` spikes every few minutes | Noisy neighbour or host maintenance | Interval `mpstat`, provider events |
| Chrony offset jumps on a VM | Steal + host clock or resume | `chronyc tracking`, `%st` |
| Load high, `%us` low, `%st` high | Ready tasks not getting CPU | `vmstat` r and st |
| “CPU quota” alerts fire inside the guest only | Steal counted as busy by some agents | Agent config vs `mpstat` |
| Steal only on one vCPU | Pinning or host IRQ imbalance | `mpstat -P ALL`, host affinity |

## Investigation Tips

- Capture `mpstat -P ALL 1 30` during the incident. A 5-second average can hide a 200 ms steal spike that still causes timeouts.
- Compare guest `%st` with the cloud provider’s “CPU steal” or “host CPU contention” metric. They should agree in direction.
- If steal is high and you control the host, look at other guests, host `%sy`/`%si`, and whether the host itself is oversubscribed.
- Do not raise the guest’s vCPU count as the first response on a contended host; you may just create more runnable tasks that still get stolen.
- Clock skew and steal often appear together after live migration or snapshot resume. Fix the host clock and the guest’s time daemon before you chase application timeouts.
- Containers do not invent steal. If a container shows high steal, the node underneath is a VM that is being stolen from.

## Related Notes

- [[High CPU Runbook]]
- [[CPU Scheduling and Load Average]]
- [[Time Sync and chrony]]
- [[mpstat Deep Dive]]
- [[vmstat Deep Dive]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “slow database” on a cloud VM had 8% average CPU and 25% steal for minutes at a time. The application team scaled the instance; the real fix was a less contended host family. `mpstat` already had the answer.
- I once blamed chrony for offset spikes that only happened when `%st` was high. The hypervisor was busy; the guest clock was waiting. Host metrics first.
