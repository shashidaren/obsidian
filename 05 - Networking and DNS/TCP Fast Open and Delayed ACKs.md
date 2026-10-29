# TCP Fast Open and Delayed ACKs

## Concept

TCP Fast Open (TFO) lets a client send data in the SYN packet using a cookie, saving one RTT on subsequent connections to the same server. Delayed ACK is the receiver’s habit of waiting up to 40 ms (or for a second segment) before sending an ACK, which interacts badly with small writes and with Nagle’s algorithm.

Both are latency features that become latency bugs under the wrong workload. TFO is disabled by default on many distributions because of middle-box and security concerns. Delayed ACK is on by default and is the usual suspect when a request/response protocol shows a mysterious 40 ms floor.

## Why it matters

- A chatty protocol (database protocol, HTTP/1.1 with small requests, certain RPC) can pay 40 ms per round-trip purely from delayed ACK + Nagle.
- TFO cookies are cached; a middle-box that strips unknown TCP options silently disables TFO and you only notice in packet captures.
- Enabling TFO on a public server without rate-limiting the cookie request path can be abused for amplification.
- Applications that do many short connections (API gateways, service meshes) gain the most from TFO and lose the most when it is broken.

## Mental Model

```
Normal handshake:  SYN → SYN-ACK → ACK+data     (1 RTT before data)
TFO:               SYN+cookie+data → SYN-ACK    (data in first RTT)

Delayed ACK: receiver waits for second segment or 40 ms timer
Nagle: sender waits for ACK before sending small segment
→ together they deadlock until the timer fires
```

## Key Commands

```bash
# TFO sysctls
sysctl net.ipv4.tcp_fastopen
# 1 = client, 2 = server, 3 = both

# See if TFO is actually used
ss -tie | grep -i fastopen
nstat -az | grep -i FastOpen

# Delayed ACK is not a single sysctl; it is per-socket and interacts with tcp_delack_min
sysctl net.ipv4.tcp_delack_min   # newer kernels

# Capture to prove the 40 ms
tcpdump -i any -nn -tttt host <peer> and port <port>
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Consistent ~40 ms added latency | delayed ACK + Nagle | tcpdump timestamps, `TCP_NODELAY` |
| TFO “enabled” but no savings | middle-box strips option or cookie missing | tcpdump SYN options, `nstat` |
| TFO works once then stops | cookie rejected or black-holed | server logs, client cache |
| Small RPC slower than large | Nagle holding data | application sets `TCP_NODELAY` |
| Public server CPU spike after enabling TFO | cookie request flood | rate-limit, monitor `TcpExtTCPFastOpenListenOverflow` |

## Investigation Tips

- The 40 ms signature is almost always delayed ACK. Confirm with a packet capture that shows the ACK arriving ~40 ms after the data segment with no second segment in between.
- `TCP_NODELAY` (disable Nagle) on the sender usually removes the interaction. It does not disable delayed ACK on the receiver.
- TFO requires both ends and a path that passes the option. Test with `curl --tcp-fastopen` or a small client before enabling fleet-wide.
- On servers, `tcp_fastopen=2` or `3` is the usual setting. Watch the listen overflow counter; it means the TFO queue is full.
- Do not enable TFO on a service that is already behind a TLS terminator unless you have measured the gain; the TLS handshake dominates.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[TCP Congestion Control]]
- [[TCP Memory and Socket Buffers]]
- [[tcpdump Deep Dive]]
- [[ss Deep Dive]]
- [[Performance Investigation Framework]]

## Personal Lessons Learned

- A Java service showed a hard 40 ms floor on every small request. Packet capture confirmed delayed ACK. Setting `TCP_NODELAY` on the client socket removed it; no kernel change was required.
- TFO was turned on in a sysctl image and never used. A middle-box was stripping the option. The `nstat` counters stayed at zero until the path was fixed.
- Enabling TFO on an internet-facing API without a cookie rate limit produced a noticeable CPU increase from forged cookie requests. The feature was left off for that service.
