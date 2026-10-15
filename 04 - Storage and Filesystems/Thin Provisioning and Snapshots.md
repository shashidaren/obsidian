# Thin Provisioning and Snapshots

## Concept

Thin provisioning overcommits physical space. A thin pool is a VG (or part of one) from which thin LVs are allocated on demand. Snapshots of thin volumes are also thin; they share the same pool.

The pool has two scarce resources: data space and metadata space. Either can fill independently. When the pool is full, writes to any thin LV in it fail.

## Why it matters

- Cloud and hypervisor thin disks plus LVM thin on top is a double overcommit. Both can run out.
- A snapshot that looks “free” still consumes pool space as the origin changes. Leaving snapshots around is how pools fill at 03:00.
- Metadata exhaustion is quieter than data exhaustion and just as fatal.
- Thin is excellent for many short-lived volumes (CI, containers, test VMs). It is a liability on a single database LV that must never pause.

## Mental Model

```
VG free extents
  └── thin pool LV          (data LV + metadata LV)
        ├── thin LV  (virtual size 100G, allocated 12G)
        ├── thin LV
        └── thin snapshot     (COW against its origin, also thin)

Pool full → every thin LV in the pool gets I/O errors
Metadata full → same outcome, different counter
```

`data_percent` and `metadata_percent` on the pool are the numbers that matter. The virtual size of a thin LV is a lie until the pool can back it.

## Key Commands

```bash
# See pools and their children
lvs -a -o lv_name,vg_name,lv_size,data_percent,metadata_percent,pool_lv,origin

# Create a thin pool (example)
lvcreate -L 100G --thinpool pool0 vg00
# or with separate metadata
lvcreate -L 100G -n pool0 vg00
lvcreate -L 1G  -n pool0_meta vg00
lvconvert --type thin-pool --poolmetadata vg00/pool0_meta vg00/pool0

# Thin LV
lvcreate -V 50G --thinpool vg00/pool0 -n data vg00

# Snapshot
lvcreate -s -n data_snap vg00/data

# Extend the pool before it fills
lvextend -L +20G vg00/pool0
# metadata too if needed
lvextend --poolmetadatasize +256M vg00/pool0

# Monitor
lvs -o lv_name,data_percent,metadata_percent vg00/pool0
```

Auto-extend is possible via `dmeventd` and `thin_pool_autoextend_threshold` in lvm.conf. Know whether it is enabled; do not assume it will save you.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Sudden I/O errors on multiple LVs | Thin pool data or metadata full | `lvs -a` data_percent / metadata_percent |
| Snapshot “did nothing” then pool filled | COW growth not monitored | origin write rate, snapshot age |
| `lvextend` on thin LV succeeds, writes still fail | Pool itself is full | extend the *pool*, not only the LV |
| Metadata percent climbs, data looks fine | Many small extents or long-lived snapshots | metadata_percent; consider larger metadata LV |
| After restore, thin LVs missing | Pool not activated | `vgchange -ay`, `lvs -a` |
| Double thin (cloud + LVM) both full | Two independent overcommits | provider console *and* `lvs` |

## Investigation Tips

- Alert on pool `data_percent` and `metadata_percent`, not on the virtual size of the thin LV.
- Snapshots are temporary. Name them with a date and delete them. A snapshot left “until the backup finishes” that never gets deleted is a future outage.
- Extending a thin LV does not extend the pool. If the pool is the constraint, `lvextend` the pool first.
- Metadata can fill while data space remains. The failure mode is identical (I/O error). Check both columns.
- On a database host, prefer thick LVs unless you have a tested auto-extend and paging on pool usage.
- `lvs -a` shows the hidden pool data and metadata LVs. The ones without a name prefix are the ones that fill.

## Related Notes

- [[LVM Deep Dive]]
- [[Disk Full Runbook]]
- [[XFS Operations]]
- [[ext4 Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A CI farm used thin pools. A long-running snapshot from a “quick test” filled the pool during a Friday deploy. Every builder stalled. We now delete snapshots older than 24 h by timer and page at 80 % pool.
- I extended the thin LV and declared victory. The pool was already at 99 %. Writes continued to fail until the pool itself was extended. The virtual size is not the constraint.
- Metadata exhaustion on a pool with hundreds of small thin volumes looked like random ENOSPC. `metadata_percent` was 100; `data_percent` was 40. The fix was a larger metadata LV, not more data space.
