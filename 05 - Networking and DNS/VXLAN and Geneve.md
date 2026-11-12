# VXLAN and Geneve

## Concept

VXLAN (Virtual Extensible LAN) and Geneve are UDP-based overlay encapsulations that carry Ethernet frames (or more) across an IP underlay. They create isolated L2 domains without requiring the underlay switches to understand the customer VLANs.

VXLAN uses UDP port 4789 and a 24-bit VNI. Geneve is more extensible (variable options) and is the preferred encapsulation in many modern controllers (e.g. OVN, some cloud fabrics). Both hide the tenant MAC/IP inside an outer UDP packet whose source/destination are the VTEPs.

## Why it matters

- A “works on the hypervisor, broken between hosts” problem is almost always underlay MTU, firewall, or VTEP reachability.
- Overlay MTU is 50 bytes smaller than the underlay. Jumbo frames that are not end-to-end produce silent black holes for large packets.
- Flooding of unknown unicast / broadcast / multicast is controlled by the control plane (or by head-end replication). A missing control plane looks like “ARP never completes”.
- Geneve option parsing or firewall rules that only know VXLAN port 4789 drop traffic.

## Mental Model

```
Tenant VM
  → bridge / OVS on hypervisor
    → VTEP encapsulates (outer IP = this host, UDP 4789 or Geneve)
      → underlay routed IP network
        → remote VTEP decapsulates
          → remote bridge → remote VM

Control plane (EVPN, OVN, or static) tells each VTEP which remote VTEPs own which MACs/IPs.
No control plane = flooding or blackhole.
```

## Key Commands

```bash
# See VXLAN interfaces
ip -d link show type vxlan
bridge fdb show | head
ip neigh show

# Underlay reachability between VTEPs
ping -M do -s 1472 <remote-vtep-ip>   # forces DF, finds MTU
traceroute <remote-vtep>

# tcpdump the underlay (adjust iface and VNI)
tcpdump -ni eth0 udp port 4789 -c 20
# or geneve
tcpdump -ni eth0 udp port 6081

# OVS specific
ovs-vsctl show
ovs-ofctl dump-flows br-int | head
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Small pings work, large transfers fail | MTU mismatch (overlay vs underlay) | ping -M do -s, ethtool, switch MTU |
| ARP never resolves across hosts | no control plane or FDB missing | bridge fdb, controller logs, underlay UDP |
| Works on same host, fails cross-host | VTEP IP unreachable or firewall on 4789 | ping VTEP, iptables/nft, tcpdump |
| One direction only | asymmetric underlay or policy routing | traceroute both ways, reverse path |
| Geneve traffic dropped | firewall only allows 4789 | tcpdump, firewall rules for 6081 |
| High CPU on hypervisor | software encap + high PPS | ethtool -S, offloads, consider hardware VTEP |

## Investigation Tips

- Always verify underlay MTU first. Set overlay MTU to underlay-minus-50 (or use jumbo end-to-end and test with DF bit).
- Confirm the VTEP IP is the one the control plane expects. A secondary IP or bond MAC change breaks the FDB.
- tcpdump on the physical NIC shows the outer header; tcpdump inside the VM or on the bridge shows the inner. Both are useful.
- Multicast underlay (classic VXLAN) requires IGMP snooping to be correct; most modern deployments use unicast head-end replication or EVPN.
- See [[Bonds Bridges VLANs and ethtool]] for the underlay NIC and [[Path MTU Discovery and Blackholes]] for the MTU symptoms.

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[Path MTU Discovery and Blackholes]]
- [[Network Namespaces]]
- [[tcpdump Deep Dive]]
- [[Routing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random large-file copy hangs” across two hypervisors was an underlay switch still at 1500 while the hosts had jumbo. The DF bit never came back; the overlay simply black-holed anything over ~1450.
- After a bond failover the VTEP IP moved but the controller still advertised the old MAC. The FDB on the remote side pointed at a dead address until we forced a relearn.
