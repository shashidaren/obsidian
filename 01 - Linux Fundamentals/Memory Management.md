# Memory Management

## Concept

Linux manages physical RAM as pages (usually 4 KiB) and presents each process a virtual address space. The kernel tracks free, active, inactive, and reclaimable pages. When free memory is low it reclaims page cache and anonymous pages (via swap or direct reclaim) and can invoke the OOM killer.

Key counters live in `/proc/meminfo` and `free`. “Used” is not the same as “unavailable”.

## Why it matters

- Applications and the kernel itself can be killed or stalled by reclaim and OOM.
- Page cache is deliberately large; dropping it “to free memory” is almost always wrong.
- Transparent Huge Pages, NUMA, and cgroup memory limits change the picture. A host can have free RAM and still OOM a cgroup.
- Swap and overcommit policy decide whether the system dies slowly or suddenly.

## Mental Model

```
physical pages
  → used by processes (anon)
  → used by page cache / buffers (reclaimable)
  → kernel slabs, page tables, etc.
  → free

Low free → kswapd / direct reclaim → if still bad → OOM killer
```

`MemAvailable` (not `MemFree`) is the practical “can I start another workload” number.

## Key Commands

```bash
free -h
cat /proc/meminfo | egrep 'Mem|Swap|Commit|Huge|SReclaimable|Cached'
vmstat 1 5
ps -eo pid,user,rss,vsz,comm --sort=-rss | head

# Per-process detail
cat /proc/PID/status | egrep 'Vm|Rss|Swap'
cat /proc/PID/smaps_rollup 2>/dev/null || cat /proc/PID/smaps | head

# OOM history
dmesg -T | grep -i oom
journalctl -k -b | grep -i 'out of memory'
```

See also `[[Swap and OOM Killer]]`, `[[Page Cache and Drop Caches]]`, `[[Memory Pressure Runbook]]`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High “used”, low free, system fine | Page cache doing its job | `MemAvailable`, cache growth |
| kswapd high CPU, latency | Reclaim pressure | `vmstat` si/so, `sar -B`, PSI |
| Process killed, no disk full | OOM killer | `dmesg`, `journalctl`, cgroup limits |
| Swap thrashing, load high | Insufficient RAM or leak | `free`, `vmstat`, top RSS |
| `Committed_AS` near CommitLimit | Overcommit exhaustion | `/proc/meminfo`, `vm.overcommit_*` |
| Cgroup OOM while host has free RAM | Memory limit / QoS | `systemctl status`, `memory.current` |

## Investigation Tips

- Start with `free -h` and `MemAvailable`. If Available is healthy, memory is probably not the problem.
- Distinguish cache from anon. `sar -r` or `vmstat` over time shows whether cache is growing or anon is leaking.
- Check cgroup limits before blaming the host. `systemctl show unit -p MemoryMax` or `/sys/fs/cgroup/.../memory.current`.
- OOM killer logs include the victim score and the killed process. Capture them before the next reboot rotates them away.
- Never `echo 3 > /proc/sys/vm/drop_caches` on production as a “fix”. It only hides the symptom and creates a thundering herd on the disk.

## Related Notes

- [[Swap and OOM Killer]]
- [[Page Cache and Drop Caches]]
- [[Memory Pressure Runbook]]
- [[Transparent Huge Pages]]
- [[NUMA and Memory Affinity]]
- [[Namespaces and cgroups]]
- [[procfs for Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service was “using 90% of RAM” according to a dashboard that counted cache. `MemAvailable` was 40%. The real leak was in a sidecar cgroup with a tight MemoryMax.
- Dropping caches during an incident made the database’s working set have to be re-read from disk and extended the outage by twenty minutes.
