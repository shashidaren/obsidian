# ARP and Neighbor Discovery

## Concept

On a broadcast L2 segment, a host must map a next-hop **IP address** to a **MAC address** before it can send a frame.

- IPv4 uses **ARP**
- IPv6 uses **Neighbor Discovery** (ND) — NS/NA messages, stored as neighbour entries

If that mapping is missing, stale, or points at the wrong MAC, the symptom looks like "the network is down" even though cables, routes, and DNS are fine.

Cloud networks often *emulate* ARP in the hypervisor or SDN. The commands stay the same; the failure modes include security groups and port security that never put a real broadcast on a wire.

## Why it matters

- Duplicate IPs, flapping VIPs, and broken failover show up in the neighbour table first
- A stale entry after a VM/MAC change causes one-way or intermittent connectivity
- "Same subnet, some hosts only" is often ARP/ND or port-security, not routing
- Keepalived / Pacemaker / cloud floating IPs only work if peers learn the new MAC quickly (gratuitous ARP / unsolicited NA)
- Tools that ping L3 successfully still fail if the *application* talks to a different next hop

## Mental Model

```
Packet to 10.0.0.20
  → routing decision: local? connected subnet? default gw?
  → if on-link: look up neighbour (IP → MAC)
       miss → ARP request / ND NS  (who-has 10.0.0.20?)
       hit  → send Ethernet frame to that MAC
```

`ip route get` tells you *which* IP you must resolve. Off-subnet traffic resolves the **gateway**, not the destination. Debugging ARP for the destination when the route is via a router is wasted time.

States (`ip neigh`):

- `REACHABLE` — recently confirmed
- `STALE` — cached; will reconfirm on next use
- `DELAY` / `PROBE` — being rechecked
- `FAILED` / `INCOMPLETE` — no answer; smoking gun
- `PERMANENT` — static; will not fix itself on failover

Gratuitous ARP / unsolicited NA is how a host or VIP says "this IP is now at this MAC." Switches update CAM; peers update neighbour tables. If that packet is filtered, failover looks like a split brain.

Proxy ARP (a router answering ARP for non-local IPs) hides topology and makes `INCOMPLETE` on the *wrong* box look like a host problem.

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
ip neigh del 10.0.0.20 dev eth0

# Who claims this IP right now? (same L2)
arping -I eth0 10.0.0.20
arping -D -I eth0 10.0.0.20          # duplicate check

# Capture
tcpdump -ni eth0 arp
tcpdump -ni eth0 'icmp6 and (ip6[40] == 135 or ip6[40] == 136)'   # NS/NA

# Local MAC / addresses / on-link decision
ip -br link
ip -br addr
ip route get 10.0.0.20

# Static entry — last resort, document why
# ip neigh replace 10.0.0.20 lladdr aa:bb:cc:dd:ee:ff nud permanent dev eth0
```

On bridges / bonds / VLANs, specify the interface the neighbour is actually on (`bond0.123`, `br0`). Flushing `eth0` under a bond does nothing useful.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `INCOMPLETE` / `FAILED` for on-link IP | Target down, filtered, wrong subnet, SG | `ip route get`, `tcpdump arp`, target `ip link` |
| Intermittent reachability after failover | Stale neighbour / missing GARP | `ip monitor neigh`, keeper logs |
| Two hosts, same IP | Duplicate address | `arping`, switch CAM / cloud NIC list |
| Works after `ping`, fails otherwise | Firewall learning / proxy-ARP | Capture both directions |
| VM migrated, old MAC cached | Neighbour not updated | Flush neigh on peers; port security |
| Only some hosts on the subnet work | Port security, wrong VLAN | Compare working vs failing `ip neigh` |
| IPv6 on-link works, IPv4 does not | Separate tables / RA / SG | `ip -4 neigh` and `ip -6 neigh` |
| VIP moves, half the fleet sticks | No GARP, filtered GARP, `PERMANENT` entries | tcpdump arp on a client |
| Cloud: FAILED for a secondary IP | Secondary IP not assigned to the NIC | Cloud console / `ip addr` on the target |

## Investigation Tips

- Confirm on-link with `ip route get`. Resolve the next hop it prints, nothing else.
- Compare neighbour entries on *both* ends. One-sided `REACHABLE` with the wrong MAC is VIP or duplicate-IP.
- After moving a floating IP, look for gratuitous ARP on the wire. If it never appears, peers keep the old MAC until timeout (often tens of seconds).
- In clouds, ARP is often implemented by the virtual network. Security groups that allow ICMP but not the app port still show `REACHABLE` after ping — ping proved L2, not L4.
- Do not persist static ARP unless you have a documented reason. It survives the failover you needed ARP for.
- Bonding + VLAN + bridge stacks clone MACs. Check `ip link` on the *outgoing* device `ip route get` selected.
- IPv6 privacy addresses and temporary MACs churn ND more than people expect. Do not chase "flapping" that is just address rotation.

## Related Notes

- [[ip Command Deep Dive]]
- [[Routing]]
- [[TCP IP Troubleshooting Model]]
- [[tcpdump Deep Dive]]
- [[ss Deep Dive]]
- [[Networking Command Workflow]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- After a keepalived failover, if half the fleet still talks to the old node, dump `ip neigh` on a client before touching DNS or the application. Stale MAC entries are cheaper to prove than a mystery split brain.
- A "duplicate IP" war on a cloud subnet was two NICs claiming the same secondary address after a bad Terraform apply. `arping -D` from a third host ended it; `ping` from each owner looked fine to itself.
- Static ARP put in years ago "to fix failover" was why failover stopped working. `nud permanent` is a footgun with a long fuse.
