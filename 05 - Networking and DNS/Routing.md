# Routing

## Concept

Routing decides where to send a packet next based on destination address (and optionally source, marks, or policy). On a Linux host this is primarily the kernel FIB (forwarding information base): connected routes, the default gateway, static routes, and any routes installed by routing daemons or control planes (cloud metadata, BGP, etc.).

## Why it matters

- Wrong or missing default route → “no internet” or no path to other subnets
- Asymmetric routing (different forward and return paths) breaks stateful firewalls and makes troubleshooting confusing
- Multiple interfaces / multi-homing needs policy routing (`ip rule`) or careful metrics; otherwise traffic leaves the wrong NIC
- Cloud and container environments inject routes dynamically; a stale route survives long after the path is gone

Selective failures (“only some destinations”) are often routing or MTU, not “the network is down”.

## Mental Model

```
For each packet:
  1. Is destination on a connected subnet? → send via that interface (ARP/ND)
  2. Else match longest prefix in the routing table
  3. Else use default route (0.0.0.0/0 or ::/0)
  4. Policy rules (ip rule) can select alternate tables first

ip route get <dst>   → kernel’s answer for “how would I send this?”
```

Tables: `main` (usual), `local` (owned addresses), custom tables for policy routing.

## Key Commands

```bash
# Show routes
ip route show
ip route show table main
ip route show table all
ip -6 route show

# The single most useful question
ip route get 1.1.1.1
ip route get 10.20.30.40 from 10.0.0.5 iif eth0

# Default gateway
ip route | grep default

# Add / delete a route (not persistent)
ip route add 192.0.2.0/24 via 10.0.0.1 dev eth0
ip route del 192.0.2.0/24

ip route replace default via 10.0.0.1 dev eth0

# Policy routing
ip rule show
ip route show table 100
ip rule add from 10.0.0.50 table 100
ip route add default via 10.0.0.1 table 100

# Neighbours (next hop must resolve)
ip neigh show
ip neigh show dev eth0

# Quick path tests
ping -c 3 <gateway>
ping -c 3 <destination>
traceroute -n <destination>
tracepath <destination>           # also shows MTU black holes
```

Persistent configuration lives in NetworkManager, netplan, systemd-networkd, or distro ifcfg scripts — not in a one-off `ip route add`.

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| No connectivity to any remote host   | Missing/wrong default route                | `ip route`, `ip route get 1.1.1.1`                |
| Local subnet works, others fail      | No default or wrong gateway                | Same as above; ping gateway                       |
| Some destinations fail only          | More specific bad route or blackhole       | `ip route get <dst>`, compare with working host   |
| Works one direction only             | Asymmetric routing / return path firewall  | Capture both sides; check remote routes           |
| Wrong interface used                 | Metric order, policy rule, source address  | `ip route get` from specific src; `ip rule`       |
| Intermittent after failover          | Stale route or ARP to old next hop         | `ip neigh`, routing daemon / cloud agent logs     |
| Connected but PMTU problems          | ICMP blocked, wrong MTU on path            | `tracepath`, `ping -M do -s <size>`               |

## Investigation Tips

- Prefer `ip route get <addr>` over reading the whole table when debugging a specific failure — it shows the chosen path, device, and next hop.
- Always verify the next hop is reachable (`ping` gateway, `ip neigh`) before chasing distant destinations.
- Compare routing tables on a working and broken host; differences in metrics or missing prefixes are common after automation drift.
- In multi-homed hosts, check source address selection: replies may leave via a different interface than requests arrived on.
- Containers and network namespaces have their own tables — `ip route` inside the namespace (or `ip netns exec`) is required.
- After DHCP or cloud route changes, look for duplicate defaults or higher-metric leftovers.
- Document intentional static routes and policy rules; they are invisible to people who only know “default gateway”.

## Related Notes

- [[ip Command Deep Dive]]
- [[ARP and Neighbor Discovery]]
- [[TCP IP Troubleshooting Model]]
- [[Firewall and NAT]]
- [[ss Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
