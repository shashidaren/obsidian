# Reverse Proxies

## Concept

A reverse proxy (nginx, HAProxy, Envoy, Caddy, cloud ALB/NLB, Ingress) terminates client connections and forwards them to upstream services. Clients talk to the proxy; the proxy owns TLS, routing, buffering, health checks, and often authentication.

## Why it matters

- Most "the app is down" tickets are the proxy path: DNS, TLS, upstream health, timeouts, or headers
- Timeouts stacked (client → proxy → app → DB) produce random 502/504s
- Health checks that probe the wrong path keep bad backends in rotation or eject good ones
- The proxy is where you add request IDs, rate limits, and canary routing — or accidentally strip cookies and `Authorization`

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

502 = proxy reached something that answered badly or reset.  
504 = proxy waited and gave up.  
503 = no healthy upstream (or overload shed).  
499 (nginx) = client hung up before the proxy finished.

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

# Bypass the proxy (from a host that can reach upstream)
curl -sv http://<upstream>:8080/healthz

# Active upstreams / queues (HAProxy socket example)
echo "show stat" | socat stdio /run/haproxy/admin.sock | cut -d, -f1,2,5,18,24,37 | column -t -s,

# nginx: which upstream, response code, request time
# (depends on log_format — look for $upstream_addr $upstream_status $request_time $upstream_response_time)
tail -f /var/log/nginx/access.log
```

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

## Investigation Tips

- Always test **three places**: client → proxy, proxy box → upstream, and localhost on the app.
- Read `$upstream_status` / HAProxy `sv` state, not just the client-facing code. A client 502 with upstream 200 means the proxy did something after the app answered.
- Health checks must hit a dependency-aware endpoint. `/` that returns 200 while `/ready` is 500 will keep serving errors.
- Align timeouts: client 60s, proxy 30s, app 120s is a 504 factory.
- Retries on non-idempotent POST duplicate writes. Retry only safe methods unless the app is explicitly idempotent.
- Preserve `X-Forwarded-For` / `X-Request-Id` and make sure there is only one trusted hop appending them.
- Reload, don't blindly restart, if in-flight connections matter. Still drain on config that changes listen sockets.

## Related Notes

- [[Web Server Troubleshooting]]
- [[TLS Troubleshooting]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[Connection Exhaustion]]
- [[DNS Resolution]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
