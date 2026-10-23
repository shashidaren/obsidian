# Path MTU Discovery and Blackholes

## Concept

Path MTU Discovery (PMTUD) lets a sender learn the smallest MTU on the path so it does not send packets that will be dropped. Classic PMTUD relies on ICMP "Fragmentation Needed" messages. When those are filtered, large packets vanish and small ones succeed — a blackhole.

Modern stacks also use Packetization Layer PMTUD (PLPMTUD) over TCP, which does not need ICMP. Both can still fail.

## Why it matters

- "Small requests work, large uploads or downloads hang" is the classic symptom. DNS, SSH key exchange, and TLS handshakes often still succeed because they are small.
- Tunnels (WireGuard, IPsec, VXLAN, cloud overlays) reduce the effective MTU. If the outer MTU is 1500 and the tunnel overhead is not accounted for, inner packets larger than ~1420 are dropped.
- Firewalls that drop all ICMP, or rate-limit it hard, break classic PMTUD. The connection stalls after the first full-sized segment.
- Database replication, backup streams, and container image pulls are common victims because they send large segments.

Fix the MTU or the ICMP policy before you tune application timeouts.

## Mental Model

```
Sender assumes path MTU = local interface MTU (usually 1500)
    → sends large TCP segment with DF bit set
    → router with smaller MTU should send ICMP Fragmentation Needed
    → sender lowers MSS / path MTU

If ICMP is dropped:
    large packets disappear
    small packets (and retransmits of small ones) still work
    TCP stalls waiting for ACKs that never come for the big segments
```

`ip route get` and `tracepath` show what the kernel currently believes. `tcpdump` of ICMP type 3 code 4 confirms whether the message is arriving.

## Key Commands

```bash
# What MTU does this path think it has?
ip route get <destination>
tracepath -n <destination>
ping -M do -s 1472 <destination>   # 1472 + 28 = 1500; DF set

# Interface MTU
ip link show <iface>
ethtool <iface> | grep -i mtu   # some drivers

# MSS clamping (when you cannot fix the path)
# nftables example
nft add rule inet filter forward tcp flags syn tcp option maxseg size set 1380

# See current path MTU cache
ip route show cache

# Capture the smoking gun
tcpdump -ni any icmp and host <destination>
tcpdump -ni <iface> host <destination> and greater 1400
```

Common safe values when a tunnel is involved:

- WireGuard / many VPNs: 1420 or lower
- IPsec: often 1400
- VXLAN: 1450

Set the tunnel interface MTU explicitly rather than hoping PMTUD works.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Small packets work, large hang | PMTUD blackhole | `ping -M do -s 1400`, `tracepath` |
| Works on LAN, fails over VPN | tunnel overhead not subtracted | tunnel MTU, `ip link` |
| Intermittent after firewall change | ICMP Fragmentation Needed now dropped | `tcpdump icmp`, firewall logs |
| TCP stalls, retransmits of full segments | DF set, no ICMP reply | packet capture both ends |
| `tracepath` stops early | ICMP filtered mid-path | compare with `ping -M do` sizes |
| After raising interface MTU, worse | path still has a smaller hop | `tracepath`, cloud MTU limits |

## Investigation Tips

- Reproduce with `ping -M do -s <size>`. Binary-search the largest size that works. 1472 succeeds on a clean 1500 path; 1400 or lower often reveals the tunnel.
- Check both directions. Asymmetric MTU or firewall policy is common.
- On the receiving host, confirm the large segments arrive (`tcpdump greater 1400`). If they do not, the drop is on the path.
- Cloud load balancers and security groups sometimes have their own MTU or ICMP behaviour. Test from the same network path the application uses.
- MSS clamping on the firewall or the tunnel endpoint is a reliable workaround when you cannot control every hop. Document why it is there.
- After you lower a tunnel MTU, existing connections keep the old path MTU until they expire or you flush the route cache. New connections pick up the change.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[tcpdump Deep Dive]]
- [[WireGuard Operations]]
- [[Firewall and NAT]]
- [[ip Command Deep Dive]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A database replica lag alert fired only for large transactions. Small heartbeats were fine. `tracepath` through the site-to-site VPN stopped at 1420. Setting the WireGuard MTU explicitly ended the stalls; PMTUD had been broken by an ICMP filter for months.
- Raising the physical NIC to 9000 on one side without matching the path created a blackhole for jumbo frames. The monitoring pings (small) stayed green.
- An MSS clamp rule added during an incident was never removed. Years later a new low-latency path was still clamped. The comment in the ruleset was the only reason we found it.
