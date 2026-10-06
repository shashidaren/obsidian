# Bonds Bridges VLANs and ethtool

## Concept

These are the L2 pieces under `ip addr`:

- A **bond** (or team) aggregates NICs into one logical device. Mode decides whether you get failover only, or also more bandwidth, and what the switch must agree to.
- A **bridge** is a virtual switch. Ports (physical NICs, veth, VMs) learn MACs and forward frames. Routing happens on the bridge device only if it has an address.
- A **VLAN subinterface** (`eth0.100` or `bond0.100`) tags 802.1Q. The switch port must be a trunk that allows that VLAN.
- **ethtool** reads what the NIC and driver believe: link, speed, duplex, ring sizes, offloads, and hardware error counters.

`macvlan` gives a container its own MAC on the parent NIC. It is not a bridge. The host and the macvlan often cannot talk to each other without `macvlan` mode bridge or a hairpin.

## Why it matters

- A bond that is up on the host and down on the switch (or the reverse mode) drops half the traffic and looks like random loss.
- Bridging a NIC that is also the management address, without moving the IP onto the bridge, black-holes the host.
- VLAN mismatch is “link is up, ARP never completes”.
- NIC offloads (GRO/TSO/LRO) make tcpdump lie about segment size. Checksum offload makes captures look corrupt when they are not.
- Ring-buffer overruns and pause frames show up in `ethtool -S` before they show up in application latency graphs.

## Mental Model

```
NIC (eth0, eth1)          speed/duplex, rings, offloads, link
    → bond0               mode 1 active-backup, mode 4 802.3ad, …
        → bond0.100       VLAN tag 100
            → br0         learn/forward, optional IP here
                → veth / tap / VM

ethtool -S eth0           hardware counters (errors, drops, fifo)
ip -s link                kernel drops, different counter
ip -d link show bond0     bond mode, slaves, hash
```

Bond modes worth remembering:

| Mode | Name | Switch requirement | What you get |
|------|------|--------------------|--------------|
| 0 | balance-rr | usually none; can reorder | stripes packets; ugly with TCP |
| 1 | active-backup | none | failover, one NIC’s bandwidth |
| 2 | balance-xor | static; no LACP | hash pinned to a slave |
| 4 | 802.3ad | LACP on the switch | aggregate, hash per flow |
| 5 | balance-tlb | none | adaptive TX; RX on one slave |
| 6 | balance-alb | none | TLB plus RX rewrite; quirky |

Mode 4 with only one side running LACP is a split brain, not a bond. `cat /proc/net/bonding/bond0` shows aggregator id and whether the partner is in sync.

## Key Commands

```bash
# What the kernel thinks the bond is
cat /proc/net/bonding/bond0
ip -d link show bond0
ip -br link

# Bridge forwarding table and ports
bridge link
bridge fdb show
ip -d link show br0

# VLAN devices
ip -d link show eth0.100
bridge vlan show          # if using bridge VLAN filtering

# Link, speed, duplex, pause
ethtool eth0
ethtool -a eth0           # pause/flow control

# Hardware counters — look at error, drop, fifo, crc, missed
ethtool -S eth0 | grep -E -i 'err|drop|fifo|crc|miss|discard|fail'

# Ring buffers (raise rx if rx_missed / fifo climbs)
ethtool -g eth0
ethtool -G eth0 rx 4096

# Offloads — the ones that confuse captures
ethtool -k eth0 | grep -E 'tcp-segmentation|generic-receive|large-receive|rx-checksum|tx-checksum'

# Temporary, for a capture only
ethtool -K eth0 gro off gso off tso off
# turn them back on after; do not leave a 10G NIC with TSO off as a "fix"

# Link flaps
dmesg -T | grep -i -E 'eth0|bond|link up|link down' | tail
ip -s link show eth0
```

Persistent config is netplan, NetworkManager, or networkd. `ip link add` and `ethtool -G` die on reboot unless something reapplies them.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| One direction loss, “random” TCP stalls | bond hash or half the slaves down | `/proc/net/bonding/bond0`, switch LAG |
| Mode 4, throughput of one NIC | LACP not up; single aggregator | partner mac, aggregator id |
| Host unreachable after bridge change | IP left on the slave | `ip addr`; address belongs on `br0` |
| VLAN up, no ARP reply | tag not allowed, or native VLAN mismatch | `ip -d link`, switch trunk, tcpdump `-e` |
| Capture shows bad checksums | rx/tx checksum offload | `ethtool -k`; Wireshark “offload” note |
| Giant segments in tcpdump | TSO/GRO | `-k`, or disable for the capture window |
| `rx_missed_errors` climbing | ring too small or CPU not polling | `ethtool -S`, `-g`, irq |
| Link flaps every few minutes | cable, duplex mismatch, NIC firmware | `ethtool` speed/duplex, dmesg |
| macvlan container cannot reach host | mode private/vepa by design | mode, or a bridge instead |
| Failover did nothing | miimon too slow, or both slaves on one switch path | bonding opts, `cat /proc/net/bonding` |

## Investigation Tips

- Read `/proc/net/bonding/bond0` before you redraw the network. “Slave down” and “partner not in sync” are the two lines that explain most bond tickets.
- Speed and duplex should be negotiated on both sides. A hard-coded 1000/full against an auto peer is still a classic flap source.
- `ethtool -S` hardware drops and `ip -s link` kernel drops are different. Quote which one you mean.
- For VLAN proof, `tcpdump -ni eth0 -e vlan` on the parent. If tags are missing, the switch is not trunking. If tags are present and `eth0.100` is quiet, the subinterface is wrong.
- Disable GRO/TSO only for the capture. Leaving them off on a busy NIC raises CPU and can become the outage.
- Bridge FDB entries that flap between ports are a loop. Stop forwarding before you add more interfaces.
- Do not put the only management NIC into a bond or bridge you cannot reach out-of-band. Console first.
- Cloud “bonds” are often a single virtual NIC. `ethtool` still works for stats; LACP to the hypervisor usually does not.

## Related Notes

- [[ip Command Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Routing]]
- [[tcpdump Deep Dive]]
- [[ARP and Neighbor Discovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A mode-4 bond showed both slaves up and still passed one gigabit. The switch LAG was not configured; both links were independent access ports. `/proc/net/bonding` said the partner was not in sync. The host config was never the bug.
- tcpdump “checksum incorrect” on every packet was GRO/checksum offload. The application was fine. I stopped filing NIC firmware tickets for that pattern.
- Moving a management address onto a bridge without a console session locked me out. The IP stayed on `eth0`, which no longer received frames once it became a bridge port.
