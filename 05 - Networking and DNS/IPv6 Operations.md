# IPv6 Operations

## Concept

IPv6 is not “IPv4 with longer addresses.” Address selection, neighbour discovery, and the absence of NAT change how connectivity fails. A dual-stack host may prefer AAAA, fail the IPv6 path, and only then fall back — or not fall back at all, depending on Happy Eyeballs and the application.

Most production pain is missing RA, wrong source selection, a firewall that only knows v4, or an application that bound only `0.0.0.0`.

## Why it matters

- Dual-stack “works in the lab” then times out in production because the v6 path is blackholed and the client does not fall back quickly.
- Source address selection can pick a temporary privacy address or a deprecated prefix after renumbering; the return path never matches.
- No NAT means every service that should not be public must be firewalled. “We never opened it” is not a control.
- Neighbour Discovery replaces ARP. Stale ND cache or a missing RA looks exactly like “the gateway is down.”
- Many monitoring and log pipelines still assume IPv4. An outage that is v6-only is invisible to them.

## Mental Model

```
Address types that matter in ops:
  fe80::/10   link-local     (always on-link; used for RA/ND)
  2000::/3    global unicast
  fc00::/7    ULA            (site-local, not globally routable)
  ::1         loopback

How a packet leaves:
  1. Destination is local? → local delivery
  2. On-link prefix (from RA or static)? → ND
  3. Default route (::/0 via a link-local next hop)
  4. Source selection (RFC 6724) picks which of *my* addresses to use

RA (Router Advertisement) is the usual way a host learns its prefix and default route.
SLAAC builds the address; DHCPv6 is optional and often only used for DNS.
```

A host can have a working link-local and still have no global connectivity. `ping6 fe80::…%eth0` succeeding proves L2, not routing.

## Key Commands

```bash
# What we have
ip -6 addr show
ip -6 route show
ip -6 route show default
ip -6 neigh show

# The question that matters
ip -6 route get 2606:4700:4700::1111
ip -6 route get 2001:db8::1 from 2001:db8:1::10

# Neighbour / RA
ip -6 neigh
# On the router or a debug host:
# tcpdump -ni eth0 icmp6

# Connectivity
ping -6 -c 3 2606:4700:4700::1111
traceroute -6 2606:4700:4700::1111
curl -6 -v --max-time 5 https://example.com/

# Listening
ss -6 -lnt
ss -6 -ant

# Temporary / privacy addresses
sysctl net.ipv6.conf.all.use_tempaddr
sysctl net.ipv6.conf.eth0.use_tempaddr
```

Disable IPv6 only if you must (and document why):

```
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

Prefer fixing the path. Cloud metadata and some package managers assume it is present.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Slow or hanging connections, IPv4 works | Blackholed AAAA, no Happy Eyeballs | `curl -4` vs `curl -6`, `ip -6 route get` |
| `ping6` to link-local works, global fails | No RA / no default route | `ip -6 route`, `ip -6 addr` |
| Wrong source address, replies never return | Source selection after renumber | `ip -6 route get … from <addr>`, privacy addrs |
| Service unreachable from v6 clients | Bound only to IPv4 or firewall v6 empty | `ss -6 -lnt`, nft/firewalld IPv6 rules |
| ND fails, “destination unreachable” | Stale neigh, missing RA, L2 issue | `ip -6 neigh`, tcpdump icmp6 |
| After reboot, no v6 address | RA not received, `accept_ra=0` | sysctl `accept_ra`, interface flags |
| ULA used for external traffic | Source selection preferred ULA | `ip -6 route get 2001:…` |
| Monitoring green, users on v6 fail | Probes are IPv4-only | Test both families |

## Investigation Tips

- Always test both families. `curl -4` and `curl -6` (or `ping` / `ping6`) in the first minute.
- `ip -6 route get <dst>` tells you the path and the source that will be chosen. If that source has no return route, the connection dies.
- Link-local addresses require a zone index (`fe80::1%eth0`). Omitting it is a common “command not found” style failure.
- On dual-stack, confirm the application is not hard-coded to AF_INET. Many “IPv6 ready” claims die at the bind.
- Firewalld and nftables have separate IPv6 tables. A rule that exists for IPv4 does not exist for IPv6 until you add it.
- Temporary addresses (privacy extensions) rotate. Long-lived inbound connections or source-based firewall rules break when the address changes.
- If you disable IPv6, do it in sysctl and in the network config. A half-disabled stack produces confusing “address exists but route does not” symptoms.

## Related Notes

- [[Routing]]
- [[ip Command Deep Dive]]
- [[ARP and Neighbor Discovery]]
- [[TCP IP Troubleshooting Model]]
- [[Firewall and NAT]]
- [[DNS Resolution]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random 30-second timeout” on a dual-stack load balancer was an AAAA record pointing at a firewall that dropped ICMPv6. IPv4 was fine. `curl -6` hung; `curl -4` returned immediately. Happy Eyeballs was not enabled in that client library.
- After a prefix renumber, source selection kept picking the old address for a few minutes. The new default route was installed; the old address was still preferred. `ip -6 route get` with an explicit `from` showed the mismatch.
- We treated “IPv6 is enabled” as done. The service only listened on `0.0.0.0`. External v6 clients got connection refused while internal v4 worked. `ss -6 -lnt` would have ended the ticket in one command.
