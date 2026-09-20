# Reverse Proxies

## Concept

A reverse proxy (nginx, HAProxy, Envoy, Caddy, cloud ALB/NLB, Ingress) terminates client connections and forwards them to upstream services. Clients talk to the proxy; the proxy owns TLS, routing, buffering, health checks, and often authentication.

## Why it matters

- Most "the app is down" tickets are the proxy path: DNS, TLS, upstream health, timeouts, or headers
- Timeouts stacked (client → proxy → app → DB) produce random 502/504s
- Health checks that probe the wrong path keep bad backends in rotation or eject good ones
- The proxy is where you add request IDs, rate limits, and canary routing — or accidentally strip cookies and `Authorization`
- Retries on POST at the proxy duplicate charges and writes unless the app is idempotent

If you cannot draw the hop-by-hop timeout and header path, you will guess.

## Mental Model

```
Client
  → DNS / VIP / LB
    → proxy listen (TLS, HTTP)
      → route / location / matcher
        → upstream pool + health check
          → app
```

Each hop has:

- connect timeout
- request / read / send / idle timeout
- max body / buffer
- retry / failover policy
- header rewrite rules

Status codes the *proxy* minted:

- **502** — proxy reached something that answered badly or reset
- **504** — proxy waited and gave up
- **503** — no healthy upstream (or overload shed)
- **499** (nginx) — client hung up before the proxy finished

A client 502 with `$upstream_status` 200 means the proxy did something *after* the app answered. Read both codes.

## Key Commands

```bash
# Is the proxy up and listening?
systemctl status nginx haproxy envoy
ss -tulpn | grep -E ':80|:443|:8080'
journalctl -u nginx -u haproxy -n 100 --no-pager

# Config test before reload (examples)
nginx -t && nginx -s reload
haproxy -c -f /etc/haproxy/haproxy.cfg

# What does a client actually see?
curl -vI https://service.example
curl -v --resolve service.example:443:<proxy-ip> https://service.example/healthz
curl -sv --max-time 5 http://127.0.0.1/healthz

# Bypass the proxy (from a host that can reach upstream)
curl -sv http://<upstream>:8080/healthz
curl -sv -H "Host: service.example" http://<upstream>:8080/

# Active upstreams / queues (HAProxy socket example)
echo "show stat" | socat stdio /run/haproxy/admin.sock | cut -d, -f1,2,5,18,24,37 | column -t -s,
echo "show errors" | socat stdio /run/haproxy/admin.sock

# nginx: which upstream, response code, request time
# (depends on log_format — look for $upstream_addr $upstream_status $request_time $upstream_response_time)
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

Useful nginx log fragments to insist on:

```
$remote_addr $request $status $request_time $upstream_addr $upstream_status $upstream_response_time $request_id
```

Without `$upstream_*` you are debugging with one eye closed.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| 502 Bad Gateway | Upstream down, crash on request, protocol mismatch (HTTP vs HTTPS) | Curl upstream directly; proxy error log |
| 504 Gateway Timeout | Proxy timeout < app work time; DB stall | Compare proxy timeouts vs app p99 |
| 503 Service Unavailable | Health check failing, empty pool | Health endpoint from proxy's network namespace |
| Works on app, fails via proxy | Host header, TLS SNI, path prefix, cookie path | `curl -v` both paths; compare headers |
| Intermittent 5xx on one AZ | One bad backend still marked healthy | Upstream list + health check definition |
| WebSockets / long poll die | Idle timeout too low | Raise idle/read timeout for that route only |
| Large uploads fail | `client_max_body_size` / buffer limits | Proxy error log vs app log |
| Auth randomly missing | Proxy dropped `Authorization` or stripped cookies | Dump request headers at the app |
| Cert warning only through VIP | Wrong vhost / incomplete chain on proxy | [[TLS Troubleshooting]] |
| Duplicate POSTs | Proxy retry on 502 of a non-idempotent method | Retry policy per method |
| 499 spike | Client timeout < proxy + app time | Align client, proxy, and app timeouts |

## Investigation Tips

- Always test **three places**: client → proxy, proxy box → upstream, and localhost on the app.
- Read `$upstream_status` / HAProxy `sv` state, not just the client-facing code.
- Health checks must hit a dependency-aware endpoint. `/` that returns 200 while `/ready` is 500 will keep serving errors.
- Align timeouts: client 60s, proxy 30s, app 120s is a 504 factory.
- Retries on non-idempotent POST duplicate writes. Retry only safe methods unless the app is explicitly idempotent.
- Preserve `X-Forwarded-For` / `X-Request-Id` and make sure there is only one trusted hop appending them.
- Reload, don't blindly restart, if in-flight connections matter. Still drain on config that changes listen sockets.
- A cloud NLB/ALB is still a proxy. Its idle timeout and health check are part of the same drawing.
- Canaries: if 5% of traffic hits a new upstream pool, confirm the health check and the Host header on *that* pool, not only prod.

## Related Notes

- [[Web Server Troubleshooting]]
- [[TLS Troubleshooting]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[Connection Exhaustion]]
- [[DNS Resolution]]
- [[Certificates and PKI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The 504s were not "the database is slow". nginx `proxy_read_timeout` was 30s and the checkout endpoint's p99 was 34s. Raising one timeout without drawing the whole chain just moved the 504 to the load balancer.
- A health check against `/` kept a crashing worker in the pool because the static page still returned 200. Switching the check to `/ready` (DB ping) stopped the 502 lottery.
- We stripped `Authorization` in a well-meaning `proxy_set_header` that listed only `Host` and `X-Forwarded-For`. API clients looked like they were logged out only through the proxy. Dump headers at the app.
- HAProxy retries on 502 turned one slow POST into three charges. Retry configuration is part of the data-plane contract, not a performance tweak.
