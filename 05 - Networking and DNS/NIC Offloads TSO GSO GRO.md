# NIC Offloads TSO GSO GRO

## Concept

Modern NICs and the kernel cooperate to segment and reassemble TCP:

- **TSO** (TCP Segmentation Offload) / **GSO** (Generic Segmentation Offload): the stack hands the NIC a large chunk; the NIC (or a software fallback) chops it into MTU-sized segments.
- **GRO** (Generic Receive Offload) / **LRO** (Large Receive Offload): the NIC or driver coalesces inbound segments into larger skbs before they hit the stack.
- Checksum offload moves the TCP/UDP checksum to the NIC. Captures then show “bad checksum” that the wire never saw.

These are performance features. They also make `tcpdump` and some latency measurements lie.

## Why it matters

- A capture that shows 64 kB “packets” or bad checksums is usually offload, not a broken NIC or a middlebox.
- Disabling TSO/GRO on a busy 10/25/40G interface raises softirq CPU and can become the outage you were trying to diagnose.
- Some middleboxes, older tunnels, or certain bond modes misbehave with TSO. The symptom is stalls or retransmits only on large writes.
- GRO can increase latency for small interactive flows if the driver holds packets to coalesce. Rare, but real on some drivers.

## Mental Model

```
Application  write(64 kB)
    → TCP stack builds a large skb
    → GSO/TSO marks it
    → driver / NIC segments to MTU
    → wire

Wire  →  NIC
    → LRO/GRO coalesces
    → stack sees one large skb
    → tcpdump (on the host) sees the large skb, not the wire segments
```

`ethtool -k` shows what is currently enabled. Changes with `ethtool -K` are runtime only unless a udev rule or network config reapplies them.

## Key Commands

```bash
# What is on
ethtool -k eth0 | grep -E 'tcp-segmentation|generic-segmentation|generic-receive|large-receive|rx-checksum|tx-checksum|scatter-gather'

# Temporary disable for a clean capture (put them back)
ethtool -K eth0 tso off gso off gro off

# Capture while they are off if you need true wire size
tcpdump -ni eth0 -s 0 -w /tmp/clean.pcap

# Hardware counters that climb when the NIC is unhappy
ethtool -S eth0 | grep -E -i 'err|drop|fifo|miss'

# Confirm link and rings while you are there
ethtool eth0
ethtool -g eth0
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| tcpdump shows bad checksums on every packet | rx/tx checksum offload | `ethtool -k`; Wireshark offload note |
| Giant segments in a host capture | TSO/GRO | `-k`, disable only for the capture |
| Throughput collapses after “fixing” checksums | TSO/GRO left off | `ethtool -k`, softirq CPU |
| Large-write stalls, small packets fine | TSO interaction with tunnel or middlebox | disable TSO on the affected path, test |
| Retransmits only above a certain size | PMTU + TSO, or offload bug | `ethtool -k`, Path MTU |
| Latency spikes on small flows | Aggressive GRO on some drivers | `ethtool -k gro`, test with gro off |

## Investigation Tips

- Never leave TSO/GRO off on a production NIC as a permanent “fix” unless you have measured the CPU cost and accepted it.
- For a one-off capture, disable, capture, re-enable, and note the window in the ticket.
- `tcpdump -i eth0` on the host sees post-GRO / pre-TSO packets. A span port or a capture on the far side sees the wire.
- If you must disable permanently (rare driver bug), put the `ethtool -K` in a udev rule or the network config so it survives reboot.
- Bond and bridge setups still honour the physical NIC’s offloads. Check the slave, not only the bond device.
- Cloud virtual NICs often have a reduced offload set. `ethtool -k` still tells the truth for that vNIC.

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[tcpdump Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Softirqs and NAPI]]
- [[Path MTU Discovery and Blackholes]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I filed three “corrupt packet” tickets before I learned that checksum offload makes every capture look broken. The application never saw a bad checksum.
- Disabling TSO “to be safe” on a 25G storage network doubled softirq CPU and made the original latency problem worse. Measure, then decide.
