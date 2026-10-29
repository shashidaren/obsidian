# irqbalance and Interrupt Affinity

## Concept

irqbalance is a userspace daemon that periodically looks at interrupt rates and moves IRQ affinity to spread load. Manual affinity (`/proc/irq/N/smp_affinity`) is the alternative when you want deterministic placement (CPU isolation, NUMA locality, or a known-good layout).

The daemon is useful on general-purpose hosts and actively harmful on hosts where you have already pinned IRQs for latency or isolation reasons. It also does not understand every device; some NICs and NVMe controllers are better left to their own multi-queue drivers.

## Why it matters

- On a busy network host irqbalance can move the NIC IRQ onto a CPU that is already running the application, creating latency jitter.
- On an isolated-CPU host it will happily put IRQs back onto the isolated cores unless you tell it not to.
- Manual affinity without updating irqbalance’s banned list is overwritten on the next rebalance interval.
- Some devices (certain RAID controllers, GPUs) perform worse when their IRQs are spread; they want locality.

## Mental Model

```
device raises IRQ
  → kernel looks up smp_affinity mask
  → hardirq runs on one of the allowed CPUs
  → softirq usually follows on the same CPU

irqbalance every few seconds:
  read /proc/interrupts rates
  compute new masks
  write smp_affinity (unless banned or hint says otherwise)
```

## Key Commands

```bash
# Is irqbalance running and what is it doing?
systemctl status irqbalance
irqbalance --debug          # or journalctl -u irqbalance

# Current affinity
cat /proc/irq/*/smp_affinity_list | head
for i in /proc/irq/*/smp_affinity_list; do echo "$i: $(cat $i)"; done

# Ban CPUs from irqbalance (isolated cores)
# /etc/default/irqbalance or IRQBALANCE_BANNED_CPUS
echo 0-3 > /etc/irqbalance.banned   # example; check distro path

# Manual pin (hex mask, CPU 2 = bit 2 = 4)
echo 4 > /proc/irq/42/smp_affinity

# Per-queue NIC affinity (often better than irqbalance)
ethtool -L eth0 combined 8
# then use the driver’s own script or manual masks
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Latency jitter after “optimisation” | irqbalance moved IRQs | `journalctl -u irqbalance`, affinity before/after |
| Isolated CPUs still take interrupts | irqbalance not banned | banned CPU list, `smp_affinity` |
| One CPU still hot after spreading | device ignores affinity or single queue | `/proc/interrupts`, `ethtool -l` |
| Manual pin disappeared | irqbalance overwrote it | daemon status, banned list |
| NVMe or NIC slower when balanced | wants NUMA locality | pin to local CPU, compare |
| irqbalance CPU usage high | too many IRQs or short interval | interval setting, device count |

## Investigation Tips

- Snapshot `/proc/interrupts` and the affinity masks before and after stopping irqbalance. The difference tells you what it was doing.
- For NICs with multiple queues, prefer the driver’s RSS + manual or scripted affinity over irqbalance. irqbalance sees individual MSIs but does not always make the best NUMA decision.
- Banned CPUs are a bitmask. Getting the hex wrong is common; verify with `cat /proc/irq/default_smp_affinity` and a test IRQ.
- Stopping irqbalance is safe. The last affinity masks remain until reboot or until something else writes them.
- On cloud VMs irqbalance often fights the hypervisor’s own interrupt routing. Measure before leaving it enabled.

## Related Notes

- [[CPU Isolation and Affinity]]
- [[Softirqs and NAPI]]
- [[NUMA and Memory Affinity]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Performance Investigation Framework]]
- [[udev and Kernel Modules]]

## Personal Lessons Learned

- irqbalance was left enabled on a low-latency trading host. It moved the NIC IRQ every 10 s. Disabling it and pinning queues to the application CPUs removed the jitter.
- I banned CPUs 0-3 but used a decimal mask instead of hex. irqbalance ignored the ban. The correct bitmask fixed it.
- On an NVMe-heavy host, letting irqbalance spread the NVMe IRQs across sockets increased latency. Pinning each controller to its local NUMA node was faster.
