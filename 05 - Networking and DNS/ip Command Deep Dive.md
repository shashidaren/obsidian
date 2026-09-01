# ip Command Deep Dive

## Concept

`ip` (iproute2) is the primary tool for inspecting and changing interfaces, addresses, routes, neighbours, and network namespaces. It replaced `ifconfig`, `route`, and most of `arp`.

Almost every network incident starts here: is the link up, do we have an address, and how will this packet be routed?

## Why it matters

- Single consistent syntax for L2/L3 state
- `ip route get` shows the kernel’s *actual* decision, including source address and device
- Namespaces (`ip netns`) are how containers and VRFs isolate stacks
- Brief output (`ip -br`) is fast to scan on a jump host
- Changes are immediate — which is powerful and dangerous

Persistent config is *not* `ip`. Persistent config is NetworkManager, netplan, systemd-networkd, ifcfg, or your cloud metadata. `ip` is the live view and the live scalpel.

## Mental Model

```
ip link     →  L2 device: UP/DOWN, MAC, MTU, operstate
ip addr     →  L3 addresses on those devices
ip route    →  how packets are forwarded (main table + policy rules)
ip neigh    →  ARP / NDP cache (L3 → L2)
ip rule     →  policy routing (which table to consult)
ip netns    →  another entire stack
```

Order of investigation:

1. Link up?
2. Address present and not duplicate?
3. Route exists for the destination?
4. Neighbour entry for the next hop?
5. Right namespace?

`ip route get 1.2.3.4` answers 3–4 in one shot for a concrete destination.

## Key Commands

```bash
# Readable overview
ip -br link
ip -br addr

# Full detail
ip -d link show
ip addr show dev eth0

# Admin state
ip link set dev eth0 up
ip link set dev eth0 down
ip link set dev eth0 mtu 1400

# Addresses (temporary unless you also persist them)
ip addr add 192.0.2.10/24 dev eth0
ip addr del 192.0.2.10/24 dev eth0

# Routes
ip route show
ip route show table main
ip route show table all
ip route get 1.1.1.1
ip route get 10.9.8.7 from 10.0.0.5 iif eth0   # policy / source-sensitive

# Add / delete a route (ephemeral)
ip route add 10.20.0.0/16 via 10.0.0.1 dev eth0
ip route del 10.20.0.0/16

# Neighbours (ARP/NDP)
ip neigh show
ip neigh show dev eth0
ip neigh flush dev eth0          # last resort; causes a burst of resolution

# Policy routing
ip rule show
ip route show table 100

# Namespaces
ip netns list
ip netns exec <ns> ip -br addr
ip netns exec <ns> ss -tulpn

# Colour / JSON when scripting
ip -c -br addr
ip -j addr show
```

Watch a destination continuously during a failover:

```bash
watch -n1 'ip route get 10.0.50.10'
```

## Common Failure Modes & Symptoms

| Symptom | What to check | Typical cause |
|---|---|---|
| Interface missing | `ip link`, `dmesg`, cloud NIC attach | Wrong name (`eth0` vs `ens192`), driver, or not attached |
| `state DOWN` / `NO-CARRIER` | cable, hypervisor NIC, security group vs actually link | Layer 1 / virt NIC disconnected |
| UP but no address | DHCP failure, cloud metadata, static config not applied | `ip addr` empty; check NM/netplan/journal |
| Address present, no outbound | default route missing or wrong gw | `ip route show`, `ip route get 1.1.1.1` |
| Asymmetric / “works from A not B” | policy rules, multiple tables, source address | `ip rule show`, `ip route get` with `from` |
| Duplicate IP | flapping neigh, wrong clone of a VM | `ip neigh` STALE/FAILED, logs of conflict |
| Intermittent reachability | neigh flap, bond/VLAN, MTU | `ip -s link`, `ip neigh`, pings at 1472/1500 |
| Container has no network | you ran `ip` in the host netns | `nsenter -t <pid> -n ip addr` |
| Change vanished after reboot | used `ip` only | persist in the distro’s network manager |
| MTU black hole | tunnel + DF + 1500 inner | lower MTU or MSS clamp; confirm with tcpdump ICMP |

## Investigation Tips

- `ip route get <dst>` is the highest-leverage command in this family. It prints device, source IP, gateway, and table. Argue from that line.
- `ip -br` first, full output second. Brief mode catches the DOWN / missing-address cases immediately.
- Operstate `UNKNOWN` is common on some virt NICs and is not automatically fatal. `NO-CARRIER` is.
- After adding an address, ping the gateway *and* check `ip neigh`. FAILED neighbour means L2 is the problem, not “routing”.
- Multiple default routes with different metrics appear after VPN or NM reconnects. `ip route get` tells you which one wins.
- Cloud ENI / extra NIC problems are usually: extra interface UP with no route, or source routing missing so reply traffic exits the wrong NIC.
- Do not `ip neigh flush` as muscle memory on a production host; you create a burst of ARP/NDP and can stall traffic.
- Remember IPv6. `ip -6 route`, `ip -6 neigh`. Dual-stack hosts fail in one family while the other looks fine.
- For persistence: reproduce with `ip`, then encode the same result in netplan/NM/networkd. Never leave a live-only fix on a fleet node.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[Routing]]
- [[ARP and Neighbor Discovery]]
- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[Firewall and NAT]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- When two engineers disagree about “the default route”, `ip route get` to the actual destination ends the debate.
- Most “DNS is broken” tickets on new VMs were “no default route after a botched cloud-init”. `ip -br addr` + `ip route` in the first 30 seconds.
- I have broken return traffic by adding a second NIC address without a policy rule. Packets left nic1 and replies arrived nic0, then vanished.
- Live `ip` fixes that are not committed to IaC / netplan come back as 3 a.m. pages after the next reboot.
