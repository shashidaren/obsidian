# iSCSI Operations

## Concept

iSCSI exports a block device over TCP. The initiator (client) sees a LUN as `/dev/sdX` (or a multipath map). The target (server or array) presents the LUN. Sessions, portals, and IQNs identify the connection.

Most production use is against a storage array; the host is the initiator. Multipath is almost always required.

## Why it matters

- A session drop looks like a disk disappearing. Applications hang or go read-only.
- CHAP authentication and IQN ACLs are the usual “why can’t I see the LUN” problems.
- Multipath must sit on top of the iSCSI devices; using the raw `/dev/sdX` breaks the moment one path fails.
- Network congestion or MTU mismatch on the storage network produces high latency that looks like a slow disk.

Treat the iSCSI network as a storage fabric. Do not share it with general traffic if you can avoid it.

## Mental Model

```
Initiator (host)
  iscsiadm → session to portal (IP:3260)
    → LUN appears as /dev/sdX
      → multipath map /dev/mapper/…
        → LVM / filesystem

Target (array or Linux target)
  IQN + LUN + ACL (initiator IQN or CHAP)
```

## Key Commands

```bash
# Discovery and login
iscsiadm -m discovery -t sendtargets -p 10.0.0.10
iscsiadm -m node -T iqn.2020-01.com.example:lun1 -p 10.0.0.10 -l

# Sessions
iscsiadm -m session -P 3
iscsiadm -m node -T <iqn> -p <portal> -u   # logout

# Config
cat /etc/iscsi/initiatorname.iscsi
ls /etc/iscsi/nodes/

# After login
lsblk
multipath -ll
```

Persistent login is normally handled by the iscsi service and the node records under `/etc/iscsi/nodes`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Discovery empty | wrong portal, firewall, target down | `iscsiadm discovery`, tcpdump 3260 |
| Login fails | CHAP, IQN ACL, initiator name mismatch | initiatorname.iscsi, target logs |
| LUN appears then vanishes | session timeout, network blip | `iscsiadm session`, dmesg |
| High latency, low throughput | storage network congestion or MTU | `iostat`, `ethtool`, storage switch |
| Works until reboot | iscsi service not enabled, or node not marked startup | systemctl, node startup mode |
| Multipath sees one path | second portal not logged in | session list, zoning-equivalent |

## Investigation Tips

- Confirm the initiator IQN matches what the target expects. A regenerated initiatorname after a reinstall is a classic outage.
- Use a dedicated storage VLAN or physical network. Jumbo frames must match end-to-end or you get silent fragmentation pain.
- Multipath first: once the LUN is visible, put it under multipath before you create the filesystem or PV. See [[Device Mapper Multipath]].
- Session recovery is usually automatic. If it is not, check `node.session.timeo.replacement_timeout` and the network path.
- On Linux targets (LIO/targetcli) the ACL and portal configuration live in `/sys/kernel/config/target`. Mis-matched ACLs produce empty discovery.

## Related Notes

- [[Device Mapper Multipath]]
- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[Disk I/O and Latency]]
- [[Networking and DNS/Routing|Routing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An array firmware upgrade dropped all sessions. The hosts recovered automatically except one whose initiator IQN had been changed during a rebuild. The LUN was there; the ACL rejected the new name.
- Jumbo frames on the storage switches but standard MTU on the host NICs produced exactly the “small I/O fine, large I/O slow” pattern. `ethtool` and a packet capture ended it.
- We created the filesystem on `/dev/sdb` before multipath was configured. The first path failure took the filesystem with it. Now the runbook requires the mapper device.
