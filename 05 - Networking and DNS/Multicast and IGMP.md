# Multicast and IGMP

## Concept

Multicast delivers one packet to many receivers without unicast replication at the source. IGMP (IPv4) and MLD (IPv6) are the group-membership protocols that tell switches and routers which hosts want which groups. The kernel joins groups via `IP_ADD_MEMBERSHIP` / `IPV6_ADD_MEMBERSHIP` or `ip maddr`.

Without IGMP snooping the switch floods multicast to every port. With snooping it forwards only to ports that have joined. Queriers keep the membership state alive.

## Why it matters

- Broken multicast silently drops heartbeats, discovery, or cluster messages. The service looks “randomly partitioned”.
- IGMP snooping without a querier ages out membership and blackholes traffic after the timeout.
- Firewalls, reverse-path filters, and multiple interfaces drop multicast that unicast would accept.
- Containers and network namespaces need explicit membership and routing; the host join is not enough.

## Mental Model

```
Source → multicast address (224.0.0.0/4 or ff00::/8)
  → switches flood or snoop
  → routers use PIM (sparse/dense) or just IGMP for local
  → host joins group on an interface
  → socket receives

Key pieces:
  querier     keeps snooping tables alive
  snooping    switch forwards only to joined ports
  TTL / hop   often 1 for link-local (224.0.0.0/24)
  RPF         unicast reverse path must be valid for many routers
```

224.0.0.1 (all-hosts) and 224.0.0.2 (all-routers) are special. Most application groups are in 239.0.0.0/8 (administratively scoped).

## Key Commands

```bash
# Joined groups and interfaces
ip maddr show
cat /proc/net/igmp
cat /proc/net/igmp6

# Routing and multicast routes
ip route show table all | grep -E '224|239|ff'
ip mroute show   # if CONFIG_IP_MROUTE

# Test membership and receive
# (socat or a small listener)
socat UDP4-RECV:1234,ip-add-membership=239.1.1.1:eth0 -

# IGMP querier / snooping on the switch (vendor-specific)
# Linux bridge snooping
cat /sys/class/net/br0/bridge/multicast_snooping
cat /sys/class/net/br0/bridge/multicast_querier

# tcpdump the control plane
tcpdump -i eth0 -n igmp or icmp6
tcpdump -i eth0 -n net 224.0.0.0/4
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Works for a few minutes then dies | Snooping timeout, no querier | switch querier, `multicast_querier` |
| Floods entire VLAN | Snooping disabled or broken | switch config, bridge snooping |
| Only some hosts receive | Wrong interface join, RPF, firewall | `ip maddr`, `iptables -L -v`, RPF |
| Container never sees packets | Join inside netns, not host | `ip netns exec … ip maddr` |
| TTL 1 traffic stays local | Expected for 224.0.0.0/24 | application TTL, routed vs local |
| After network change, silence | Stale maddr or missing route | re-join, `ip route get` to group |
| High CPU on switch | Snooping table thrash or flood | group count, querier interval |

## Investigation Tips

- Confirm the host has actually joined: `ip maddr show dev eth0`. Application logs that say “joined” are not proof.
- Capture both IGMP and the data group. Missing IGMP reports mean the switch will never forward.
- Check reverse-path filtering. Multicast sources often fail `rp_filter` when the return path is not the arrival interface.
- In bridges and bonds the membership must be on the correct device. A bond slave join is useless.
- TTL=1 groups never leave the link. If the design expects routed multicast, the application must set a higher TTL and the network must run PIM.
- After a switch reload or topology change, force a re-join or lower the querier interval temporarily to rebuild state.

## Related Notes

- [[Routing]]
- [[Reverse Path Filtering]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Network Namespaces]]
- [[TCP IP Troubleshooting Model]]
- [[firewalld Deep Dive]]

## Personal Lessons Learned

- A cluster discovery protocol worked in the lab and failed in production after 4 minutes. The access switch had IGMP snooping on and no querier. Enabling the querier (or disabling snooping on that VLAN) fixed it.
- Multicast heartbeats were dropped by `rp_filter=1` on a multi-homed host. The source was reachable via a different interface than the one that received the packet. Setting the interface to loose mode or adding a specific route resolved it.
- Joining the group on the host namespace while the application ran in a container netns produced a green “joined” log and zero packets. The join has to happen in the same network namespace as the socket.
