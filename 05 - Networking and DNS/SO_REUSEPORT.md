# SO_REUSEPORT

## Concept

`SO_REUSEPORT` lets multiple sockets bind to the same IP:port. The kernel distributes incoming connections (or datagrams) across those sockets, usually by a hash of the 4-tuple. It is how a single process (or multiple processes) can scale a listener without a userspace load balancer in front.

Introduced for UDP, later extended to TCP. Not the same as `SO_REUSEADDR`.

## Why it matters

- Removes the single accept() bottleneck on high-connection-rate services (HTTP, DNS, proxies)
- Lets you restart one worker without dropping the listen socket for the others
- Misuse creates silent uneven distribution or “connection refused” for some clients
- Cloud load balancers and some service meshes rely on it; understanding the kernel side prevents “the LB is broken” tickets that are actually bind behavior

If you see multiple processes listening on the same port and traffic is uneven, this is usually the reason.

## Mental Model

```
Without SO_REUSEPORT:
  one socket owns the port → one accept queue

With SO_REUSEPORT:
  N sockets share the port
  kernel picks a socket (hash of tuple) → that socket’s accept queue

Distribution is not round-robin. It is sticky per 4-tuple.
Hot source IPs can pin traffic to one worker.
```

`ss -tulpn` will show multiple PIDs on the same sport. That is expected, not a bug.

## Key Commands

```bash
# See who is sharing the port
ss -tulpn sport = :80
ss -tulpn sport = :443

# Check the socket option (from /proc or ss extended)
ss -ltnp
cat /proc/net/tcp | head

# Application-side (example with socat or a small test)
# Most modern servers (nginx, envoy, unbound, etc.) enable it via config

# Kernel sysctl that interacts
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
```

Nginx: `reuseport` on the listen directive. Envoy and many Go servers enable it by default when they detect the option.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| One worker at 100% CPU, others idle | Hash skew from a few hot clients or health-check source | `ss -ti`, connection counts per PID, source IP distribution |
| “Address already in use” on restart | Old process still bound, or SO_REUSEPORT not set on the new socket | `ss -tulpn`, process list |
| Connections refused under load | Backlog full on the chosen socket, not the global one | per-socket Recv-Q, `somaxconn` |
| Works on one host, fails on another | Kernel too old (< 3.9) or option disabled | `uname -r`, application logs |
| Uneven after adding workers | Existing connections stay on old sockets; only new ones redistribute | Wait for churn or restart all |

## Investigation Tips

- Confirm the option is actually set. Application config saying “reuseport” is not proof the socket has it.
- Count established connections per PID (`ss -tnp | awk ...`) rather than trusting CPU. Skew is common.
- Health checks from a single IP (or a small set) will pin to one worker. That is correct behavior, not a bug.
- When scaling out, restart all workers together if you need even distribution immediately. Otherwise wait for natural connection turnover.
- Combine with [[ss Deep Dive]] and application metrics. The kernel distribution is only half the story; the app must also be balanced in work per connection.

## Related Notes

- [[ss Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[HAProxy Operations]]
- [[Connection Exhaustion]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “load balancer is sending everything to one backend” incident was actually SO_REUSEPORT plus a monitoring probe that always used the same source IP. The kernel was doing exactly what it was designed to do.
- Enabling reuseport on a service that was already under memory pressure made one worker OOM while others sat idle. Always watch per-process metrics after the change.
