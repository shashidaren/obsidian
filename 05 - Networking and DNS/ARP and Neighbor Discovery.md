# ARP and Neighbor Discovery

## Concept

ARP (IPv4) and Neighbor Discovery (IPv6) map IP addresses to MAC addresses on a local link. The kernel keeps a neighbor cache. Stale or incorrect entries are a classic cause of “it worked until we changed something” connectivity failures.

Gratuitous ARP / unsolicited Neighbor Advertisements are how a host announces a new MAC for an existing IP (failover, VM migration, IP move).

## Why it matters

- After a VIP failover or a NIC replacement, other hosts may still have the old MAC cached. Traffic goes to the wrong place until the entry expires or is flushed.
- Duplicate IP addresses produce flapping ARP entries and intermittent reachability.
- Proxy ARP that is enabled when it should not be (or disabled when it should be) breaks routing designs.
- IPv6 Neighbor Discovery has the same failure modes with different commands (`ip -6 neigh`).
- A large or overflowing neighbor table (`gc_thresh`) drops new entries and looks like random packet loss.

## Mental Model

```
IP packet to on-link destination
    → neighbor cache lookup
        REACHABLE / STALE / DELAY / PROBE / FAILED / PERMANENT
    → if missing or STALE, solicit (ARP request / NS)
    → reply installs lladdr
    → packet is sent

States that matter in incidents:
  REACHABLE  — recently confirmed
  STALE      — will be re-probed on next use
  FAILED     — resolution failed
  PERMANENT  — static, never expires
```

`ip neigh` is the modern interface. `arp` still works for IPv4 but shows less state.

## Key Commands

```bash
# Show the cache
ip neigh show
ip -6 neigh show
ip neigh show dev eth0

# Flush (incident tool — say why)
ip neigh flush dev eth0
ip neigh flush all

# Delete one entry
ip neigh del 192.0.2.10 dev eth0

# Static (rare, usually wrong)
ip neigh add 192.0.2.10 lladdr 00:11:22:33:44:55 dev eth0 nud permanent

# Watch resolution
ip monitor neigh

# Gratuitous ARP (after VIP move)
arping -A -I eth0 192.0.2.10
# or
ip neigh replace 192.0.2.10 lladdr $(cat /sys/class/net/eth0/address) dev eth0 nud permanent
# then delete the permanent later if you only wanted the announcement

# Table pressure
cat /proc/sys/net/ipv4/neigh/default/gc_thresh1
cat /proc/sys/net/ipv4/neigh/default/gc_thresh2
cat /proc/sys/net/ipv4/neigh/default/gc_thresh3
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Host unreachable after IP move / failover | Stale neighbor entry on peers | `ip neigh` on the complaining host, flush |
| Intermittent connectivity to one IP | Duplicate IP, flapping MAC | `ip neigh`, switch CAM table, `arping -D` |
| Works from some hosts, not others | Asymmetric stale cache | Check neigh on the failing sources |
| High softirq / ksoftirqd after many hosts | Neighbor table thrashing | `gc_thresh*`, number of entries |
| IPv6 “neighbor solicitation” storms | Missing ND or wrong link-local | `ip -6 neigh`, RA/RS |
| Proxy ARP unexpectedly answering | `/proc/sys/net/ipv4/conf/*/proxy_arp` | sysctl, intended design |
| VIP moves but clients still hit old node | No gratuitous ARP / ND | `arping -A` or equivalent on the new owner |

## Investigation Tips

- `ip neigh show` on the host that cannot reach the target. A STALE or wrong lladdr is the smoking gun.
- After any VIP or MAC change, send a gratuitous ARP (or unsolicited NA) from the new owner. Do not rely on the natural timeout.
- `arping -D -I eth0 <ip>` detects duplicates (it should get no reply if the address is free).
- On the switch, the CAM/MAC table can also be stale. Flushing the host neighbor cache does not fix a switch that still points at the old port.
- For IPv6, the same logic applies with `ip -6 neigh` and Neighbor Advertisements.
- Raising `gc_thresh3` is a temporary relief when you have thousands of neighbors; the real fix is usually to reduce the number of on-link hosts or to route instead of bridge.
- Permanent entries are almost always a mistake in production. They hide the real mapping and survive long after the host is gone.

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[Keepalived and VRRP]]
- [[ip Command Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A keepalived failover “succeeded” (VIP was on the new node) but half the clients still black-holed. Their neighbor caches had the old MAC. A gratuitous ARP from the new master fixed it instantly. We now emit one on every transition.
- Duplicate IP from a misconfigured cloud instance produced a MAC that flapped every few seconds in `ip neigh`. `arping -D` from a third host confirmed the conflict before we touched any application.
- After a hypervisor live migration the guest’s MAC changed from the host’s point of view. External neighbors kept the old mapping until timeout. Flushing on the upstream router (or a gratuitous ARP) was required.
