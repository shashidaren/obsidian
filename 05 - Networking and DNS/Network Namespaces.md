# Network Namespaces

## Concept

A network namespace (`netns`) gives a process its own network stack: interfaces, addresses, routes, iptables/nftables rules, and sockets. The host’s default namespace is just one of them. Containers, VPNs, and some systemd services run inside their own netns.

veth pairs and macvlan are the usual ways to connect a netns to the outside world.

## Why it matters

- `ss`, `ip`, and `tcpdump` on the host do not see sockets or packets that live in another netns.
- “The port is free” on the host and “address already in use” inside the container are both true.
- Firewall rules on the host do not automatically apply to traffic that never enters the host netns.
- Debugging a container network problem from the host without entering the netns wastes time.

## Mental Model

```
host netns                          container / pod netns
  eth0                                eth0 (or eth0@ifX)
  routes, nftables                    its own routes, nftables
       |                                    |
       +---- veth peer pair ---------------+
              (or macvlan, ipvlan, etc.)
```

A packet from a container usually traverses the veth into a bridge or routing namespace on the host, then out a physical NIC. It can also be routed entirely inside a dedicated netns (common with some CNIs).

## Key Commands

```bash
# List namespaces
lsns -t net
ip netns list
ls -l /var/run/netns/          # if created with ip netns

# Inspect from the host
ip netns exec <name> ip addr
ip netns exec <name> ss -lntup
ip netns exec <name> nft list ruleset

# Enter via PID (works for containers that did not use ip netns)
nsenter -t <pid> -n ip addr
nsenter -t <pid> -n ss -lntup
nsenter -t <pid> -n tcpdump -i eth0 -n

# veth peers
ip link show type veth
# find the peer ifindex and which netns it lives in
```

Create a quick test netns:

```bash
ip netns add test
ip link add veth0 type veth peer name veth1
ip link set veth1 netns test
ip addr add 10.0.0.1/24 dev veth0
ip link set veth0 up
ip netns exec test ip addr add 10.0.0.2/24 dev veth1
ip netns exec test ip link set veth1 up
ip netns exec test ping -c 2 10.0.0.1
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Host `ss` shows nothing, app is listening | App is in another netns | `lsns -t net`, `nsenter -t <pid> -n ss` |
| Firewall rule has no effect | Traffic never enters host netns | Trace the veth / bridge / CNI path |
| Container cannot reach outside | Missing route, veth down, or bridge not enslaved | `ip netns exec ... ip route`, host bridge |
| Duplicate address | Same IP in two netns that are bridged | Check both sides |
| tcpdump on host NIC misses container traffic | Capturing the wrong interface | Capture on the veth or the bridge |
| “Network unreachable” only inside container | Default route or DNS only in host netns | `nsenter` and compare `ip route` / `resolvectl` |

## Investigation Tips

- Start from the PID (`crictl inspect`, `docker inspect`, or `ps`) and use `nsenter -t <pid> -n`. Do not assume the container image has `ip` or `ss`.
- `ip netns identify <pid>` tells you the name if it was created with `ip netns`.
- When capturing, decide whether you need the packet before or after NAT / bridge. Capture on the veth in the container netns and on the host-side veth or bridge.
- Host `nft list ruleset` is not the container’s ruleset. Enter the netns.
- A process can be moved between netns with `ip netns exec` or `nsenter`, but existing sockets stay in the original netns.
- systemd can put a service in its own netns with `NetworkNamespacePath=` or `PrivateNetwork=yes`. Check the unit if a host service “has no network”.

## Related Notes

- [[Namespaces and cgroups]]
- [[Bonds Bridges VLANs and ethtool]]
- [[tcpdump Deep Dive]]
- [[nftables Deep Dive]]
- [[Container Internals]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Hours spent on host `iptables` rules that never matched because the pod traffic was routed inside a CNI netns and only appeared on the host as a veth. `nsenter` + `tcpdump` on the pod netns showed the packets immediately.
- A service with `PrivateNetwork=yes` could not resolve DNS. It had a network namespace with only loopback. The unit needed either `NetworkNamespacePath=` to a prepared netns or the directive removed.
- “Port already in use” on the host was a container in host network mode. `ss -lntp` on the host and `lsns` sorted it in one command.
