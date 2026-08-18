# tcpdump Deep Dive

## Concept

`tcpdump` captures and displays packets on a network interface.  
It is the standard tool for proving what is actually happening on the wire.

## Why it matters

When higher-level tools (`curl`, application logs, `ss`) are not enough, packet captures give definitive evidence about:
- Whether packets are arriving
- TCP handshakes and resets
- Retransmissions
- DNS queries/responses
- TLS ClientHello / ServerHello (when not encrypted in a way that hides everything)

## Mental Model

```
tcpdump [options] [filter expression]
```

Filters are written in BPF (Berkeley Packet Filter) syntax and are critical for keeping captures usable in production.

## Key Commands

```bash
# Basic capture on an interface
tcpdump -i eth0

# Don’t resolve names (faster, clearer)
tcpdump -i eth0 -n

# Capture only a specific host or port
tcpdump -i eth0 host 10.0.0.5
tcpdump -i eth0 port 443
tcpdump -i eth0 host 10.0.0.5 and port 443

# Write to a file (then analyse with Wireshark or tcpdump -r)
tcpdump -i eth0 -w capture.pcap host 10.0.0.5

# Read a saved capture
tcpdump -r capture.pcap -n

# Show more packet content
tcpdump -i eth0 -A          # ASCII
tcpdump -i eth0 -X          # hex + ASCII

# Limit number of packets
tcpdump -i eth0 -c 100 port 80
```

### Useful filter examples

```bash
# SYN packets only (useful for connection attempts)
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'

# Traffic to/from a subnet
tcpdump -i eth0 net 10.0.0.0/24

# DNS
tcpdump -i eth0 port 53
```

## Common Use Cases

| Goal                              | Example filter / approach                  |
|-----------------------------------|--------------------------------------------|
| Is traffic reaching the server?   | `host <client-ip>` or `port <service>`     |
| TCP handshake problems            | Look for SYN / SYN-ACK / RST               |
| DNS issues                        | `port 53`                                  |
| Prove packets are leaving         | Capture on the correct interface           |
| Intermittent problems             | Capture to file with a reasonable snaplen  |

## Investigation Tips

- Always use `-n` in production troubleshooting to avoid DNS delays and noise.
- Prefer writing to a file (`-w`) for anything non-trivial, then analyse offline.
- Be careful with captures on busy interfaces — use tight filters.
- Remember that encrypted traffic (TLS) will not show application payloads.
- On modern systems, consider `tcpdump` vs `tshark` / Wireshark depending on need.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[curl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
