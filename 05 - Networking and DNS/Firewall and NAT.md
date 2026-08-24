# Firewall and NAT

## Concept

A firewall decides which packets are allowed, dropped, or rejected. NAT (Network Address Translation) rewrites source or destination addresses/ports so private hosts can share public IPs or so services can be published.

On Linux the common tools are `iptables`/`nftables` (and higher-level wrappers like `firewalld`, `ufw`). Cloud and hardware firewalls sit upstream and must be considered as part of the path.

## Why it matters

- “Connection refused / timed out / no route” is frequently a firewall or NAT problem, not an application bug
- Return path and state tracking matter as much as the forward rule
- Misconfigured NAT breaks both outbound internet access and inbound published services
- In multi-layer environments (host + cloud SG + WAF + load balancer) the effective policy is the intersection of all layers

## Mental Model

```
Packet path (simplified):

  Client → [cloud SG / NACL] → [host firewall] → process
                ↑                    ↑
             NAT / DNAT           conntrack

Forward rules + reverse path + state = working connection
```

- Stateful firewalls track connections (`conntrack`). A rule that allows SYN but drops the reply will still fail.
- DNAT (destination NAT) is typical for publishing a service; SNAT/MASQUERADE for outbound.
- `nftables` is the modern replacement for `iptables`; many distros still expose both.

## Key Commands

```bash
# Current rules (prefer nft if available)
nft list ruleset
iptables -L -n -v --line-numbers
iptables -t nat -L -n -v

# firewalld (RHEL family)
firewall-cmd --list-all
firewall-cmd --list-all-zones
firewall-cmd --get-active-zones

# ufw (Ubuntu)
ufw status verbose

# Connection tracking
conntrack -L | head
ss -antp | grep <port>

# Quick reachability tests
nc -vz <host> <port>
curl -v --connect-timeout 3 http://<host>:<port>/
ping -c 2 <host>          # ICMP may be blocked even when TCP works

# Temporary allow (nft example — adjust to policy)
nft add rule inet filter input tcp dport 443 accept
```

Never leave temporary rules without a plan to make them permanent (or to remove them).

## Common Failure Modes & Symptoms

| Symptom                          | Likely cause                              | First checks                                   |
|----------------------------------|-------------------------------------------|------------------------------------------------|
| Timeout (no SYN-ACK)             | Dropped by firewall / SG / route          | Path: cloud SG → host rules → listening socket |
| Connection refused               | Nothing listening *or* reject rule        | `ss -lntp`, rules that REJECT                   |
| Works from localhost, fails remote | Host firewall or cloud SG               | Compare local vs external test                 |
| Outbound works, inbound fails    | Missing DNAT / publish rule / SG          | NAT table + external SG                        |
| Intermittent failures            | conntrack table full / asymmetric routing | `dmesg \| grep conntrack`, routing tables      |
| After reboot rules gone          | Rules not persisted                       | Check firewalld/ufw/nft persistence            |

## Investigation Tips

- Test from the *same network location* the client uses. Localhost success proves almost nothing about external access.
- Check every layer: cloud security groups / NACLs, load-balancer health checks, host firewall, and whether the process is actually listening on the expected interface.
- `tcpdump` on both sides of a suspected firewall is the fastest way to see whether packets arrive and whether replies leave.
- conntrack exhaustion shows up as random connection failures under load; watch `nf_conntrack_count` vs `nf_conntrack_max`.
- When adding rules, prefer explicit allow + default drop, and document the business reason.

## Related Notes

- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[ip Command Deep Dive]]
- [[Routing]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
