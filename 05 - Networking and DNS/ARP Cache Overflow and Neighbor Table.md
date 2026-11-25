# ARP Cache Overflow and Neighbor Table

## Concept

The kernel keeps an ARP (IPv4) / NDP (IPv6) cache of IP-to-MAC mappings. Entries are `REACHABLE`, `STALE`, `DELAY`, `PROBE`, or `FAILED`. The table size is limited by `gc_thresh1/2/3`. When it overflows, new neighbors cannot be resolved and packets are dropped.

## Why it matters

- A large L2 domain or a misbehaving host that ARPs for thousands of addresses fills the table. Suddenly “random” destinations become unreachable while the link is up.
- VM density, containers with many veths, or a flat /16 can hit the default `gc_thresh3` (1024 on older kernels).
- Symptoms look like packet loss or “no route to host” even though the route exists.

## Mental Model

```
packet to local subnet → look up neighbor table
    hit REACHABLE → send
    miss or STALE → ARP/NS request
    table full (gc_thresh3) → drop, log “neighbor table overflow”
```

`gc_thresh1` is soft minimum, `gc_thresh2` is when GC starts, `gc_thresh3` is hard maximum. Defaults are often 128/512/1024. Raise them together.

## Key Commands

```bash
# Current table and overflows
ip -s neigh show
ip neigh show nud failed
dmesg | grep -i 'neighbor table overflow'
journalctl -k | grep -i overflow

# Sysctl
sysctl net.ipv4.neigh.default.gc_thresh1 \
       net.ipv4.neigh.default.gc_thresh2 \
       net.ipv4.neigh.default.gc_thresh3
# same for ipv6: net.ipv6.neigh.default.gc_thresh*

# How many entries
ip neigh show | wc -l

# Clear (careful — causes a burst of ARP)
ip neigh flush all
```

Persistent raise (example):

```
# /etc/sysctl.d/99-neigh.conf
net.ipv4.neigh.default.gc_thresh1 = 1024
net.ipv4.neigh.default.gc_thresh2 = 2048
net.ipv4.neigh.default.gc_thresh3 = 4096
net.ipv6.neigh.default.gc_thresh1 = 1024
net.ipv6.neigh.default.gc_thresh2 = 2048
net.ipv6.neigh.default.gc_thresh3 = 4096
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Intermittent “no route to host” on local subnet | table overflow | `dmesg` overflow, `ip neigh | wc -l` |
| Many `FAILED` or `INCOMPLETE` | host down, or GC thrashing | `ip neigh show nud failed` |
| Works after flush, fails again | sustained high churn or too-small thresh | count over time, sysctl |
| Only IPv6 broken | separate ipv6 thresh | `sysctl net.ipv6.neigh...` |
| Container host suddenly loses pod reachability | many veth MACs | neigh count vs thresh3 |

## Investigation Tips

- Check `dmesg` or journal for the exact overflow message before raising limits. Raising masks a scan or a loop.
- Count entries: `ip neigh show | awk '{print $1}' | sort | uniq | wc -l`.
- On a hypervisor, the host table sees every guest MAC on the bridge. Size for the worst case.
- `gc_thresh3` must be > `gc_thresh2` > `gc_thresh1`. Set all three.
- After raising, confirm with a new connection that was previously failing.
- Prefer smaller L2 domains or routing over giant flat networks; the table is a symptom.

## Related Notes

- [[ARP and Neighbor Discovery]]
- [[sysctl and Resource Limits]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Troubleshooting Methodology]]
- [[ip Deep Dive]]

## Personal Lessons Learned

- A new Kubernetes node with 200 pods on a flat bridge hit `gc_thresh3=1024`. Pods could not reach the service CIDR until we raised the thresholds and confirmed no overflow in dmesg. The “network policy bug” was the neighbor table.
- Flushing the table during the incident made it worse for 30 seconds (ARP storm). We raised the sysctl first, then let GC work.
