# Routing

## Concept

The kernel forwarding table (FIB) decides the next hop for each destination. Policy routing (`ip rule`) can select different tables based on source, mark, or interface. Static routes, DHCP, and dynamic protocols (FRR, etc.) all end up here.

## Why it matters

- A route that exists in one table is invisible to packets that hit another table.
- Asymmetric routing, missing return routes, or a wrong default break connectivity in ways that look like firewall or application bugs.
- Dynamic routing (BGP/OSPF) can install or withdraw routes without a local config change; the symptom appears in `ip route`.

## Mental Model

```
packet
    → fib_rules (ip rule)
        → select table
            → longest prefix match
                → next hop / device / unreachable
```

`ip route get <dest> from <src>` shows the actual decision for a packet.

## Key Commands

```bash
ip route show
ip route show table all
ip rule show
ip route get 8.8.8.8
ip route get 10.1.1.1 from 192.168.1.10
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Destination unreachable from this host only | Wrong table or missing route | `ip route get`, `ip rule` |
| Works one way, fails the other | Asymmetric route or rp_filter | return path, `sysctl net.ipv4.conf.*.rp_filter` |
| Route disappears after reboot | Not persisted (NetworkManager, systemd-networkd, or FRR) | config files, `systemctl status` |

## Investigation Tips

- Always use `ip route get` with the real source address when policy routing is in play.
- Compare the table the dynamic protocol thinks it owns with the kernel tables.

## Related Notes

- [[FRR and Dynamic Routing]]
- [[Policy Based Routing]]
- [[ip Command Deep Dive]]
- [[Reverse Path Filtering]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “no route to host” was a policy rule selecting an empty table for that source. `ip route get … from …` showed it immediately.
