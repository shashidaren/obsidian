# systemd-oomd

## Concept

systemd-oomd is a userspace OOM daemon that monitors pressure stall information (PSI) and cgroup memory usage. It kills processes (or whole cgroups) earlier and more selectively than the kernel OOM killer, using policy from unit files rather than only `oom_score`.

It complements, and on many modern distros partially replaces, waiting for the kernel OOM killer.

## Why it matters

- Kernel OOM is a last resort and can kill the wrong process or thrash for a long time first. oomd acts on sustained pressure.
- Containers and slices can be limited and killed independently of host RAM.
- Mis-tuned `ManagedOOM*` settings cause either premature kills or no action until the kernel OOM fires anyway.
- PSI metrics (`some`/`full`) are the signal oomd uses; if you do not understand them you cannot interpret its decisions.

If a service disappears under memory pressure with no classic "Out of memory: Killed process" line, check oomd before you assume a crash.

## Mental Model

```
PSI memory pressure (some/full)
    + cgroup memory.current vs limits
        → systemd-oomd evaluates ManagedOOMSwap= / ManagedOOMMemoryPressure=
        → kills candidates inside the cgroup (or the cgroup)
        → logs to journal

Kernel OOM killer still exists as the final backstop.
```

Units opt in with:

```
[Service]
ManagedOOMSwap=kill
ManagedOOMMemoryPressure=kill
ManagedOOMMemoryPressureLimit=60%
```

`oomd` prefers to kill inside the cgroup that is under pressure rather than a random high-RSS process on the host.

## Key Commands

```bash
# Is it running and what has it done?
systemctl status systemd-oomd --no-pager
journalctl -u systemd-oomd -n 50 --no-pager

# Current pressure (host and cgroups)
cat /proc/pressure/memory
find /sys/fs/cgroup -name memory.pressure -exec grep -H . {} + 2>/dev/null | head

# Effective unit settings
systemctl show foo.service -p ManagedOOMSwap -p ManagedOOMMemoryPressure -p ManagedOOMMemoryPressureLimit

# Cgroup events
cat /sys/fs/cgroup/system.slice/foo.service/memory.events
cat /sys/fs/cgroup/system.slice/foo.service/memory.pressure
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service killed, no kernel OOM line | oomd acted on PSI | `journalctl -u systemd-oomd`, unit ManagedOOM* |
| Whole slice dies under load | ManagedOOM* on the slice, limit too low | memory.pressure, MemoryMax |
| oomd never fires, then kernel OOM | ManagedOOM* not set, or daemon disabled | unit show, systemctl status systemd-oomd |
| Kills too early | MemoryPressureLimit too aggressive | pressure files, raise limit or switch to log-only first |
| Container OOM but host fine | cgroup-scoped kill | memory.events inside the slice |
| After kill, immediate restart loop | Restart=always + leak still present | RSS trend, MemoryMax |

## Investigation Tips

- `journalctl -u systemd-oomd` is the first place. It records which cgroup and why.
- Compare `/proc/pressure/memory` (host) with the cgroup's `memory.pressure`. High full pressure means tasks are stalled, not just that cache is large.
- `ManagedOOMMemoryPressure=kill` with a low limit will fire on transient spikes. Start with `log` or a higher limit while you measure.
- Kernel OOM and oomd can both be active. A classic dmesg OOM line means the kernel backstop fired; an oomd journal line means userspace acted first.
- Protect critical units (sshd, the node agent) by not setting aggressive ManagedOOM* on them, or by using a more negative OOMScoreAdjust as a secondary control.
- PSI is not available on very old kernels. oomd will be idle or refuse to start; you are back to the kernel OOM killer.

## Related Notes

- [[Swap and OOM Killer]]
- [[Memory Pressure Runbook]]
- [[Memory Management]]
- [[systemd Units]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A service vanished every afternoon with a clean restart and no kernel OOM. `journalctl -u systemd-oomd` showed it killing the cgroup at 60% pressure. The limit was copied from a laptop example; raising it and fixing the actual leak stopped the kills.
- I disabled systemd-oomd because "we already have the kernel OOM killer". The next incident thrashed for ten minutes before the kernel acted. oomd with conservative limits would have failed the bad cgroup in seconds.
- PSI `full` was high while `free -h` still showed cache. The working set did not fit; cache was irrelevant. oomd saw the stalls; `free` did not.
