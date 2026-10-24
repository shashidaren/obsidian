# Transparent Huge Pages

## Concept

Transparent Huge Pages (THP) is the kernel's attempt to promote 4 KiB pages into 2 MiB huge pages automatically for anonymous memory. It reduces TLB misses. It also introduces latency spikes when the kernel has to collapse or split pages under pressure, and it fights databases that already manage their own large pages.

`/sys/kernel/mm/transparent_hugepage/enabled` is usually `always` or `madvise`. `always` means every process can get them. `madvise` means only processes that opt in with `madvise(MADV_HUGEPAGE)`.

## Why it matters

- Oracle, PostgreSQL, Redis, and JVM GC pause times jump when THP compaction or defragmentation runs. The symptom looks like a random CPU or lock stall.
- `always` on a database host is a known footgun. Many vendors document `madvise` or `never`.
- A box can show high `%sys` and long `kcompactd` or `khugepaged` CPU with no application change.
- Containers inherit the host setting. A node with THP `always` affects every pod.

## Mental Model

```
4 KiB pages
    → khugepaged / kcompactd promotes to 2 MiB when it can
    → process uses huge page (fewer TLB walks)
    → under memory pressure or fragmentation, kernel splits or stalls to make a huge page

enabled: always | madvise | never
defrag:  always | defer | madvise | never   (when to compact)
```

`AnonHugePages` in `/proc/meminfo` shows how much anonymous memory is currently in huge pages. A sudden drop often coincides with a latency spike.

## Key Commands

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag
cat /proc/meminfo | grep -E 'HugePages|AnonHugePages'

# Per-process
grep -E 'AnonHugePages|ShmemHugePages' /proc/<PID>/smaps_rollup

# Activity
grep -E 'compact|thp' /proc/vmstat | head
ps -eo pid,comm,pcpu | grep -E 'kcompactd|khugepaged'

# Temporary change (survives until reboot unless persisted)
echo never > /sys/kernel/mm/transparent_hugepage/enabled
# or madvise
```

Persist via a systemd unit or `/etc/sysctl.d` is not the path; THP is sysfs. Common pattern is a oneshot service or tuned profile.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Random 100–500 ms stalls in DB, no deploy | THP compaction or khugepaged | `enabled`, `AnonHugePages`, `kcompactd` CPU |
| High `%sys`, low user, after memory pressure | defrag running | `defrag` setting, `vmstat` compactstall |
| Redis or Oracle latency graph has spikes | THP `always` | vendor docs usually want `madvise` or `never` |
| Setting changed, problem remains | process already has huge pages; or defrag still active | restart the process after the sysfs change |
| Container shows stalls, host looks fine | host THP `always`, pod inherits | check on the node, not inside the container |
| `never` set but AnonHugePages still high | static huge pages or the change was not applied | `HugePages_Total` vs AnonHugePages |

## Investigation Tips

- Read `enabled` and `defrag` before you chase application code. A one-line sysfs change is faster than a heap dump.
- Pair the timestamp of the stall with `ps` or `top` showing `kcompactd0` or `khugepaged` in the same window.
- Databases that allocate large arenas often want explicit huge pages (`vm.nr_hugepages`) and THP off. Mixing both is how you get both the benefit and the stall.
- On RHEL-like systems `tuned-adm` profiles can flip THP. Check the active profile before you blame the kernel default.
- Changing to `never` does not instantly break down existing huge pages. Restart the affected process or wait for natural reclaim.
- In a Kubernetes node, set the sysfs on the host (DaemonSet or node image). A container cannot usually write the host sysfs unless privileged.

## Related Notes

- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[NUMA and Memory Affinity]]
- [[sysctl and Resource Limits]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Postgres p99 spike every 15–20 minutes mapped exactly to `khugepaged` scans. Switching from `always` to `madvise` removed the spikes; the query plan had never changed.
- I once spent an hour in `perf` looking for a lock before someone asked about THP. The kernel CPU was the hint. Now I check the sysfs early on any latency-sensitive host.
