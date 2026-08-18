# ip Command Deep Dive

## Concept

The `ip` command (from iproute2) is the modern tool for managing and inspecting network interfaces, addresses, routes, and neighbours. It replaces most uses of the old `ifconfig` and `route` commands.

## Why it matters

Almost every network troubleshooting session starts with checking interface state, addresses, and routes. `ip` gives a clear, consistent view.

## Mental Model

```
ip link      → interfaces (up/down, MAC, MTU)
ip addr      → addresses on interfaces
ip route     → routing table
ip neigh     → ARP / neighbour table
```

## Key Commands

```bash
# Interfaces
ip link show
ip link set eth0 up
ip link set eth0 down

# Addresses
ip addr show
ip addr show eth0
ip addr add 192.0.2.10/24 dev eth0
ip addr del 192.0.2.10/24 dev eth0

# Routes
ip route show
ip route show table main
ip route get 1.1.1.1                # how will this packet be routed?

# Neighbours (ARP)
ip neigh show
ip neigh show dev eth0

# Brief overview
ip -br link
ip -br addr
```

## Common Failure Modes & Symptoms

| Symptom                          | What to check with ip                  |
|----------------------------------|----------------------------------------|
| Interface appears down           | `ip link show`                         |
| No IP address                    | `ip addr show`                         |
| Cannot reach other networks      | `ip route show`, `ip route get <ip>`   |
| Duplicate IP or ARP issues       | `ip neigh show`                        |
| Wrong MTU / fragmentation        | `ip link show` (look at mtu)           |

## Investigation Tips

- `ip route get <destination>` is one of the most useful commands — it shows exactly how the kernel will route a packet.
- Prefer `ip -br` for quick readable output.
- In containers and network namespaces, remember that `ip` only sees the current namespace unless you use `ip netns`.
- Changes made with `ip` are usually not persistent — permanent config lives in NetworkManager, netplan, systemd-networkd, or distribution-specific files.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[Routing]]
- [[ARP and Neighbor Discovery]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
