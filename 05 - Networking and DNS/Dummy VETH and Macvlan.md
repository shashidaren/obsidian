# Dummy VETH and Macvlan

## Concept

Three lightweight virtual interfaces that appear constantly in containers, bridges, and test setups:

- **dummy** — a software-only interface that is always up. Useful for binding addresses that should not depend on a physical NIC.
- **veth** — a pair of connected virtual Ethernet devices. Traffic injected on one appears on the other. The classic container-to-host pipe.
- **macvlan** — a virtual interface that has its own MAC address on a parent physical (or bond) device. The parent and the macvlan share the same link; the switch sees two MACs.

None of them require a hypervisor. They are pure kernel net devices.

## Why it matters

- Containers use veth pairs by default. A “container has no network” is often a missing veth, a down peer, or a bridge that never learned the MAC.
- macvlan is used for low-overhead “give this container its own MAC” setups. It breaks when the switch port does not allow multiple MACs or when the parent is a bond in certain modes.
- dummy interfaces are the clean way to hold service addresses that must stay up even if the physical NIC flaps.

## Mental Model

```
dummy0          → always-up, no peer, good for VIP binding
vethA <-> vethB → pipe; usually one end in a netns or on a bridge
macvlan@eth0    → extra MAC on the same wire as eth0
                  (parent must be up; switch must accept the new MAC)
```

## Key Commands

```bash
# Create
ip link add dummy0 type dummy
ip link add veth0 type veth peer name veth1
ip link add macvlan0 link eth0 type macvlan mode bridge

# Move one end into a namespace (containers)
ip link set veth1 netns <pid-or-name>

# Inspect
ip -d link show veth0
ip -d link show macvlan0
bridge link show

# Delete
ip link del dummy0
ip link del veth0          # deletes the pair
```

macvlan modes: `bridge` (can talk to other macvlans on same parent), `private`, `vepa`, `passthru`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Container starts, no connectivity | veth peer down or not attached to bridge | `ip link`, `bridge link` |
| macvlan up, no packets | Switch port security / only one MAC allowed | switch logs, `ip -d link` |
| macvlan cannot reach host | Parent and macvlan isolated in some modes | try mode bridge or use veth instead |
| Address on dummy disappears | dummy not created at boot | systemd-networkd or NM config |
| Traffic between two macvlans fails | mode=private | `ip -d link show` mode |
| Bond + macvlan flaky | Bond mode does not play well with extra MACs | bond mode, switch config |

## Investigation Tips

- For any container networking problem, identify the veth pair (`ip link` inside and outside the netns) and confirm both ends are UP and one is enslaved to the expected bridge.
- `ip -d link` shows the parent of a macvlan and the mode. That single line answers most “why can’t it talk” questions.
- dummy interfaces are ideal for keepalived VIPs or any address that must not follow a physical link state. Create them in a `.network` file or a oneshot unit so they exist at boot.
- When macvlan is used on a bond, test failover explicitly. Some switch and bond combinations drop the extra MACs during the failover window.
- `ethtool -S` on the parent still counts the traffic; the macvlan itself has limited statistics.

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[Network Namespaces]]
- [[systemd-networkd]]
- [[Keepalived and VRRP]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Kubernetes node showed pods with no network. The veth peer on the host was up but had never been added to the CNI bridge after a manual `ip link` experiment. `bridge link` made it obvious.
- macvlan “worked in the lab” and failed in production because the access switch had port-security limited to one MAC. The parent NIC’s MAC was allowed; the macvlan’s was not. Switching to a bridge + veth removed the dependency.
- A VIP lived on a physical interface. When that NIC lost carrier the VIP disappeared and keepalived had to move it. Moving the VIP to a dummy interface (with policy routing) made the address stable across NIC flaps.
