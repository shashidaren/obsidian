# TCP Memory and Socket Buffers

## Concept

TCP performance on high-bandwidth or high-latency paths is limited by the amount of data that can be in flight. That amount is the bandwidth-delay product, and it is constrained by socket buffer sizes (`net.core.rmem_max`, `net.ipv4.tcp_rmem`, `tcp_wmem`) and by the window scaling the peer negotiated.

Autotuning usually works. Manual increases help long-fat networks and hurt memory on a host with tens of thousands of connections.

## Why it matters

- A 10 Gbit link across 50 ms RTT needs multi-megabyte windows. Default buffers leave the link idle.
- Too-large buffers on a busy proxy or load balancer consume RAM proportional to connection count.
- `ListenOverflows` is the accept queue (`somaxconn`); socket buffers are the data path after accept. Different problems.
- Window scaling disabled or middleboxes that strip it caps throughput at ~64 KiB windows.

## Mental Model

```
app write() → tcp_wmem (send buffer) → wire → peer tcp_rmem (receive buffer) → app read()

Effective window ≈ min(local send buffer, remote receive window, congestion window)

Defaults (typical):
  tcp_rmem = 4096 87380 6MB-ish
  tcp_wmem = 4096 16384 4MB-ish
  rmem_max / wmem_max cap the setsockopt maximum
```

`ss -m` shows the current buffer use and the max for a socket. `cwnd` and `rtt` come from `ss -i`.

## Key Commands

```bash
# Current autotune ranges and hard caps
sysctl net.ipv4.tcp_rmem net.ipv4.tcp_wmem net.core.rmem_max net.core.wmem_max

# Window scaling enabled?
sysctl net.ipv4.tcp_window_scaling

# Live socket memory use (look at skmem and the rcv/snd queues)
ss -timnp | head -20
ss -m sport = :443 | head

# How much TCP memory the kernel is using
cat /proc/net/sockstat
grep -E 'TCP|mem' /proc/net/sockstat

# Temporary raise for a test (do not leave huge on a connection-heavy host)
sysctl -w net.core.rmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
```

Application-level `SO_RCVBUF` / `SO_SNDBUF` can override the autotune for that socket, up to the `*_max` sysctls.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Throughput stuck far below link speed on a long path | buffers too small for BDP | RTT × bandwidth, `ss -i` cwnd, sysctl values |
| Host RAM climbs with connection count | buffers raised globally | `sockstat`, connection count, consider per-app tuning |
| After raising buffers, no change | peer window or congestion window is the limit | `ss -i` on both ends |
| Window scaling off | old middlebox or explicit disable | `tcp_window_scaling`, capture the SYN options |
| High retransmits after buffer change | unrelated; do not assume buffers fixed loss | `nstat` TcpRetransSegs, path MTU |
| `ENOBUFS` on send | send buffer full and app not handling EAGAIN | app write path, `tcp_wmem` |

## Investigation Tips

- Calculate a rough BDP before you change numbers: bandwidth (bytes/s) × RTT (seconds). If the default max is already larger, buffers are not the problem.
- Look at `ss -i` for `cwnd`, `rtt`, and `bytes_acked`. A small cwnd means congestion or loss, not buffer size.
- Raise buffers on the receiver for a download-heavy workload, on the sender for an upload-heavy one, or both. Autotune often does this already.
- On a proxy with 100k connections, a 16 MiB max buffer is a memory bomb if many sockets actually use it. Prefer modest increases and measure `sockstat`.
- Window scaling is negotiated in the SYN. If a middlebox strips the option, both sides fall back to 64 KiB. tcpdump the handshake.
- Do not tune buffers to "fix" packet loss. Loss reduces cwnd regardless of buffer size.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[sysctl and Resource Limits]]
- [[Path MTU Discovery and Blackholes]]
- [[nf_conntrack and Connection Tracking]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A cross-region rsync sat at 200 Mbit/s on a 10 Gbit path. RTT was 40 ms. Raising `tcp_rmem`/`tcp_wmem` max to 16 MiB on both ends moved it to line rate. The default max had been fine for LAN and wrong for the WAN.
- I raised `rmem_max` fleet-wide on a busy API tier and watched memory graphs climb. Most sockets never needed it. The change was reverted; only the backup hosts kept the larger values.
