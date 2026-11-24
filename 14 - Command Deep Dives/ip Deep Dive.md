# ip Deep Dive

## Concept

`ip` (from iproute2) is the modern replacement for the old `ifconfig`/`route`/`arp` suite. It talks to the kernel via netlink and is the single tool for addresses, routes, neighbors, links, rules, and tunnels.

Everything it shows is live kernel state. Persistent configuration lives in NetworkManager, systemd-networkd, or distribution-specific files; `ip` changes are lost on reboot unless something else records them.

## Why it matters

- “The IP is missing” is usually a NetworkManager or networkd race, not a missing `ip` command. You still use `ip` to see what the kernel actually has.
- Policy routing (`ip rule`) is how source-based routing, VPNs, and multi-homed hosts work. A missing rule looks exactly like a missing route.
- Neighbor (ARP/NDP) failures produce “host unreachable” while the route looks fine. `ip neigh` is the first place to look.
- Link state and carrier are independent of IP configuration. `ip link` shows both.

## Mental Model

```
ip link          → devices (eth0, bond0, br0, veth, dummy, …)
ip address       → addresses on those devices (with scope, lifetime)
ip route         → FIB (forwarding table)
ip rule          → RPDB (policy routing database) — selects which table
ip neigh         → ARP / NDP cache
ip tunnel / ip xfrm → overlays and IPsec

Kernel sees the result of all of the above. Userspace daemons (NM, networkd, FRR, keepalived) are the ones that are supposed to put it there.
```

## Key Commands

```bash
# Links
ip link show
ip -d link show eth0          # extra details (VLAN, bond, bridge)
ip link set eth0 up
ip link set eth0 mtu 9000

# Addresses
ip address show
ip -4 addr show scope global
ip addr add 10.0.0.5/24 dev eth0
ip addr del 10.0.0.5/24 dev eth0
ip addr flush dev eth0

# Routes
ip route show
ip route show table main
ip route get 8.8.8.8 from 10.0.0.5   # exact decision
ip route add 10.1.0.0/16 via 10.0.0.1
ip route del default via 10.0.0.1

# Policy routing
ip rule show
ip route show table 100
ip rule add from 10.0.0.5 table 100

# Neighbors
ip neigh show
ip neigh flush all
ip neigh get 10.0.0.1 dev eth0

# Useful filters
ip -br link
ip -br addr
ip -s link show eth0          # stats
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Address disappears after reboot | Only added with `ip`, no persistent config | `ip addr` vs NM/networkd status |
| Route exists, traffic still wrong | Policy rule selects another table | `ip rule`, `ip route get` |
| “Network is unreachable” | No route to destination or source | `ip route get <dst>` |
| Host unreachable, route fine | Stale or missing neighbor | `ip neigh show` |
| Two default routes, random path | No metric or wrong table | `ip route show`, metrics |
| VLAN/bond not up | Parent link down or wrong mode | `ip -d link` |
| MTU blackhole | Path MTU lower than interface | `ip route get`, tracepath |

## Investigation Tips

- Start with `ip route get <destination> [from <source>]`. It shows the exact route the kernel will use, including the source address and interface.
- `ip -br a` and `ip -br l` are the fastest way to see the current picture during an incident.
- If a route “should” be there, check both the main table and any custom tables referenced by `ip rule`.
- Neighbor entries in `FAILED` or `INCOMPLETE` are a layer-2 problem (cable, switch port, wrong VLAN, ARP suppression).
- `ip monitor` is useful for watching what a daemon is doing while you restart it.
- Changes made with `ip` are not saved. Document the persistent method (NM connection, networkd .network file, FRR config) in the same ticket.

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[systemd-networkd]]
- [[NetworkManager Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[ARP and Neighbor Discovery]]
- [[Policy Based Routing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “missing default route” was actually a policy rule that sent traffic from the application source into an empty table. `ip route` looked normal; `ip route get` from the app’s address showed the empty table.
- I added an address with `ip` during an incident and forgot to put it in the NetworkManager connection. The next reboot removed it and the service came back down.
- `ip neigh flush all` on a busy host caused a brief storm of ARP requests and a few seconds of packet loss. Flush only the problematic entry when possible.
