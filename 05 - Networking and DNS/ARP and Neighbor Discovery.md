# ARP and Neighbor Discovery

## Concept

On a broadcast L2 segment, a host must map a next-hop **IP address** to a **MAC address** before it can send a frame.

- IPv4 uses **ARP** (Address Resolution Protocol)
- IPv6 uses **Neighbor Discovery** (ND) — NS/NA messages, stored as neighbour entries

If that mapping is missing, stale, or points at the wrong MAC, the symptom looks like “the network is down” even though cables, routes, and DNS are fine.

## Why it matters

- Duplicate IPs, flapping VIPs, and broken failover almost always show up in the neighbour table first
- A wrong static ARP or a stale entry after a VM/MAC change causes one-way or intermittent connectivity
- Cloud “it works from the same subnet but not from others” is often routing; “same subnet, some hosts only” is often ARP/ND or security-group/port-security
- Tools that ping L3 successfully still fail if the *application* talks to a different next hop

## Mental Model

```
Packet to 10.0.0.20
  → routing decision: local? connected subnet? default gw?
  → if on-link: look up neighbour (IP → MAC)
       miss → ARP request / ND NS  (who-has 10.0.0.20?)
       hit  → send Ethernet frame to that MAC
```

States you will see (`ip neigh`):

- `REACHABLE` — recently confirmed
- `STALE` — cached, will be confirmed on next use
- `DELAY` / `PROBE` — being rechecked
- `FAILED` / `INCOMPLETE` — no answer; this is the smoking gun

Gratuitous ARP / unsolicited NA is how a host (or a VIP) announces “this IP is now at this MAC.”

## Key Commands

```bash
# Neighbour tables (prefer these over arp -a)
ip neigh
ip -4 neigh show dev eth0
ip -6 neigh show dev eth0

# Watch resolution live
ip monitor neigh

# Force a refresh
ip neigh flush dev eth0
# or delete one entry
ip neigh del 10.0.0.20 dev eth0

# Who claims this IP right now? (run from the same L2)
arping -I eth0 10.0.0.20
arping -D -I eth0 10.0.0.20          # DAD-style: duplicate check

# Capture the conversation
tcpdump -ni eth0 arp
tcpdump -ni eth0 icmp6 and ip6[40] == 135 or ip6[40] == 136   # NS/NA

# Local MAC / addresses
ip link show eth0
ip -br addr

# Does the route even consider this on-link?
ip route get 10.0.0.20
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `INCOMPLETE` / `FAILED` for on-link IP | Target down, filtered, or wrong subnet | `ip route get`, `tcpdump arp`, target `ip link` |
| Intermittent reachability after failover | Stale neighbour / missing gratuitous ARP | `ip monitor neigh`, VIP/keeper logs |
| Two hosts, same IP | Duplicate address | `arping`, switch CAM / cloud NIC list |
| Works after `ping`, fails otherwise | Stateful firewall or proxy-ARP oddity | Capture both directions, check conntrack |
| VM migrated, old MAC still cached | Neighbour not updated | Flush neigh on peers, check hypervisor/port security |
| Only some hosts on the subnet work | Port security, wrong VLAN, isolated port | Compare working vs failing `ip neigh` + switch VLAN |
| IPv6 works on-link, IPv4 does not (or reverse) | Separate neighbour tables / RA / security groups | `ip -4 neigh` and `ip -6 neigh` independently |

## Investigation Tips

- Always confirm the packet is *on-link* with `ip route get`. If the next hop is a gateway, you should be resolving the *gateway* MAC, not the destination.
- Compare neighbour entries on both ends. A one-sided `REACHABLE` with the wrong MAC is a classic VIP or duplicate-IP problem.
- After moving a floating IP, look for gratuitous ARP on the wire. If it never appears, peers will keep the old MAC until timeout.
- In clouds, “ARP” is often implemented by the virtual network (mapped IP→tunnel). Security groups that block extra IPs look like FAILED neighbour entries.
- Do not persist static ARP unless you have a documented reason. It survives the exact event (failover) you needed ARP for.
- Pair with [[tcpdump Deep Dive]] and [[ip Command Deep Dive]] rather than guessing from `ping` alone.

## Related Notes

- [[ip Command Deep Dive]]
- [[Routing]]
- [[TCP IP Troubleshooting Model]]
- [[tcpdump Deep Dive]]
- [[ss Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> After a keepalived failover, if half the fleet still talks to the old node, dump `ip neigh` on a client before touching DNS or the application. Stale MAC entries are cheaper to prove than a “mystery split brain.”
