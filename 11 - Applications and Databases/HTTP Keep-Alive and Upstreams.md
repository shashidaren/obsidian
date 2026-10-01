# HTTP Keep-Alive and Upstreams

## Concept

HTTP keep-alive reuses a TCP (and TLS) connection for many requests. There are two separate pools:

- **Client → proxy** (frontend keep-alive)
- **Proxy → app** (upstream keep-alive)

They time out independently. A 502/504 that only happens on the *second* request on a connection is usually one side closing while the other still thinks the socket is good.

Not keepalived. That is [[Keepalived and VRRP]].

## Why it matters

- Turning keep-alive off doubles TLS cost and can melt a proxy under load
- Idle timeouts that do not match produce rare 502s that vanish when you `curl` once
- Upstream connection reuse hides DNS/backend changes until the old sockets die
- `keepalive_requests` / max requests per connection is how you bound memory leaks in workers
- Load-balancer idle timeout shorter than the proxy’s idle timeout drops long-poll and WebSockets

## Mental Model

```
Browser  --keepalive-->  nginx/haproxy  --keepalive-->  app workers
             idle 75s                      idle 60s

Whoever hits idle first sends FIN/RST.
The other side may still pick that socket for the next request → 502.
```

Set upstream idle *shorter* than the backend server’s keepalive timeout, so the proxy closes first. Never let the app close a socket the proxy still holds.

Also in the drawing: connect timeout, read timeout, send timeout. Keep-alive does not save you if `proxy_read_timeout` is 30s and the query takes 45s.

Pool size (`keepalive 32`) is connections *per nginx worker* to that upstream, not a cluster-wide cap. Do the multiplication before you congratulate yourself.

## Key Commands

```bash
# See reused vs new connections from this box
ss -ti dst :<app-port>
# look for keepalive / established count toward the upstreams

# nginx: confirm keepalive on the upstream block
grep -n -E 'upstream|keepalive|proxy_http_version|Connection' /etc/nginx/nginx.conf /etc/nginx/conf.d/*
nginx -t && nginx -s reload

# One-shot vs reused
curl -v http://127.0.0.1/healthz -o /dev/null
curl -v http://127.0.0.1/healthz http://127.0.0.1/healthz -o /dev/null
# second URL on the same curl process reuses the client connection

# Force a fresh TCP connection
curl -v --no-keepalive https://service.example/healthz

# Backend view: how many connections really exist?
ss -lntp | grep :8080
ss -tnp dst :8080 | wc -l

# HAProxy: idle and session reuse
echo "show info" | socat stdio /run/haproxy/admin.sock
echo "show stat" | socat stdio /run/haproxy/admin.sock | cut -d, -f1,2,5,8,18,34 | column -t -s,
```

nginx pattern that actually enables upstream reuse:

```
upstream app {
    server 10.0.0.11:8080;
    keepalive 32;
}
server {
    location / {
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass http://app;
    }
}
```

Without `proxy_http_version 1.1` and clearing `Connection`, `keepalive` on the upstream does nothing useful.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Occasional 502, single curl fine | Upstream closed idle socket first | Compare app keepalive vs proxy idle |
| 504 on long request | Read timeout, not keep-alive | `proxy_read_timeout` vs app p99 |
| WebSockets die at ~60s | LB or proxy idle timeout | Idle on every hop |
| New backend ignored for minutes | Old keepalive sockets still used | Drain / reload; lower `keepalive_timeout` |
| Worker connection count climbs | keepalive too high, leaks | `ss` to upstream; worker RSS |
| HTTP/1.0 clients slow | Frontend keep-alive off | `keepalive_timeout` on the listen server |
| POST duplicated | Retry on a recycled bad socket | Disable retry on non-idempotent |
| 502 wave at deploy | Old workers closed; proxy still held sockets | Drain then stop; align idle |

## Investigation Tips

- Capture one failing request with `$upstream_addr $upstream_status $request_time`. A 502 with empty upstream time is often a dead keepalive socket.
- Change one timeout at a time and write the chain on the ticket.
- After a backend rollout, expect a brief 502 wave if the old process closes sockets the proxy still holds. Drain, then stop.
- Cloud LBs (ALB idle 60s default on many accounts) must be in the same drawing as nginx `keepalive_timeout`.
- HTTP/2 / HTTP/3 multiplex differently. Do not debug them with HTTP/1 keepalive assumptions.
- Connection exhaustion at the app is the other end of this: [[Connection Exhaustion]].
- Multiply `keepalive` by worker count before you decide the app “only has 32 connections.”

## Related Notes

- [[Reverse Proxies]]
- [[Web Server Troubleshooting]]
- [[Connection Exhaustion]]
- [[Keepalived and VRRP]]
- [[ss Deep Dive]]
- [[curl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We had 502s only from the iOS app, never from `curl -I`. The app pooled connections; curl opened a new one every time. The app server idle timeout was 5s shorter than nginx. Align the close so the proxy hangs up first.
- Adding `keepalive 32` without `proxy_http_version 1.1` did nothing. The comment in the conf said “keepalive enabled.” The packet capture said otherwise.
- A deploy that SIGTERM’d app workers immediately produced a 90-second 502 storm. Graceful drain plus a proxy idle shorter than the app’s shutdown wait ended it.
- Someone set `keepalive 256` on an 8-worker proxy in front of a 100-connection Postgres pool via the app. The math belonged on a whiteboard before the change, not after the outage.
