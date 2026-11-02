# Ceph Operational Basics

## Concept

Ceph is a distributed storage system (RADOS) that presents block (RBD), file (CephFS), and object (RGW) on top of OSDs. MONs hold the cluster map; OSDs store the data; MGRs provide metrics and modules. Clients talk to OSDs directly after getting the map from a MON.

## Why it matters

- A single OSD down is usually fine; too many down, or a MON quorum loss, and clients block or lose access.
- Slow requests, PG degradation, or a full OSD look like “the disk is slow” on the client until you look at `ceph -s` and the slow-request log.
- Recovery and backfill can saturate the network or the remaining disks and make a bad situation worse.
- Linux-side issues (clock skew, MTU, firewall, disk errors) are frequent root causes of Ceph problems; the Ceph commands only tell you the symptom.

## Mental Model

```
client
    → MON (cluster map, auth)
    → OSD(s) that hold the PGs for the object
        → BlueStore (or FileStore) on the local disk

PGs (placement groups) are the unit of replication and recovery.
CRUSH map decides which OSDs get which PGs.
Quorum of MONs is required for map updates; clients can continue with a cached map for a while.
```

Clock skew between nodes breaks MON elections and can stall everything. Jumbo frames or a firewall that drops Ceph ports (6789, 6800-7300, …) produce timeouts that look like OSD failures.

## Key Commands

```bash
# Cluster health
ceph -s
ceph health detail
ceph osd tree
ceph osd df
ceph pg stat
ceph pg dump_stuck

# Slow requests / logs
ceph daemon osd.N dump_historic_ops
journalctl -u ceph-osd@N -n 50

# MON / MGR
ceph mon stat
ceph mgr stat

# Client side (RBD example)
rbd info pool/image
rbd du pool/image
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `HEALTH_ERR` / clients blocked | MON quorum lost, or too many OSDs down | `ceph -s`, `ceph mon stat`, clock skew (`chronyc tracking`) |
| Slow requests / high latency | Disk errors, network drops, or recovery load | OSD logs, `iostat`, `ethtool -S`, `ceph pg dump_stuck` |
| PGs stuck unclean / undersized | OSD down, or CRUSH weight / failure domain issue | `ceph osd tree`, `ceph pg ls-by-state` |
| One OSD full, others fine | Uneven CRUSH or a nearly-full disk | `ceph osd df`, disk usage on the node |
| Recovery never finishes | Backfill too slow, or a flapping OSD | `ceph -s` recovery counters, OSD logs for crashes |
| Client timeouts after network change | MTU mismatch or firewall on Ceph ports | `ping -M do -s 8972`, `ss` / firewall rules |

## Investigation Tips

- Start with `ceph -s` and `ceph health detail`. The detail line usually names the PGs or OSDs that matter.
- Check clocks on every MON and OSD node before you chase Ceph bugs. A few seconds of skew is enough to disrupt elections.
- When an OSD is marked down, look at the node: disk errors (`dmesg`, SMART), OOM, or the OSD process itself. Ceph is often the messenger.
- Recovery load can look like a client performance problem. If `ceph -s` shows recovery/backfill, that is the current bottleneck.
- Network: Ceph is chatty. Packet loss or a too-small MTU on the cluster network produces slow requests that no amount of OSD tuning will fix.
- For RBD clients, the kernel log on the client (`dmesg | grep rbd`) often has the timeout or I/O error that the application only reported as “disk slow”.

## Related Notes

- [[SMART and Disk Health]]
- [[Time Sync and chrony]]
- [[iostat Deep Dive]]
- [[Bonds Bridges VLANs and ethtool]]
- [[SCSI Error Handling]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A cluster went `HEALTH_ERR` with no obvious OSD down. MON clocks had drifted after a hypervisor maintenance window. Fixing chrony restored quorum; no data was lost.
- Clients saw multi-second latency. `ceph -s` showed recovery from a disk that had been replaced. Pausing recovery (temporarily) confirmed the cause; the new disk was fine, the recovery was the load.
- An OSD kept flapping. SMART showed pending sectors; the Ceph log only said “suicide timeout”. The disk was the root cause; replacing it stopped the flaps.
