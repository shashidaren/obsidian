# Routing

## Concept

Routing is the kernel deciding the *next hop* for a packet from the forwarding information base (FIB): connected prefixes, static routes, the default gateway, and anything a control plane (DHCP, cloud agent, BGP, kube-proxy) installed.

`ip route get <dst>` is the kernel’s answer to “how would I send *this* packet?” Reading the whole table is how you learn the policy. `get` is how you debug a specific failure.

## Why it matters

- Missing or wrong default route is “no internet” and “no path to the other subnet”
- Asymmetric paths break stateful firewalls and conntrack; symptoms look random
- Multi-homed hosts need policy routing (`ip rule`) or they leave via the wrong NIC with the wrong source address
- Cloud and container runtimes inject routes. Stale routes outlive the path they described
- Selective failure (“only some destinations”) is often routing or MTU, not a dead NIC

## Mental Model

```
For each packet:
  1. Destination is a local address?          → local delivery
  2. Destination is on a connected prefix?    → ARP/ND that neighbour
  3. Longest matching prefix in the chosen table
  4. Default route (0.0.0.0/0 or ::/0)
  5. ip rule can pick a *different table* before 3–4

Tables you will actually meet:
  local   — addresses this host owns
  main    — the table everyone means by “the route table”
  NNN     — policy-routing tables (from SOURCE lookup table NNN)
```

Source address selection matters as much as the outbound interface. Replies that leave via another NIC are the usual “it pings but the app fails” on dual-homed boxes.

A next hop that does not resolve in the neighbour table is not a route problem yet — see [[ARP and Neighbor Discovery]].

## Key Commands

```bash
# Show what is installed
ip route show
ip route show table main
ip route show table all
ip -6 route show
ip rule show

# The question you actually have
ip route get 1.1.1.1
ip route get 10.20.30.40
ip route get 10.20.30.40 from 10.0.0.5 iif eth0

# Default
ip -4 route show default
ip -6 route show default

# Temporary changes (will not survive reboot / NetworkManager)
ip route add 192.0.2.0/24 via 10.0.0.1 dev eth0
ip route replace default via 10.0.0.1 dev eth0
ip route del 192.0.2.0/24

# Policy routing sketch
ip rule add from 10.0.0.50 table 100
ip route add default via 10.0.0.1 table 100
ip route show table 100

# Next hop must exist on L2
ip neigh show
ping -c 2 <gateway>

# Path + MTU
traceroute -n <dst>
tracepath <dst>
ping -M do -s 1472 -c 2 <dst>     # DF, Ethernet-sized payload
```

Persist routes in NetworkManager, netplan, systemd-networkd, or the cloud router — not in a one-off `ip route add` on a running box.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Nothing remote works | Missing/wrong default | `ip route get 1.1.1.1`, ping gateway |
| On-link works, other subnets fail | No default or wrong gateway | same; compare a working host |
| Only some destinations fail | More-specific blackhole or stale prefix | `ip route get <dst>` |
| One direction only | Asymmetric return path + firewall | capture both ends; remote `ip route get` |
| Wrong NIC / wrong source | Metrics, `ip rule`, src selection | `ip route get` with `from`, `ip rule` |
| After failover, still broken | Stale route or stale neighbour | `ip neigh`, control-plane logs |
| Large writes stall, small pings work | PMTU black hole (ICMP filtered) | `tracepath`, `ping -M do` |
| Fine on host, broken in container | Different netns table | `ip netns exec` / `nsenter` + `ip route` |
| Two defaults, flapping | DHCP + static, or two agents | `ip route show default`, NM/cloud logs |

## Investigation Tips

- Start with `ip route get <the address the app uses>`. Apps that talk to a name may use a different A/AAAA than the one you pinged.
- Confirm the next hop is reachable before you chase the far end. Failed neighbour lookup masquerades as routing.
- Compare `ip route` and `ip rule` on a working twin. Automation drift loves extra defaults and leftover tables.
- On multi-homed hosts, watch source address. `ip route get 8.8.8.8 from <addr>` tells you if that source is even valid for the chosen path.
- Namespaces have private tables. Debugging from the host netns is how people “prove the route is fine” while the container blackholes.
- After DHCP or cloud route pushes, look for duplicate defaults with different metrics. The higher metric is a landmine for the next failover.
- Document every policy rule. `ip rule` is invisible to anyone who only ever types `ip r`.

## Related Notes

- [[ip Command Deep Dive]]
- [[ARP and Neighbor Discovery]]
- [[TCP IP Troubleshooting Model]]
- [[Firewall and NAT]]
- [[ss Deep Dive]]
- [[Cloud Networking]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Dual-NIC jump hosts taught me to type `ip route get` with `from`. Ping used the management default; the application socket bound the storage address and went nowhere.
- A “DNS is broken” incident was a leftover `/32` to an old resolver installed by a cloud agent after a VPC change. `ip route get 10.0.0.2` showed the lie immediately.
- I have added a temporary default to “fix prod”, then watched DHCP put the old one back five minutes later. If it is not in NM/netplan/the router, it is not a fix.
- MTU: pings of 56 bytes and a blackholed DF path. `tracepath` and `ping -M do` belong in the first five minutes of any “large request hangs” ticket.
