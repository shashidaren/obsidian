# Bonds Bridges VLANs and ethtool

## Concept

Bonding aggregates two or more physical NICs into one logical interface for redundancy or bandwidth. Bridges are in-kernel L2 switches (used by VMs, containers, or to join physical and virtual ports). macvlan creates a virtual NIC with its own MAC address on a parent, without a full learning bridge. VLANs (802.1Q) tag frames on a parent interface so multiple logical networks share one physical link.

ethtool is the tool that talks to the physical NIC driver: link speed/duplex, ring buffers, offloads, and hardware statistics including error and drop counters.

## Why it matters

- Link flaps, wrong bond mode, or VLAN mismatch look like “the network is down” while `ip addr` looks fine.
- Captures on a bond or bridge see a different view than the wire; offloads on the slave still lie to tcpdump.
- Ring buffer exhaustion shows as drops in `ethtool -S` or `/proc/net/dev` while the interface stays UP.
- Active-backup vs 802.3ad is a switch configuration contract. Getting it wrong produces silent blackholes or flaps.

## Mental Model

```
physical NICs (slaves)
    → bond (mode 1 active-backup | mode 4 802.3ad | …)
        → optional VLAN subinterfaces (eth0.10 or bond0.10)
            → bridge or macvlan (for VMs/containers)
                → IP address / routes
```

Bond modes that matter in production:

| Mode | Name | Behaviour | Switch requirement |
|------|------|-----------|--------------------|
| 0 | balance-rr | Round-robin | None (but reordering hurts TCP) |
| 1 | active-backup | One active, others standby | None |
| 4 | 802.3ad | LACP aggregation | Switch must run LACP |
| 5/6 | balance-tlb/alb | Adaptive transmit/receive | None |

Bridge vs macvlan: a bridge learns MACs and floods unknowns; macvlan is simpler and does not require the host to process every frame for the guest. Prefer macvlan when you only need isolation and own MAC; use a bridge when you need the host and guests on the same L2 or to attach multiple VMs.

## Key Commands

```bash
# Live bond state
cat /proc/net/bonding/bond0
ip -d link show bond0
cat /sys/class/net/bond0/bonding/mode
cat /sys/class/net/bond0/bonding/slaves

# Physical link and negotiation
ethtool eth0
ethtool -i eth0          # driver
ethtool -S eth0 | grep -E -i 'err|drop|fifo|miss|disc'
ethtool -g eth0          # ring sizes
ethtool -k eth0          # offloads

# Temporary changes (lost on reboot unless persisted)
ethtool -s eth0 speed 10000 duplex full autoneg off
ethtool -G eth0 rx 2048 tx 2048
ethtool -K eth0 tso off gro off   # only for a clean capture

# VLAN and bridge
ip link add link eth0 name eth0.10 type vlan id 10
ip link add name br0 type bridge
ip link set eth0 master br0
bridge link show
bridge vlan show

# macvlan
ip link add link eth0 name macvlan0 type macvlan mode bridge
```

Persist ring/offload changes via NetworkManager, systemd-networkd, or a udev rule. Bond config lives in the same place as the rest of the network config.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Bond UP, no traffic after failover | Wrong mode or switch not matching | `/proc/net/bonding`, switch LACP status |
| 802.3ad slaves different Aggregator ID | LACP not negotiated | Partner Mac all zeros, switch port not in LAG |
| Link flaps every few seconds | Cable, SFP, or autoneg fight | `ethtool`, `dmesg`, `journalctl -k` |
| Drops under burst, interface still UP | Ring buffer too small | `ethtool -S` / `ip -s link`, `ethtool -g` |
| tcpdump shows bad checksums / giant packets | Offloads on the slave | `ethtool -k` on the physical NIC |
| VLAN traffic blackhole | Tag mismatch or untagged vs tagged | `bridge vlan`, switch port mode |
| One slave always preferred | primary_reselect or miimon too aggressive | bonding sysfs, switch logs |
| Capture on bond misses traffic | Looking at wrong device | Capture on slave or use a span |

## Investigation Tips

- `cat /proc/net/bonding/bond0` first. Same Aggregator ID + Partner Mac not zero means LACP is up. Different IDs means the switch and host disagree.
- Check the physical slave with `ethtool`, not only the bond. Speed/duplex and error counters live on the slave.
- Ring drops are often invisible in basic `ip -s` until you look at `ethtool -S` or the driver-specific counters. Increase RX ring before you blame the application.
- For a one-off capture that must show wire-size packets, disable TSO/GRO on the slave, capture, then re-enable. Do not leave them off.
- Link flaps: `journalctl -k -b` and `watch -n1 ethtool eth0`. Persistent flaps are almost always cable, SFP, or a switch port that is still negotiating.
- Active-backup needs no switch config; 802.3ad requires the switch ports to be in an LACP LAG. Mixing them produces blackholes that only appear under load.
- After any bond or VLAN change, confirm the path with `ip route get` to a real destination and a short ping before you close the ticket.

## Related Notes

- [[NIC Offloads TSO GSO GRO]]
- [[ip Command Deep Dive]]
- [[tcpdump Deep Dive]]
- [[NetworkManager Deep Dive]]
- [[systemd-networkd]]
- [[Path MTU Discovery and Blackholes]]
- [[VXLAN and Geneve]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random packet loss under load” on a 10G storage network was an RX ring of 256. `ethtool -S` showed the drops; raising it to 2048 ended the incident. The application was never the problem.
- Two hosts in the same rack could not talk after a switch replacement. One side was still active-backup, the other had been moved to 802.3ad. `/proc/net/bonding` showed the mismatch in seconds.
- Captures taken on the bond device looked clean while the wire was full of retransmits. The offloads were on the slave. I now always check `ethtool -k` on the physical interface before I trust a host-side capture.
