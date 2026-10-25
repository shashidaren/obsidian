# Kernel Slab Memory

## Concept

Slab is the kernel's object allocator. Dentries, inodes, network buffers, dentry cache, and thousands of other kernel structures live in slabs. `SReclaimable` can be reclaimed under pressure; unreclaimable slabs stay until the objects are freed.

A host can show healthy `MemAvailable` while slab has grown into hundreds of megabytes or more. That is usually fine. It becomes an incident when unreclaimable slab grows without bound, or when reclaim of `SReclaimable` stalls because the disk or the consumers cannot free the objects.

## Why it matters

- Huge `SReclaimable` (dentry/inode cache) is normal after walking a large file tree. It drops under pressure. Do not treat it as a leak.
- Unreclaimable slab that climbs and never drops is a kernel or driver leak, or a consumer that refuses to free (stuck mounts, open files that keep dentries alive).
- OOM or reclaim stalls can be caused by slab pressure even when user RSS looks modest.
- `slabtop` and `/proc/slabinfo` name the objects. "kernel memory" is not a diagnosis.

## Mental Model

```
/proc/meminfo
  Slab            total
  SReclaimable    can be dropped (dentry, inode, etc.)
  SUnreclaim      stays until objects free

slabtop / /proc/slabinfo
  name            object type (dentry, inode_cache, kmalloc-*, tcp_bind_bucket, ...)
  active_objs     currently allocated
  num_objs        total slots in the slab
  objsize         size of one object

Pressure:
  high SReclaimable + healthy MemAvailable → normal cache
  SUnreclaim climbing forever → leak or stuck consumer
  reclaim stalls with high slab → disk or lock holding the objects
```

## Key Commands

```bash
# Headline
grep -E 'Slab|SReclaimable|SUnreclaim' /proc/meminfo

# Who is using it (needs root for full detail on modern kernels)
slabtop -s c
slabtop -o | head -30

# Raw
cat /proc/slabinfo | head -5
awk '{print $1,$2,$3,$4}' /proc/slabinfo | sort -k3 -n | tail -20

# Drop reclaimable caches (diagnostic only)
echo 2 > /proc/sys/vm/drop_caches     # dentries/inodes
# 1 = pagecache, 2 = dentries/inodes, 3 = both
# never put this in a cron

# After a huge find/du or backup
# watch SReclaimable fall once the walk ends and pressure appears
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| SReclaimable hundreds of MB after `find` / backup | Normal dentry/inode cache | `slabtop`; drops under pressure |
| SUnreclaim grows and never shrinks | Kernel/driver leak or stuck objects | `slabtop`; dmesg; which objects |
| MemAvailable low, RSS modest, slab high | Slab pressure | meminfo + slabtop |
| `drop_caches` does nothing to SUnreclaim | Objects still referenced | lsof, mounts, open files |
| High `kmalloc-*` or `tcp_*` | Network or packet path | ss, conntrack, packet rates |
| After NFS hang, slab stays high | Stuck dentries/inodes on dead mount | `mount`, `lsof` on the path |

## Investigation Tips

- Snapshot `slabtop` twice, ten minutes apart, before calling a leak. One-shot numbers lie.
- `SReclaimable` dominating after a recursive walk is expected. If it does not drop when you stop the walk and create memory pressure, something is pinning the objects.
- Unreclaimable growth: match the object name to a subsystem (network, filesystem, security). Search for known leaks in that driver/kernel version.
- `echo 2 > /proc/sys/vm/drop_caches` is a diagnostic. If it frees a lot, the cache was reclaimable. If it frees nothing, the objects are still in use.
- Correlate with `iostat` and NFS/mount state. Writeback or a hung mount can pin slab.
- On containers, slab is host-global. A single pod cannot "own" most of it, but a busy node can.

## Related Notes

- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[Memory Pressure Runbook]]
- [[sysctl and Resource Limits]]
- [[lsof Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A box looked "out of memory" after a nightly `find` for cleanup. `SReclaimable` was 4 GB of dentry cache. It vanished under a synthetic load. We stopped alerting on slab total.
- Unreclaimable `kmalloc-2k` climbing for days was a driver that never freed a per-packet structure under a rare error path. `slabtop` named it; the kernel version matched a known fix.
