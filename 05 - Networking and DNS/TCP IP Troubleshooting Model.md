# TCP/IP Troubleshooting Model

## Concept

Network failures are layered. A systematic model stops you from debugging TLS when the interface has no carrier, or blaming DNS when nothing listens on the port.

Work **bottom-up** until the layer that breaks, then stop and fix that layer. Jumping to the application first is how incidents grow tails.

## Why it matters

- "Cannot connect" is not a diagnosis — refused, timed out, TLS error, and NXDOMAIN are different failures with different owners
- Most wasted time in network incidents is testing the wrong layer
- The same model works for bare metal, VMs, containers, and cloud security groups; only the tooling changes
- A shared vocabulary (refused vs timeout vs reset) lets on-call hand off without re-discovering the symptom

## Mental Model

```
7. Application     curl, app logs, auth, business errors
6. Presentation    TLS certificates, SNI, protocol version
5. DNS             name → address (only after IP path works)
4. Transport       TCP/UDP port, listen socket, firewalls
3. Routing         gateway, multi-hop reachability
2. Local stack     address, route table, policy routing
1. Link            carrier, MTU, ARP/ND, interface UP
```

Rules of thumb:

- If it fails **by IP**, do not touch DNS yet
- **Connection refused** ⇒ something reached the host; nothing accepted the port (or a firewall rejected with RST)
- **Connection timed out** ⇒ drop on path, wrong route, silent firewall, or dead remote
- **TLS errors** ⇒ you already have TCP; stay at the crypto/app layer

## Key Commands (by layer)

```bash
# 1–2 Link & local stack
ip -br link
ip -br addr
ip route show
ip route get <destination-ip>
ip neigh show                     # ARP/ND
ethtool <iface>                   # carrier, speed (when needed)

# 3 Routing / basic reachability
ping -c3 <gateway>                # if ICMP allowed
ping -c3 <remote-ip>
traceroute -n <remote-ip>         # or mtr

# 4 Transport — on the target host
ss -tulpn | grep <port>
ss -tanp state established,time-wait | head
# Local firewall sketches
nft list ruleset 2>/dev/null | head -100
iptables -L -n -v 2>/dev/null | head -50
firewall-cmd --list-all 2>/dev/null

# From the client: does anything answer?
nc -vz <ip> <port>
curl -v --connect-timeout 3 telnet://<ip>:<port>

# 5 DNS (after IP works)
getent hosts <name>
dig +short <name>
dig <name>.                       # absolute, no search domains

# 6–7 TLS / application
curl -vI https://<name>
openssl s_client -connect <ip>:443 -servername <name> </dev/null
```

Cloud path: repeat the same logic for security groups, network ACLs, and route tables. "It works from my laptop" often means your laptop is not subject to the same SG rules as the app tier.

## Common Failure Modes & Symptoms

| Symptom | First layer | Likely causes |
|---------|-------------|---------------|
| Nothing works, even by IP | Link / local / routing | Interface down, no route, wrong VRF, SG deny |
| Works by IP, fails by name | DNS | resolv.conf, search domains, split DNS |
| Connection refused | Transport | Process not listening, wrong port, local reject |
| Connection timed out | Routing / firewall | DROP rules, blackhole route, remote down |
| Accepts then resets | Transport / app | Backlog full, app crash on accept, middlebox |
| TLS handshake failure | Presentation | Cert, SNI, protocol mismatch, MITM proxy |
| HTTP 502/504 via LB | App / upstream | Upstream not listening, health check fail |
| Intermittent timeouts | Path / conntrack / MTU | Asymmetric route, NAT table full, blackhole MTU |
| Works from host, fails from Pod | CNI / NetworkPolicy / DNS | See [[Services DNS and Ingress]] |

## Investigation Tips

- Write down the **exact** symptom: source, destination IP:port, refused vs timeout vs TLS error, timestamp. Vague tickets produce random dig sessions.
- Prove each layer with one command before ascending. Do not run twenty tools in parallel and pattern-match the noise.
- `ip route get <dst>` tells you which interface and gateway the kernel will actually use — more reliable than reading the whole table by eye.
- Test from the **same network namespace** as the failing app (host vs container vs Pod). Host networking can lie about what the app sees.
- Firewalls that DROP produce timeouts; REJECT often produces refused. The distinction is diagnostic.
- Capture once when stuck: `tcpdump -ni <iface> host <ip> and port <port>` on both ends. SYN without SYN-ACK is a path/policy problem; handshake then RST is local to the target.
- MTU/PMTUD problems look like "small things work, large requests hang". Test with `ping -M do -s 1400` or curl large payloads only after basic TCP works.

## Related Notes

- [[ss Deep Dive]]
- [[DNS Resolution]]
- [[ip Command Deep Dive]]
- [[curl Deep Dive]]
- [[TLS Troubleshooting]]
- [[Firewall and NAT]]
- [[Services DNS and Ingress]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once chased application timeouts for an hour before noticing the Pod had no default route after a CNI glitch. `ip route` inside the netns would have ended it in a minute. Same model, correct namespace.
- "Connection refused" from a security group that was set to reject instead of the usual cloud default of drop sent us into app logs. Refused means you reached *something* — treat it differently from timeout.
- A middlebox was resetting TLS connections that used an old cipher. tcpdump showed RST right after ClientHello; the app log only said "connection reset". Packet capture sits between transport and presentation for a reason.
- On-call folklore of "just restart networking" fixed a host with a stale default route and taught the next person nothing. Document which layer failed.
