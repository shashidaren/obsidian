# CPU Frequency Scaling

## Concept

The kernel’s cpufreq subsystem (and the hardware P-states / HWP) changes the clock speed of each core. Governors decide how aggressively to ramp frequency up or down. On modern Intel/AMD the hardware often does most of the work; the OS only sets a preference or a limit.

Frequency is not free. Higher clocks cost power and heat. Lower clocks cost latency.

## Why it matters

- A latency-sensitive service on `powersave` or a thermal-throttled core will show high response times while `top` still looks fine.
- Turbo boost disappearing under load is normal; sustained all-core turbo is not.
- VMs often cannot see or control the real frequency. `%st` and host power policy matter more than the guest governor.
- Wrong governor after a BIOS update or kernel change is a classic “it got slower last night” incident.

## Mental Model

```
hardware P-states / HWP / AMD CPPC
    ↑
cpufreq driver (intel_pstate, acpi-cpufreq, amd-pstate)
    ↑
governor (performance, powersave, schedutil, ondemand, conservative)
    ↑
scaling_min_freq / scaling_max_freq / energy_performance_preference
```

Common governors:

| Governor | Behavior |
|----------|----------|
| `performance` | Stay at highest allowed frequency |
| `powersave` | Stay at lowest (or let HWP decide) |
| `schedutil` | Scheduler-driven (preferred on recent kernels) |
| `ondemand` / `conservative` | Older load-based ramping |

`intel_pstate` in active mode largely ignores the classic governors and uses its own logic plus `energy_performance_preference`.

## Key Commands

```bash
# Current driver and governors
cpupower frequency-info
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_driver
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq

# All cores quickly
grep . /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq

# Set (until reboot)
cpupower frequency-set -g performance
# or
echo performance | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# intel_pstate preference
cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference
echo performance | tee /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference

# Thermal / throttle evidence
sensors
cat /sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count 2>/dev/null
dmesg | grep -i -E 'throttl|thermal'
```

Persistent config is usually `/etc/default/cpupower` or a systemd unit / tuned profile.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Latency high, CPU % low | powersave / low max freq / thermal throttle | `scaling_cur_freq`, `sensors`, throttle counters |
| Frequency stuck low after resume | Governor or BIOS power policy | `cpupower frequency-info`, BIOS C-states |
| Turbo never engages | `scaling_max_freq` capped or thermal limit | max vs base vs turbo in frequency-info |
| VM performance varies | Host power policy or steal | Host metrics, `%st`, do not trust guest governor |
| “performance” governor ignored | intel_pstate active mode | Check driver; use energy_performance_preference |
| Fans scream, clocks drop | Thermal or power limit | sensors, dmesg, chassis airflow |

## Investigation Tips

- Compare `scaling_cur_freq` under load to the advertised turbo. If it never leaves base, you are throttled or capped.
- On bare metal, `performance` + disabled deep C-states is the usual latency profile. On a laptop or dense VM host it is the wrong default.
- Guest `cpupower` changes often do nothing. Look at the hypervisor and the host’s power profile first.
- After a kernel or microcode update, re-check the driver (`intel_pstate` vs `acpi-cpufreq`). Behavior changes are common.
- `turbostat` (if available) shows actual package power, core clocks, and throttle reasons more clearly than sysfs alone.

## Related Notes

- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[CPU Isolation and Affinity]]
- [[NUMA and Memory Affinity]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An API p99 regression after a kernel update was `intel_pstate` switching to a more aggressive powersave bias. Setting `energy_performance_preference=performance` on the latency cores restored the old clocks without a full `performance` governor.
- I chased application code for a day while the chassis was thermally throttling every core to 800 MHz. `sensors` and the throttle counters would have ended it in five minutes.
- On a KVM guest, changing the governor did nothing useful. The host was in a balanced power profile and `%st` was 15 %. Fixed the host policy instead.
