# turbostat and Power

## Concept

turbostat reads Intel/AMD MSRs and RAPL counters to show per-package and per-core frequency, power, C-state residency, and throttle reasons. It is the clearest way to see why a core is not running at the frequency you expect.

## Why it matters

- sysfs frequency is a hint; turbostat shows what the silicon actually did
- Power limits, thermal limits, and package RAPL explain “CPU % is low but latency is high”
- Useful for validating power profiles and spotting noisy neighbors on shared hosts

## Mental Model

```
hardware counters (APERF/MPERF, RAPL, C-states)
  → turbostat samples
    → columns: Bzy_MHz, PkgWatt, CoreTmp, CPU%c1, …
```

Run it under load to see sustained clocks and power.

## Key Commands

```bash
turbostat --quiet
turbostat -i 5
turbostat --show Bzy_MHz,PkgWatt,CoreTmp,Pkg%pc6
# Specific package
turbostat -c 0,1
# While a workload runs
stress-ng --cpu 4 &
turbostat -i 2
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Clocks stuck low | power or thermal limit | PkgWatt vs limit, CoreTmp |
| High C-state residency under load | idle misdetection or governor | CPU%c0 vs expected |
| Package power hitting limit | RAPL PL1/PL2 | turbostat PkgWatt |
| Guest numbers meaningless | hypervisor hides MSRs | host turbostat |

## Investigation Tips

- Run with the problematic workload. Idle numbers do not explain latency.
- Compare to cpupower and sensors.
- On AMD use equivalent tools or kernel logs if turbostat support is partial.
- Permission: often needs root or perf_event_paranoid adjusted.

## Related Notes

- [[CPU Frequency Scaling]]
- [[High CPU Runbook]]
- [[Steal Time and Hypervisor Accounting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- turbostat showed the package hitting its power limit at 80 W while the advertised TDP was 150 W. BIOS power limit was the real governor.
