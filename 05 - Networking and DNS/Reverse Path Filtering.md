# Reverse Path Filtering

## Concept

`rp_filter` (reverse path filtering) drops packets whose source address would not be routed back out the interface they arrived on. It is an anti-spoofing check. Strict mode (`1`) is the common default; loose mode (`2`) accepts if the source is reachable via any interface; `0` disables it.

Asymmetric routing, multi-homed hosts, and certain VPN or cloud paths make strict mode drop legitimate packets. The symptom is "packets leave, replies never arrive" or one-way connectivity that looks like a firewall.

## Why it matters

- Strict `rp_filter` on a multi-homed or policy-routed host silently discards return traffic.
- The drop is often invisible in application logs. `tcpdump` on the interface shows the packet; the stack never sees it.
- Loose mode is the usual fix when you have intentional asymmetric paths and still want some protection.
- Per-interface settings exist. A global `net.ipv4.conf.all.rp_filter=1` plus a per-device override is easy to get wrong.

## Mental Model

```
Packet arrives on eth0 with src S, dst D
  kernel asks: if I wanted to send to S, would I use eth0?
  strict (1): yes → accept; no → drop
  loose (2): is S reachable via any interface? yes → accept
  off (0): accept

Common triggers for false drops:
  - two NICs, default route on one, traffic arriving on the other
  - policy routing (ip rule) that selects a different table
  - VPN / overlay that delivers packets on a tunnel interface
  - cloud source/destination check already done elsewhere
```

## Key Commands

```bash
# Current values
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.default.rp_filter
sysctl -a | grep rp_filter

# Per interface
sysctl net.ipv4.conf.eth0.rp_filter
sysctl net.ipv4.conf.eth1.rp_filter

# Temporary change (incident)
sysctl -w net.ipv4.conf.all.rp_filter=2
sysctl -w net.ipv4.conf.eth0.rp_filter=2

# Persist
# /etc/sysctl.d/99-rp_filter.conf
# net.ipv4.conf.all.rp_filter = 2
# net.ipv4.conf.default.rp_filter = 2

# Confirm the path the kernel would use
ip route get <src-of-dropped-packet>
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Packets arrive (tcpdump) but app never sees them | strict rp_filter drop | `sysctl` rp_filter, `ip route get` the src |
| Works on one NIC, fails on the other | per-interface strict mode | compare `conf.ethX.rp_filter` |
| After adding a second interface or policy route | new asymmetry | `ip rule`, `ip route get` |
| VPN clients one-way | tunnel interface vs main table | rp_filter on the tunnel and main NICs |
| Intermittent after failover | metric or table change exposed asymmetry | route get before/after |

## Investigation Tips

- `tcpdump -i eth0` shows the packet; if the application and `ss` never see the connection, suspect rp_filter or a raw drop before the stack.
- Run `ip route get <source address of the incoming packet>`. If the answer is not the arrival interface, strict mode will drop it.
- Prefer loose (`2`) over off (`0`) when you need asymmetric paths. Off removes the check entirely.
- Check both `all` and the specific interface. The effective value is the more restrictive of the two on many kernels.
- Cloud "source/destination check" is a related but separate control. Disabling it does not disable rp_filter.
- Document why you relaxed it. The next person will turn it back to 1 "for security" and recreate the outage.

## Related Notes

- [[Routing]]
- [[ip Command Deep Dive]]
- [[Firewall and NAT]]
- [[Policy Based Routing]]
- [[TCP IP Troubleshooting Model]]
- [[sysctl and Resource Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A dual-homed management/storage host had perfect pings on the management NIC and silent drops on the storage NIC. `rp_filter=1` on both, default route only on management. Loose mode on the storage interface fixed it in one line.
- I have watched a "firewall" ticket run for an hour when `tcpdump` already proved the packets were on the wire. Checking `rp_filter` is now in the first five minutes of any one-way path.
