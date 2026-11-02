# FRR and Dynamic Routing

## Concept

FRR (Free Range Routing) is the usual open-source routing suite on Linux (BGP, OSPF, IS-IS, static, etc.). `zebra` owns the kernel FIB; the protocol daemons (bgpd, ospfd, …) feed it. `vtysh` is the single CLI that talks to all of them.

## Why it matters

- A wrong BGP advertisement or a missing community can black-hole a prefix or leak internal routes to a peer.
- OSPF adjacency flaps or a stuck DR election look like “the network is slow” until you look at the control plane.
- Linux policy routing and FRR can fight; the kernel table FRR thinks it owns may not be the one your packets use.
- When the underlay or the anycast service breaks, the first useful signal is often in `show ip bgp` or `show ip ospf neighbor`, not in `ip route`.

## Mental Model

```
protocol daemon (bgpd / ospfd)
    → zebra
        → netlink to kernel FIB (and optional FPM to an external FIB)
            → kernel forwards packets

vtysh
    → talks to the daemons over a local socket
    → config is usually in /etc/frr/frr.conf
    → integrated-vtysh-config keeps one file

Administrative distance / route preference decides which protocol wins when the same prefix is learned two ways.
```

Two common surprises: FRR may install routes in a non-default table or VRF, and a `ip rule` that was added by hand can shadow the FRR-installed route.

## Key Commands

```bash
# Interactive
sudo vtysh

# One-shot
sudo vtysh -c "show ip bgp summary"
sudo vtysh -c "show ip bgp 10.0.0.0/8"
sudo vtysh -c "show ip ospf neighbor"
sudo vtysh -c "show ip route"
sudo vtysh -c "show running-config"

# Service
systemctl status frr
journalctl -u frr -n 100 --no-pager

# Kernel side (what actually forwards)
ip route show table all
ip rule show
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| BGP session stuck in Active / Connect | TCP 179 blocked, wrong peer address, or TTL security | `ss -tn | grep 179`, `tcpdump -ni any port 179`, peer config |
| Prefix not installed in kernel | Higher admin distance, filtered by route-map, or VRF mismatch | `show ip bgp`, `show ip route`, `ip route show vrf …` |
| OSPF neighbor ExStart / Exchange | MTU mismatch, area type mismatch, or auth | `show ip ospf neighbor detail`, interface MTU |
| Routes flapping | Unstable link, BFD down, or route dampening | `show ip bgp neighbors … advertised-routes`, interface errors |
| Traffic ignores the FRR route | Policy routing / `ip rule` points at another table | `ip rule show`, `ip route get <dest>` |
| Config change disappears on restart | Not written, or `service integrated-vtysh-config` mismatch | `write memory` in vtysh, check `/etc/frr/frr.conf` |

## Investigation Tips

- Always compare `vtysh -c "show ip route"` with `ip route get`. If they disagree, the packet is not following the protocol table you are looking at.
- For BGP, the useful trio is summary → specific prefix → advertised/received routes. The summary tells you the session; the prefix tells you why it is (or is not) best.
- Capture on the wire (`tcpdump -ni <if> port 179`) when the session will not come up. The kernel log and FRR log often only say “timeout”.
- BFD is frequently the real reason an adjacency drops. Check `show bfd peers` (or the BFD daemon) before you blame the protocol.
- VRF-aware FRR needs the VRF to exist in the kernel first (`ip link add … type vrf`). A missing VRF looks like “FRR is ignoring my config”.
- After a change, `write memory` (or the equivalent) or the next restart reverts it. Confirm the on-disk file.

## Related Notes

- [[Routing]]
- [[Policy Based Routing]]
- [[ip Command Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Network Namespaces]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “missing route” was present in `show ip bgp` but absent from the kernel because an old `ip rule` for a source-based table took precedence. `ip route get` from the actual source address showed the real path in one command.
- BGP would not establish after a firewall change. FRR logged only “Connect”. The tcpdump showed the SYN leaving and nothing coming back; the security group had dropped 179. The control-plane log was useless until the packet capture existed.
- An OSPF adjacency stayed in ExStart for an hour. The two sides had different interface MTUs after a bond was rebuilt. Once the MTUs matched, the adjacency formed and the routes appeared.
