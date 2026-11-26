# ethtool Deep Dive

## Concept

`ethtool` queries and configures Ethernet NIC driver and hardware features: link speed, duplex, ring buffers, offloads, statistics, and firmware. It is the first tool when a link is flapping, dropping packets, or running slower than expected.

It talks to the driver. What it can show depends on the driver and hardware.

## Why it matters

- `ethtool -S` error counters (rx_errors, tx_errors, dropped, crc) often appear before the application notices.
- Ring buffer size affects drop under burst. Too small and you drop; too large and latency rises.
- Offloads (TSO, GSO, GRO, checksum) can hide or create problems for captures and middleboxes.
- Speed/duplex mismatch is still a thing on older hardware or bad cables.

## Mental Model

```
NIC hardware
  → driver (ethtool talks here)
    → kernel net stack
      → sockets

ethtool -S = hardware/driver counters
ethtool -k = offload features
ethtool -g = ring sizes
ethtool -a = pause frames
```

## Key Commands

```bash
# Link and features
ethtool eth0
ethtool -k eth0
ethtool -g eth0
ethtool -S eth0 | grep -E 'error|drop|crc|miss'

# Change (careful, can drop the link)
ethtool -s eth0 speed 1000 duplex full autoneg off
ethtool -G eth0 rx 4096 tx 4096

# Identify the NIC (blink the LED)
ethtool -p eth0 5
```

Persistent changes usually go in NetworkManager, systemd-networkd, or udev rules, not a one-shot ethtool.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Link down or flapping | Cable, SFP, autoneg, or driver | `ethtool eth0`, dmesg |
| Drops under load | Ring too small or CPU interrupt affinity | `-g`, `-S`, irqbalance |
| Capture missing packets | GRO/TSO coalescing | `-k`, disable temporarily |
| Speed stuck at 100 | Bad cable or forced wrong | `-s` test, cable |
| Pause frames causing latency | Flow control | `-a`, switch config |

## Investigation Tips

- Run `ethtool -S` early in a packet-loss ticket. Rising error counters are stronger evidence than application logs.
- Disable offloads only for diagnosis. Re-enable them; they exist for a reason.
- On bonds or bridges, check the underlying physical interfaces.
- Driver version and firmware matter. Note them in the ticket (`ethtool -i`).

## Related Notes

- [[Bonds Bridges VLANs and ethtool]]
- [[NIC Offloads TSO GSO GRO]]
- [[tcpdump Deep Dive]]
- [[Softirqs and NAPI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random packet loss” on a 10 Gbit link was rx ring at the default 256. Raising it to 4096 stopped the drops. ethtool -S showed the misses.
- Disabling GRO to make a tcpdump readable also changed the performance I was measuring. Capture on a span or use snaplen instead when possible.
