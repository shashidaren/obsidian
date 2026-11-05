# ip route Deep Dive

## Concept

The kernel forwarding information base (FIB) is what actually forwards packets. `ip route` (and `ip -6 route`) shows and manipulates it. Routes live in tables. The `main` table is the default; policy routing (`ip rule`) can select another table first.

A route is more than a next hop: it has a prefix, a device, a scope, a protocol (who installed it), a metric, and optionally a source address, an MTU, or a realm.

`ip route get` is the query that answers “what would happen to a packet to this destination (from this source, on this interface)?”

## Why it matters

- “The network is down” is frequently a missing route, a wrong metric, or a rule that sends the lookup into an empty table.
- Cloud, VPN, container, and FRR all inject routes. Leftover routes from a previous configuration survive and black-hole traffic.
- Asymmetric routing (reply leaves a different interface than the request arrived on) breaks stateful firewalls and conntrack even when both directions have *some* route.
- A connected route for the local subnet must exist in the same table that policy routing selects. Otherwise local traffic to the gateway’s own subnet fails.

## Mental Model

```
Packet (dst, src, iif, mark, uid, …)
    → ip rule (priority order) selects a table
        → longest-prefix match in that table
            → next hop + device + source selection

Scopes:
  host      local addresses
  link      connected subnet
  global    everything else

Protocols (who installed it):
  kernel    connected / local
  boot      from ip route add at boot scripts
  static    manual
  dhcp / ra
  zebra / bgp / ospf   (FRR)
  redirect  ICMP redirects
```

`ip route show` without a table shows only `main`. That is why “there is no route” complaints are often wrong — the route is in table 100 or a VRF.

## Key Commands

```bash
# Main table
ip route
ip -6 route

# Everything
ip route show table all
ip route show table 100
ip rule show

# The question that matters
ip route get 8.8.8.8
ip route get 8.8.8.8 from 10.1.1.50
ip route get 8.8.8.8 from 10.1.1.50 iif eth1

# Add / delete (temporary)
ip route add 10.2.0.0/16 via 10.1.1.1 dev eth0
ip route add default via 10.1.1.1 metric 100
ip route del 10.2.0.0/16

# Replace / change
ip route replace default via 10.1.1.2

# VRF
ip route show vrf mgmt
ip route get 1.1.1.1 vrf mgmt

# Who owns it
ip route show proto zebra
ip route show proto dhcp
```

Persist routes in NetworkManager, netplan, systemd-networkd, or FRR. A raw `ip route add` disappears on reboot or when the interface is reconfigured.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No route to host | Missing prefix or default | `ip route get <dst>` |
| Works from one source IP, fails from another | Policy routing / wrong table | `ip route get … from <src>`, `ip rule` |
| Reply packets dropped by far-side firewall | Asymmetric path / wrong source | `ip route get` both ways, capture |
| Route present in `vtysh` but not used | Different table or rule | `ip route show table all` |
| Default route flaps | DHCP vs static fight, or metric | `ip route`, NM/networkd logs |
| Connected subnet unreachable via policy table | Table lacks the link route | `ip route show table N` |
| IPv6 works, IPv4 does not (or reverse) | Separate tables / RA | `ip -6 route`, `ip -6 rule` |
| Route disappears after reboot | Not persisted | NM connection, .network file, FRR |

## Investigation Tips

- Start with `ip route get <destination>`. It shows the table, the next hop, the device, and the source address the kernel would choose.
- Always look at `ip rule` and `ip route show table all` on any multi-homed, container, or cloud host. The main table is only part of the story.
- Compare a working twin. Extra routes and rules are a common leftover from cloud-init, a CNI, or an old VPN.
- After you change a route, existing conntrack entries may keep the old path. `conntrack -D` (carefully) or a new flow is required to observe the change.
- Metric matters when two defaults exist. The lower metric wins. DHCP and a static route often collide this way.
- VRF routes are invisible to a lookup that does not specify the VRF. `ip route get` without `vrf` looks in the default VRF.
- See [[Policy Based Routing]] for the rule side and [[FRR and Dynamic Routing]] when the routes are dynamic.

## Related Notes

- [[Policy Based Routing]]
- [[FRR and Dynamic Routing]]
- [[NetworkManager Deep Dive]]
- [[systemd-networkd]]
- [[Bonds Bridges VLANs and ethtool]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `ip route` looked perfect. Traffic from the storage IP still left via the management default because an `ip rule` selected table 100, and table 100 had no default. `ip route get <dst> from <storage-ip>` showed it in one line.
- A cloud-init run left a blackhole route for the old VPC CIDR. New instances in that range were unreachable until `ip route show table all` revealed the leftover.
- I added a static default with a better metric and forgot to persist it. The next DHCP renew restored the old gateway and the outage returned at 03:00.
