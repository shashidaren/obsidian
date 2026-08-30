# Web Server Troubleshooting

## Concept

A "website is down" ticket is almost never one component. Split the path: DNS → VIP / firewall → TLS → listener (nginx/httpd/caddy) → reverse-proxy routing → upstream app → database / cache. Find the first hop that does not behave like a healthy request.

## Why it matters

- Restarting nginx because the app pool is wedged wastes time and hides the real fault
- 502/504 vs 4xx vs TCP refuse vs TLS alert are different classes of failure and need different tools
- Local `curl` to localhost bypasses DNS, LB, and sometimes TLS — use that on purpose
- Access logs, error logs, and journald each see a different slice of the same request

## Mental Model

```
Client
  → DNS / CDN / load balancer
    → TCP accept on :80/:443
      → TLS (optional)
        → vhost / server block (Host header / SNI)
          → location / proxy_pass / Alias
            → upstream (app sockets or http://127.0.0.1:8080)
              → app workers
                → DB / cache / files

Ask, in order:
  1. Does TCP connect?
  2. Does TLS complete?
  3. Does the correct vhost answer?
  4. Is the response generated here or proxied?
  5. Is the upstream up, slow, or overflowing?
  6. Is the app failing on a dependency?
```

Status-code shortcuts:

- `connection refused` / timeout → listen, firewall, LB target
- TLS alert → cert / protocol (see TLS note)
- `401/403` → authz, SELinux/AppArmor, file perms, allow/deny
- `404` → root / alias / try_files / wrong vhost
- `502` → proxy cannot talk to upstream
- `504` → upstream too slow vs proxy timeouts
- `5xx` from the app → application or its DB

## Key Commands

```bash
# Is anything listening, and as whom?
ss -lntup | grep -E ':80|:443|:8080'
systemctl status nginx httpd php-fpm --no-pager

# Config test before reload
nginx -t
apachectl configtest

# Request from outside vs on-box
curl -sv --max-time 10 https://public.example/health
curl -sv --max-time 5 -H 'Host: public.example' http://127.0.0.1/health
curl -sv --max-time 5 --resolve public.example:443:127.0.0.1 https://public.example/health

# Which vhost / upstream
nginx -T 2>/dev/null | less
httpd -S 2>/dev/null

# Error and access tails
journalctl -u nginx -u httpd -u php-fpm --since "30 min ago" --no-pager
tail -n 100 /var/log/nginx/error.log /var/log/httpd/error_log

# Upstream health
ss -lntup | grep 8080
curl -sv --max-time 3 http://127.0.0.1:8080/health
ls -l /run/php-fpm*.sock /run/unicorn.sock 2>/dev/null

# Worker / file / SELinux clues
ps -o pid,user,stat,wchan:16,cmd -C nginx,httpd,php-fpm
ausearch -m avc -ts recent 2>/dev/null | tail
```

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Connection refused on 443 | Unit down, bound to localhost only, wrong IP | `ss -lntup`, unit status, listen directive |
| Timeout from the internet, local curl works | SG / firewall / LB health / wrong backend | Path from VIP; security groups; `tcpdump` |
| 502 Bad Gateway | Upstream down, socket perms, wrong proxy_pass | curl the upstream directly; socket owner |
| 504 Gateway Timeout | App hung on DB or slow upstream | app logs, DB sessions, proxy `proxy_read_timeout` |
| 403 on static files | root path, user context, SELinux type | `ls -lZ` docroot; `ausearch`; user the worker runs as |
| Serves the default site | Host / SNI mismatch, missing server_name | `nginx -T` / `httpd -S`; curl `-H Host:` |
| After deploy, old content | cache, wrong root, workers not recycled | reload vs full restart; CDN cache |
| High latency, 200s | upstream saturation, slow queries, huge logs | `pidstat`, access-log timings, DB |
| Reload fails, old config stays | `nginx -t` never run; syntax error | error log line with the bad file:line |

## Investigation Tips

- Reproduce with `curl -sv` and write down: DNS answer, TCP, TLS, HTTP status, `Server` header, timing.
- Compare an on-box request (`Host:` header to 127.0.0.1) with an external one. That split isolates LB/DNS/firewall from the daemon.
- Never skip `nginx -t` / `apachectl configtest`. A failed reload leaves the previous generation running and looks like "my change did nothing".
- For 502/504, stop staring at the edge and curl the upstream URL or socket the proxy uses.
- Check document root *and* the user the workers run as. Permission on a parent directory is a frequent 403.
- If only some URLs fail, dump the matching `location` / `VirtualHost` and look for an accidental more-specific regex.
- Correlate one request id across access log, error log, and app log before you restart anything.
- After a "fix", hit the same URL from the same client path that users use (CDN and TLS terminator included).

## Related Notes

- [[Reverse Proxies]]
- [[TLS Troubleshooting]]
- [[Certificates and PKI]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[Connection Exhaustion]]
- [[SELinux Deep Dive]]
- [[journalctl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
