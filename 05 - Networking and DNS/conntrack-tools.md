# conntrack-tools

## Concept

`conntrack` (from the conntrack-tools package) reads and writes the kernel’s connection-tracking table. The table is what makes stateful firewalls, NAT, and “established” rules work. When it fills, new connections fail even though the network is fine.

## Why it matters

- “Connection refused” or timeouts with empty application logs are often a full `nf_conntrack` table.
- NAT and masquerade stop working for new flows when the table or its buckets are exhausted.
- Asymmetric routing or a flapping firewall can leave stale entries that black-hole return traffic.
- You can list, delete, or count entries without guessing from `ss` or packet captures.

## Mental Model

```
packet
    → conntrack lookup (or create)
    → state: NEW / ESTABLISHED / RELATED / INVALID
    → NAT if configured
    → firewall decision

table size = nf_conntrack_max
hash buckets = nf_conntrack_buckets
when full: new SYNs are dropped (often silently)
```

Each tracked flow consumes an entry until it times out or is closed. UDP and half-open TCP are the usual fillers.

## Key Commands

```bash
# Is the table healthy?
conntrack -S          # summary: entries, searched, found, new, invalid, ...
conntrack -C          # current count
sysctl net.netfilter.nf_conntrack_max
sysctl net.netfilter.nf_conntrack_count

# List (can be huge — filter)
conntrack -L -p tcp --dport 443
conntrack -L -s 10.1.2.3

# Delete one flow (incident)
conntrack -D -p tcp --orig-src 10.1.2.3 --orig-dst 10.9.9.9

# Watch events
conntrack -E

# After a rule change that should have flushed state
conntrack -F          # flush all — disruptive
```

Raise the limit only after you understand why it filled:

```bash
sysctl -w net.netfilter.nf_conntrack_max=262144
# and make it persistent
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| New connections fail, established continue | table full | `conntrack -C` vs max |
| NAT works for a while then stops | same, or bucket exhaustion | `-S`, dmesg `nf_conntrack: table full` |
| `dmesg` `table full, dropping packet` | max too low for the workload | count, raise, or reduce timeouts |
| Asymmetric path, replies dropped | no conntrack entry on the return path | `-L` on both firewalls |
| High “invalid” or “insert_failed” | hash collisions or table pressure | `-S`, buckets |
| Conntrack memory grows without bound | very long timeouts, or UDP floods | timeout sysctls, `-L` top talkers |
| Rules “don’t work” after reload | old state still ESTABLISHED | flush or wait for timeout |

## Investigation Tips

- `conntrack -S` first. If `entries` is within a few percent of `max`, stop looking at the application.
- Filter `-L` hard. A full table dump on a busy NAT gateway can be hundreds of megabytes and can itself cause load.
- Compare the count to the number of sockets in `ss -s`. A large gap means many half-open or UDP entries that `ss` does not show.
- After raising `nf_conntrack_max`, also raise `nf_conntrack_buckets` (roughly max/4) or lookups become expensive.
- Timeouts: `nf_conntrack_tcp_timeout_established` of five days is normal; a UDP timeout of 180 s on a DNS-heavy box fills the table. Tune the specific timeout, not only the max.
- In containers or Kubernetes the table is usually on the host. A pod network that NATs heavily will fill the host’s table.
- Flushing (`-F`) drops every tracked flow. Do it only when you have confirmed the table is the problem and you can accept a brief reconnect storm.

## Related Notes

- [[nf_conntrack and Connection Tracking]]
- [[Firewall and NAT]]
- [[nftables Deep Dive]]
- [[firewalld Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]

## Personal Lessons Learned

- A “random” API timeout storm was `nf_conntrack: table full` in dmesg. The application team had already restarted every pod. `conntrack -C` would have ended it before the restarts.
- I raised `nf_conntrack_max` to 1 M on a small VM and the box started swapping. The table is not free. Size it to the workload and the RAM.
