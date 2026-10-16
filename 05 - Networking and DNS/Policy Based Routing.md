# Policy Based Routing

## Concept

Policy routing lets the kernel choose a routing *table* based on criteria other than the destination address: source address, incoming interface, fwmark, UID, etc. `ip rule` defines the policy; each rule points at a table that contains its own routes.

The main table is still the default. Extra tables exist so a multi-homed host can send traffic that arrived on (or is sourced from) one network back out the same network.

## Why it matters

- Dual-homed hosts (management + production, or two upstreams) black-hole or asymmetric-route traffic when everything uses the main table’s default.
- Reply packets leave with the wrong source address. Stateful firewalls and conntrack on the far side drop them. The symptom is “ping works, the application times out”.
- Cloud and container environments inject rules and tables. Leftover rules from a previous VPC or CNI survive and surprise the next operator.
- fwmark-based rules are how some traffic-control and VPN setups steer selected flows without touching every route.

## Mental Model

```
Packet arrives or is locally generated
  → walk ip rule list (priority order)
  → first matching rule selects a table
  → look up destination in *that* table
  → if no match, continue to next rule (or unreachable)

Typical pattern for “from this source, use this gateway”:
  ip rule add from 10.1.1.50 table 100
  ip route add default via 10.1.1.1 dev eth1 table 100
  ip route add 10.1.1.0/24 dev eth1 table 100   # connected route must exist in the table too
```

Source address selection and the chosen table must agree. A rule that picks table 100 but the socket is bound to an address that table 100 does not know how to source will still fail.

## Key Commands

```bash
# The policy
ip rule show
ip -6 rule show

# A specific table
ip route show table 100
ip route show table all

# How *this* packet would be routed
ip route get 8.8.8.8
ip route get 8.8.8.8 from 10.1.1.50
ip route get 8.8.8.8 from 10.1.1.50 iif eth1

# Add (temporary — persist in NM/netplan/networkd)
ip rule add from 10.1.1.50 table 100 priority 100
ip route add default via 10.1.1.1 dev eth1 table 100
ip route add 10.1.1.0/24 dev eth1 scope link table 100

# fwmark example
ip rule add fwmark 1 table 200
# (mark set by iptables/nftables or tc)

# Clean up
ip rule del from 10.1.1.50 table 100
ip route flush table 100
```

Persist the rules. A one-off `ip rule add` disappears on reboot or when NetworkManager rewrites the interface.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Traffic from one IP leaves via the wrong NIC | No rule, or rule priority loses to main | `ip rule`, `ip route get … from <src>` |
| Application times out, ping from the host works | Reply sourced from the wrong address | `ip route get` with `from`, capture both sides |
| Rule exists but lookup fails | Table missing the connected route or default | `ip route show table N` |
| After reboot, policy gone | Rules not persisted | NM connection, netplan, systemd-networkd .network |
| Two rules fight | Overlapping from/to, priority order | `ip rule show` (lower number = higher priority) |
| Container/VM traffic ignores host rules | Different netns | `ip netns`, `nsenter` + `ip rule` |
| fwmark rule never matches | Mark not applied, or cleared | nft/iptables counters, `ip rule` |

## Investigation Tips

- `ip route get <dst> from <src>` is the command that answers “which table and which next hop for *this* flow?”
- Always print `ip rule` *and* `ip route show table all` (or the specific tables). Looking only at `ip route` hides the policy.
- On a multi-homed box, confirm the source address the application actually binds. `ss -tpn` or the app config beats assuming the primary IP.
- Compare a working twin host. Extra tables and rules are a common automation leftover.
- After changing rules, flush the route cache if you are on an older kernel (`ip route flush cache`); modern kernels are less sticky but conntrack entries may still pin the old path.
- Document every non-default rule in the host’s runbook. The next person will only type `ip r`.

## Related Notes

- [[Routing]]
- [[ip Command Deep Dive]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Firewall and NAT]]
- [[Cloud Networking]]
- [[systemd-networkd]]
- [[NetworkManager Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A dual-homed NFS server answered management pings but storage clients timed out. `ip route get <client> from <storage-ip>` showed the reply leaving via the management default. One rule and a table fixed it; the ticket had been open as “NFS bug” for a day.
- Cloud-init left an old `from 10.0.0.0/8 table 100` rule after a VPC migration. Traffic to the new 10/8 range hit the empty table and vanished. `ip rule` was the five-second diagnosis.
- I added a rule without the connected route in the same table. Local traffic to the gateway’s subnet was unreachable from that source. Tables need their own connected routes; they do not automatically inherit from main.
