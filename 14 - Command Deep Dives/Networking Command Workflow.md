# Networking Command Workflow

## Concept

A disciplined order of network checks that moves from local interface state → addressing → routing → sockets → DNS → path/packet evidence. Following the same sequence every time avoids random firewall changes and missed layers.

## Why it matters

- Most “network down” tickets are DNS, routing, or a service not listening — not the firewall
- Jumping straight to `tcpdump` or iptables wastes time when `ss` or `ip route get` would have answered in seconds
- A consistent workflow produces clearer notes and faster handoffs

## Mental Model

```
1. Interface up and has an address?
2. Kernel routing table correct for the destination?
3. Something listening (or outbound socket state sane)?
4. Name resolution working for the names you use?
5. Path and packets (only when lower layers look fine)?
```

Work bottom-up. Fix or rule out each layer before descending further.

## Key Commands

```bash
# 1. Interfaces and addresses
ip -br link
ip -br addr
ip link show dev eth0
ip addr show dev eth0

# 2. Routing
ip route show
ip route get 1.1.1.1                # exact path the kernel will use
ip route get 10.0.0.5 from 10.0.0.10 iif eth0

# Neighbours / ARP
ip neigh show
ip neigh show dev eth0

# 3. Sockets
ss -tulpn                           # listening
ss -tp state established
ss -tp state syn-sent               # outbound blocked or blackhole?

# 4. DNS
dig +short example.com
dig @8.8.8.8 example.com            # compare public vs local
resolvectl status                   # systemd-resolved
cat /etc/resolv.conf

# 5. Connectivity and path (when needed)
ping -c 3 <target>
traceroute -n <target>              # or mtr -r -c 10 <target>
curl -v --connect-timeout 3 https://example.com/

# Packet capture (last resort / confirmation)
tcpdump -ni eth0 host <ip> and port 443
```

## Common Failure Modes & Symptoms

| Symptom                          | Layer to check first           | Typical commands                         |
|----------------------------------|--------------------------------|------------------------------------------|
| Interface down / no carrier      | Link                           | `ip link`, `ethtool`, dmesg              |
| No IP / wrong IP                 | Address                        | `ip addr`, DHCP/client logs              |
| Reach local subnet, not beyond   | Routing / gateway              | `ip route`, `ip route get`, neigh        |
| Connection refused               | Listening socket               | `ss -tulpn`                              |
| Timeout / hang                   | Path, firewall, or remote      | `ss` states, ping, traceroute, tcpdump   |
| Works by IP, fails by name       | DNS                            | `dig`, resolv.conf, systemd-resolved     |
| Intermittent                     | Loss, MTU, conntrack           | mtr, tcpdump, `ss -s`                    |

## Investigation Tips

- `ip route get <dst>` is the single most useful routing command — it shows exactly what the kernel will do with a packet.
- Compare “works on this host” vs “fails on that host” early; difference in routes, resolvers, or firewall is often obvious.
- In containers and VMs, confirm you are in the correct network namespace (`ip netns`, or exec into the container).
- Capture only after you know interface, addresses, and the ports involved — otherwise pcap is noise.
- Document the layer where it first fails; that becomes the incident summary.

## Related Notes

- [[ip Command Deep Dive]]
- [[ss Deep Dive]]
- [[dig Deep Dive]]
- [[tcpdump Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Routing]]
- [[ARP and Neighbor Discovery]]
- [[DNS Resolution]]
- [[Firewall and NAT]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
