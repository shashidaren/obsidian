# nf_conntrack and Connection Tracking

## Concept

nf_conntrack is the Netfilter connection tracking subsystem. It maintains a table of flows so the firewall can allow return traffic, apply NAT, and enforce stateful rules without matching every packet against the full ruleset.

When the table fills, new connections are dropped even if the policy would have allowed them. The symptoms look like random application failures under load.

## Why it matters

- Conntrack exhaustion is a classic "it works until peak traffic" incident.
- Health checks, scanners, or short-lived connections can fill the table faster than real user traffic.
- NAT (SNAT/DNAT/MASQUERADE) requires conntrack. Asymmetric routing or missing helpers break return traffic.
- Default timeouts and table sizes are conservative on many distros. A busy NAT gateway or load-balancer host will hit them.

## Mental Model

```
Packet arrives
  → conntrack lookup (or create new entry)
  → if table full → drop (often silent)
  → otherwise apply policy / NAT using the tracked state
  → entry ages out according to timeout for its state
```

States you care about: NEW, ESTABLISHED, RELATED, INVALID.

The table size is `nf_conntrack_max`. Current usage is `nf_conntrack_count`. Both are in `/proc/sys/net/netfilter/`.

## Key Commands

```bash
# Current vs max
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max

# If conntrack-tools is installed
conntrack -C
conntrack -L | head
conntrack -S

# Kernel messages when full
dmesg | grep -i conntrack
journalctl -k | grep -i conntrack

# Timeouts (common levers)
sysctl net.netfilter.nf_conntrack_tcp_timeout_established
sysctl net.netfilter.nf_conntrack_tcp_timeout_time_wait

# Raise temporarily (persist in sysctl.d)
sysctl -w net.netfilter.nf_conntrack_max=262144

# Watch growth
watch -n1 'cat /proc/sys/net/netfilter/nf_conntrack_count'
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Random connection failures at peak | Table full | count vs max; dmesg |
| Works from localhost, fails remotely under load | Conntrack or filter on external path | tcpdump + count |
| NAT works for a while then breaks | Table full or entry timeout | count, timeouts, asymmetric route |
| FTP/SIP/etc broken through NAT | Missing helper | `lsmod \| grep nf_conntrack_ftp` |
| High count but low real traffic | Health checks or scanners creating short flows | `conntrack -L` sample, source IPs |
| Change to max vanishes after reboot | `sysctl -w` only | file in `/etc/sysctl.d` |

## Investigation Tips

- Check count vs max before you start adding firewall rules. A full table drops packets before the rule is evaluated.
- Sample the table (`conntrack -L | head` or `ss` states) to see whether the entries are established long-lived or short NEW/TIME-WAIT.
- Health checks that open a new TCP connection every second from many sources are a common filler. Fix the checker or raise the table and shorten timeouts.
- Raising `nf_conntrack_max` increases memory use. On a memory-constrained host, also look at reducing unnecessary flows.
- For pure routing hosts that do not need stateful filtering, some operators disable conntrack on specific interfaces, but that is an advanced change with side effects. Prefer sizing the table first.
- IPv6 has its own tracking. A v4-only check can miss v6 exhaustion.

## Related Notes

- [[Firewall and NAT]]
- [[nftables Deep Dive]]
- [[firewalld Deep Dive]]
- [[ss Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A load-balancer host started dropping new backend connections at 18:00 every day. `nf_conntrack_count` sat on the default 65k max. Hundreds of health checks from the cloud LB were creating short flows. Raising the max bought time; reducing check frequency was the real fix.
- dmesg had been logging "nf_conntrack: table full, dropping packet" for hours. Nobody grepped the kernel log until the application team escalated "flaky network".
