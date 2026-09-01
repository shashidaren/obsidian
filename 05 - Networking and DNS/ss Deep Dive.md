# ss Deep Dive

## Concept

`ss` (socket statistics) is the modern replacement for `netstat`. It reads the kernel socket tables and shows listening ports, connection state, queues, and owning processes — faster and with more detail than `netstat` on busy hosts.

When a service is “not reachable”, `ss` is usually the first proof: is anything listening, and what state are the sockets in?

## Why it matters

- Confirms whether a daemon is actually bound to the port you think it is
- Distinguishes firewall / routing problems from “process never started”
- Exposes stuck TCP states (SYN-SENT, CLOSE-WAIT, TIME-WAIT floods)
- Recv-Q / Send-Q show back-pressure before users file tickets
- `ss -s` is a cheap connection-count dashboard during incidents

`netstat` still exists on some images; treat `ss` as the default.

## Mental Model

```
ss = kernel socket table snapshot

Listening sockets  →  “is the service up on this address:port?”
Established        →  live sessions
State machine      →  SYN-SENT / SYN-RECV / ESTAB / FIN-WAIT / CLOSE-WAIT / TIME-WAIT
Recv-Q / Send-Q    →  data waiting in kernel buffers (app too slow, or peer too slow)
-p                 →  which PID owns the socket (needs root for other users)
```

Remember: `ss` shows *this namespace*. In a container you only see that container’s sockets unless you enter the host / netns.

Common flags mentally:

- `-t` TCP, `-u` UDP, `-l` listening, `-a` all, `-n` numeric, `-p` process, `-s` summary

## Key Commands

```bash
# Everyday triage: TCP+UDP, listening+connected, numeric, with processes
ss -tunap

# Listening only (what can accept work?)
ss -tulpn

# Brief columns (easier to scan)
ss -tulpnH

# Connection summary (counts by state)
ss -s

# Established with process names
ss -tp state established

# Who is bound to this port?
ss -tulpn sport = :443
ss -tulpn sport = :22

# Traffic *to* a remote port (outbound clients)
ss -tp dport = :443

# Filter by address
ss -tp dst 10.0.0.5
ss -tp src 10.0.1.20

# Queue pressure: Recv-Q / Send-Q non-zero is a smell
ss -tn

# Memory / TCP info (cwnd, rtt, retrans) — gold during slowness
ss -ti

# Unix sockets (local IPC, often the real bottleneck)
ss -xlnp

# Namespace-aware (host view of a container netns)
ip netns exec <ns> ss -tulpn
nsenter -t <PID> -n ss -tulpn
```

### State filters you will actually use

```bash
ss -tn state syn-sent      # we cannot complete outbound handshake
ss -tn state syn-recv      # inbound SYNs not completing (syn flood or app/backlog)
ss -tn state fin-wait-1
ss -tn state fin-wait-2
ss -tn state time-wait     # recently closed; large counts can exhaust ports
ss -tn state close-wait    # local app did not close after peer FINed
ss -tn state last-ack
```

Count a state quickly:

```bash
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c | sort -nr
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| No LISTEN on expected port | Service down, crashed, bound to another IP, or wrong unit | `systemctl status`, unit logs, config listen address |
| LISTEN on `127.0.0.1` only | Bound to loopback; remote clients will never connect | Fix bind address / proxy |
| LISTEN on IPv6 `::` only, clients use IPv4 | Dual-stack surprise | Check `ss -tulpn` for `0.0.0.0` vs `*` |
| Connection refused from client | Nothing listening *or* local firewall RST | Confirm LISTEN, then iptables/nft |
| Many SYN-SENT | Outbound path blocked, remote down, or wrong destination | `ip route get`, `tcpdump`, security groups |
| Many SYN-RECV | Backlog full, app not `accept()`ing, or SYN flood | App health, `somaxconn`, capture |
| Pile of CLOSE-WAIT | Local process not closing sockets (bug or stuck thread) | `lsof -p`, thread dump, restart as last resort |
| Huge TIME-WAIT | High connection churn (short HTTP/1.0, health checks) | Tune reuse if needed; often application design |
| Recv-Q growing on LISTEN/ESTAB | Application not reading; CPU starve or deadlock | `top`/`pidstat`, app logs |
| Send-Q growing | Peer not ACKing; network or slow client | Capture, RTT from `ss -ti` |
| “Port already in use” on start | Old process, socket still bound, or TIME-WAIT on the port | `ss -tulpn sport = :N` |

## Investigation Tips

- Start with `ss -tulpn` before touching firewall rules. Half of “network is broken” is “daemon is not listening”.
- Always look at the *local address*, not just the port. Binding `127.0.0.1:8080` vs `*:8080` is a weekly foot-gun.
- `-p` needs privileges. Without root you only see your own processes; do not conclude “no owner”.
- `ss -s` + state counts are better than staring at thousands of lines. Summarise first, sample second.
- TIME-WAIT is *normal*. Panic only when you approach ephemeral port exhaustion (`ss -s`, `net.ipv4.ip_local_port_range`, `nf_conntrack_count`).
- CLOSE-WAIT is *not* normal if it accumulates. That is almost always an application bug.
- Combine with [[lsof Deep Dive]] when you need the exact file / deleted socket / extra FDs. Use `ss` for the state machine; use `lsof` for “what else is this PID holding?”.
- In Kubernetes, run `ss` in the *pod* to see the app bind, and on the *node* to see kube-proxy / host ports. They are different namespaces.
- `ss -ti` shows retransmits and RTT. If users say “slow” and Recv-Q is zero but `retrans` climbs, it is the path, not the app loop.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[File Descriptors]]
- [[lsof Deep Dive]]
- [[curl Deep Dive]]
- [[tcpdump Deep Dive]]
- [[ip Command Deep Dive]]
- [[Connection Exhaustion]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have wasted time “fixing iptables” when `ss -tulpn` would have shown the unit bound to localhost after a config management drift.
- CLOSE-WAIT piles are how I notice a Java thread pool wedged more often than how I notice a firewall.
- After a load-balancer health-check change, TIME-WAIT exploded and ephemeral ports ran out. `ss -s` caught it before CPU or RAM looked interesting.
- Always pair `ss` with `ip route get` and one targeted `curl -v`. Sockets tell you the kernel’s opinion; they do not prove the packet left the NIC.
