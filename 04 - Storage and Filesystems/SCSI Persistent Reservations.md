# SCSI Persistent Reservations

## Concept

SCSI persistent reservations (PR) let a host register a key and reserve a LUN so that only registered or reserved initiators can perform I/O. They survive SCSI bus resets (unlike older SCSI-2 reservations) and are the mechanism clustered software (Pacemaker, multipath, some databases, VMware) uses to fence a node that has lost contact.

`sg_persist` (from sg3_utils) is the usual tool. The reservation lives on the LUN, not on the host.

## Why it matters

- A leftover reservation from a crashed node blocks every other host from writing. The LUN looks healthy; I/O just fails with reservation conflict.
- Multipath and clustering both use PR. Misunderstanding who holds the reservation turns a failover into a split-brain or a complete outage.
- Clearing a reservation you do not own is a data-corruption risk if the other node is still writing.
- Not every LUN supports PR the same way (or at all). A device that worked with reservations in one array fails on another.

If multipath shows paths active but every write returns an error, check reservations before you blame the filesystem.

## Mental Model

```
Initiator registers a key (unique per host or path)
    → issues a reservation (Write Exclusive, Exclusive Access, etc.)
    → only matching key holders can I/O
    → preemption or clear is required to take over

Types (common):
  Write Exclusive          — only the reservation holder writes
  Exclusive Access         — only the holder does any I/O
  Write Exclusive, registrants only — registered hosts may write

PR survives target reset. Older reservations did not.
```

In a cluster the surviving node preempts the dead node's key. An operator who `sg_persist --clear` without coordination races the cluster.

## Key Commands

```bash
# What reservations exist on a LUN (use the multipath map or a path)
sg_persist -d /dev/mapper/mpatha -i
sg_persist -d /dev/sdb -r          # read keys and reservation

# Register a key (example; do not invent keys in production)
sg_persist -d /dev/mapper/mpatha --out --register --param-rk=0 --param-sark=0x1

# Reserve (Write Exclusive)
sg_persist -d /dev/mapper/mpatha --out --reserve --param-rk=0x1 --prout-type=5

# Release
sg_persist -d /dev/mapper/mpatha --out --release --param-rk=0x1 --prout-type=5

# Preempt (cluster-style takeover)
sg_persist -d /dev/mapper/mpatha --out --preempt --param-rk=0x2 --param-sark=0x1 --prout-type=5

# Clear everything (last resort, coordinated)
sg_persist -d /dev/mapper/mpatha --out --clear --param-rk=0x1

# Device support
sg_persist -d /dev/sdb -c          # capabilities
```

`--prout-type=5` is Write Exclusive. Check `sg_persist -h` and the array docs for the exact type your cluster expects.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| I/O fails with "reservation conflict" | Another host holds PR | `sg_persist -r`, cluster status |
| Failover hangs, new node cannot write | Old reservation not preempted | cluster logs, `sg_persist -i` |
| LUN usable from one host only | Exclusive reservation left behind | `sg_persist -r` on the map |
| Works until path failure, then stuck | Reservation tied to a path that died | multipath + PR key registration per path |
| Clear "fixed" it, then corruption reports | Two nodes wrote after clear | cluster fencing logs, timestamps |
| `sg_persist` says not supported | LUN or array does not do PR | `-c`, array firmware, use a different fencing method |

## Investigation Tips

- Always run `sg_persist` against the multipath map (`/dev/mapper/...`), not a single `/dev/sdX`, unless you are debugging a specific path.
- `sg_persist -r` shows registered keys and the current reservation holder. Match the key to the host (cluster configs usually document the key format).
- Do not `--clear` while any node might still be writing. Prefer the cluster's own preempt/fence action.
- After a node crash, the surviving node should preempt. If it does not, the cluster is misconfigured or the array rejected the preempt. Check both sides before you clear by hand.
- Some arrays require reservations to be registered on every path. A path that appears in multipath but was never registered will fail when it becomes active.
- Document the key each host uses. An undocumented key that appears after an incident is almost always a leftover from a previous cluster or a manual test.

## Related Notes

- [[Device Mapper Multipath]]
- [[iSCSI Operations]]
- [[LVM Deep Dive]]
- [[High Availability]]
- [[Keepalived and VRRP]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A multipath LUN showed all paths active and `multipath -ll` was clean. Every write returned reservation conflict. A crashed node had left a Write Exclusive reservation. The cluster preempt would have fixed it; the manual clear I almost ran would have let both nodes write.
- Path registration was incomplete. When the preferred path failed, the standby path had no key and I/O stopped even though multipath marked it active. Register-on-all-paths is now part of the build checklist.
- I treated PR like a filesystem lock. It is a SCSI-level fence. The application never sees the lock; it just gets I/O errors until the reservation is gone.
