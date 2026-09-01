# tcpdump Deep Dive

## Concept

`tcpdump` captures packets from an interface (or a pcap file) using BPF filters. It is how you prove what is *on the wire* when `curl`, application logs, and `ss` disagree.

You are not “looking at the application”. You are looking at frames the kernel handed to the capture point.

## Why it matters

- Proves whether packets arrive, leave, get RST, or never exist
- Shows TCP handshake, retransmits, window-zero, and ICMP errors
- Settles DNS vs TCP vs TLS arguments with evidence
- Offline pcaps can be shared with another engineer or opened in Wireshark
- A tight 30-second capture often beats an hour of guesswork

If you cannot capture, you are guessing about the network.

## Mental Model

```
App  →  socket  →  kernel stack  →  NIC  →  wire
                 ↑
            tcpdump sees here (after filters, before or after some offload)
```

Important caveats:

- Capture point matters: client host, server host, and a middle box can each tell a different story.
- You see *this namespace / this interface*. Wrong `-i` → empty capture → false “no traffic”.
- TLS payloads are encrypted. You still see IP/TCP/SNI-ish handshake metadata, not HTTP bodies.
- Hardware offload (TSO/GRO) can make lengths and segment boundaries look odd. That does not always mean corruption.

Syntax:

```
tcpdump [options] [BPF filter]
```

Filter first. Unfiltered capture on a busy NIC is how you fill a disk and miss the packet you needed.

## Key Commands

```bash
# List interfaces tcpdump can see
tcpdump -D

# Numeric, no DNS lookups, moderate verbosity, specific NIC
tcpdump -ni eth0 -vv

# Any interface (handy on hosts with many NICs; noisier)
tcpdump -ni any port 443

# Host + port (the 80% case)
tcpdump -ni eth0 host 10.0.0.5 and port 443

# Write a pcap (do this for anything non-trivial)
tcpdump -ni eth0 -s 0 -w /tmp/case.pcap host 10.0.0.5 and port 443

# Read it back
tcpdump -nr /tmp/case.pcap
tcpdump -nr /tmp/case.pcap 'tcp[tcpflags] & tcp-syn != 0'

# Limit packet count or filesize so you cannot wedge the box
tcpdump -ni eth0 -c 200 port 53
tcpdump -ni eth0 -W 5 -C 50 -w /tmp/rot.pcap   # 5 files × 50 MB

# Snaplen: -s 0 (or 65535) for full packets; default may truncate
tcpdump -ni eth0 -s 0 -w /tmp/full.pcap port 80

# Payload views (cleartext only)
tcpdump -ni eth0 -A port 80
tcpdump -ni eth0 -X port 80

# Timestamps useful for correlation with app logs
tcpdump -ni eth0 -ttt port 443
```

### Filters that earn their keep

```bash
# SYN / SYN-ACK / RST
tcpdump -ni eth0 'tcp[tcpflags] & (tcp-syn|tcp-rst) != 0'

# Failed handshake suspects: SYN with no data, watch for missing SYN-ACK
tcpdump -ni eth0 'tcp[tcpflags] == tcp-syn'

# DNS
tcpdump -ni eth0 port 53

# ICMP (unreachables, PTB / fragmentation needed)
tcpdump -ni eth0 icmp

# Subnet
tcpdump -ni eth0 net 10.0.0.0/24

# Not your SSH session (avoid capturing yourself into a mess)
tcpdump -ni eth0 port not 22

# VXLAN / overlay examples often need the underlay port as well
tcpdump -ni eth0 port 4789 or port 8472
```

Quick one-liners for “is anything happening?”:

```bash
tcpdump -ni eth0 -c 20 host <client-ip>
tcpdump -ni eth0 -c 20 port 53
```

## Common Failure Modes & Symptoms

| Goal / symptom | What the capture usually shows | Meaning |
|---|---|---|
| Client timeout, empty server capture | No SYN on server NIC | Routing, security group, wrong VIP, or capture on wrong interface |
| Server sees SYN, no SYN-ACK | Local firewall, bind address, or app not accepting | `ss -tulpn`, nft/iptables, backlog |
| SYN + SYN-ACK, then RST | Something rejected after handshake (policy, proxy, app) | Check which side sends RST (`Flags [R.]`) |
| Repeated SYN, no answer | Packet loss or silent drop (often cloud SG / NACL / conntrack) | Capture both ends |
| Retransmissions, increasing seq gaps | Loss or severe reordering | Path / MTU / NIC errors |
| ICMP fragmentation needed | MTU mismatch, DF set | Clamp MSS, fix tunnel MTU |
| DNS query, no response | Resolver path or dropped UDP 53 | [[DNS Resolution]], [[dig Deep Dive]] |
| ClientHello only, no ServerHello | TLS middlebox or wrong backend | [[TLS Troubleshooting]] |
| Capture file empty | Wrong `-i`, filter too tight, or not enough privilege | `tcpdump -D`, drop filter, run as root |

## Investigation Tips

- Use `-n` always during incidents. DNS resolution of every address adds delay and can hang if DNS is the outage.
- Write `-w` and analyse offline. Live scrolling is how you miss the RST.
- Confirm the interface with `ip -br link` and `ip route get <dst>`. Capturing `eth0` while traffic leaves `ens192` or a tunnel is a classic own-goal.
- On VMs and containers, traffic may hit `any`, `cni0`, `flannel`, or `wg0` — not the interface you named in the runbook.
- Privilege: you need `CAP_NET_RAW` (root or a wrapper). Empty output is not proof of no packets.
- Keep filters tight and rotate files (`-C`/`-W`). A debug capture that fills `/` becomes a second incident.
- Correlate timestamps with `journalctl` and `curl -w`. One shared UTC clock saves arguments.
- Encrypted payloads will not help you debug application JSON. Use tcpdump for *transport* truth; use app logs for *business* truth.
- If server and client captures disagree, believe both: a middle box is rewriting or dropping.
- `tcpdump -r file | grep` is crude. For multi-stream issues, open the pcap in Wireshark and follow the TCP stream.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[curl Deep Dive]]
- [[ip Command Deep Dive]]
- [[DNS Resolution]]
- [[TLS Troubleshooting]]
- [[Firewall and NAT]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- “No packets” almost always meant I was on the wrong NIC or inside the wrong network namespace, not that the network was quiet.
- A 20-line SYN/RST capture has closed more tickets than a 2 GB unfiltered pcap I never had time to read.
- Cloud security groups drop silently. tcpdump on *both* ends is the only honest test.
- I now default to `-s 0 -w /tmp/case.pcap` with a host+port filter, then `tcpdump -nr` for SYNs and RSTs before I open Wireshark.
