# curl Deep Dive

## Concept

`curl` is the standard client for testing HTTP/HTTPS (and many other protocols) from a shell. Used well, it shows which layer failed: DNS, TCP connect, TLS, HTTP status, redirect, or slow TTFB.

It is not a load tester. It is a *path probe* with excellent diagnostics.

## Why it matters

- Reproduces “the site is down” from the same network namespace as the app or the operator
- `-v` prints the handshake story without a browser
- `-w` quantifies *where* time went (DNS vs connect vs TLS vs TTFB)
- `--resolve` / `--interface` isolate DNS vs routing vs certificate name problems
- Works against localhost, UNIX sockets, and raw IPs — so you can bisect layers

If the browser fails and `curl` from the server succeeds, the problem is not the origin process.

## Mental Model

```
curl request path:

  DNS lookup          →  time_namelookup
  TCP connect         →  time_connect
  TLS handshake       →  time_appconnect
  Request sent
  First byte back     →  time_starttransfer (TTFB)
  Body complete       →  time_total
```

`-v` is qualitative (“what happened?”).  
`-w` is quantitative (“how long at each step?”).

Always know *from where* you are curling: laptop, jump host, pod, or the origin itself. Those are different paths.

## Key Commands

```bash
# Default first probe — verbose, no silent failures
curl -vI https://example.com

# Full body + headers when you need the payload
curl -v https://example.com

# Follow redirects (see each hop)
curl -vIL https://example.com

# Timing only, discard body
curl -sS -o /dev/null -w "dns:%{time_namelookup} connect:%{time_connect} tls:%{time_appconnect} ttfb:%{time_starttransfer} total:%{time_total} code:%{http_code} ip:%{remote_ip}\n" https://example.com

# Skip DNS (prove the origin)
curl -vI --resolve example.com:443:203.0.113.10 https://example.com

# Hit a specific source NIC / address
curl --interface eth0 https://example.com
curl --interface 192.0.2.10 https://example.com

# HTTP vs HTTPS, HTTP/2
curl -vI --http1.1 https://example.com
curl -vI --http2 https://example.com

# Client cert / custom CA (internal PKI)
curl -vI --cacert /etc/ssl/certs/corp-root.pem https://internal.example.com
curl -vI --cert client.pem --key client.key https://internal.example.com

# Testing only — do not normalise this in scripts
curl -vkI https://example.com

# UNIX socket (local nginx/haproxy/docker)
curl -vI --unix-socket /run/nginx.sock http://localhost/healthz

# Show response headers only, fail on HTTP errors (scripts)
curl -fsSI https://example.com

# POST JSON
curl -v -H 'Content-Type: application/json' -d '{"id":1}' https://example.com/api

# Save headers + body separately
curl -D /tmp/hdrs -o /tmp/body https://example.com
```

A reusable write-out format (put in `~/.curl-format`):

```
     dns:  %{time_namelookup}
 connect:  %{time_connect}
     tls:  %{time_appconnect}
    ttfb:  %{time_starttransfer}
   total:  %{time_total}
    code:  %{http_code}
      ip:  %{remote_ip}
```

```bash
curl -sS -o /dev/null -w @~/.curl-format https://example.com
```

## Common Failure Modes & Symptoms

| What curl prints | Layer | Next step |
|---|---|---|
| `Could not resolve host` | DNS | [[dig Deep Dive]], `/etc/resolv.conf`, search domains |
| `Connection timed out` | path / firewall / no route | [[ip Command Deep Dive]], [[tcpdump Deep Dive]] |
| `Connection refused` | nothing listening or local RST | `ss -tulpn` on the target |
| `No route to host` | routing or ICMP prohibited | `ip route get`, security groups |
| `SSL certificate problem` | name mismatch, expired, unknown CA, chain | [[TLS Troubleshooting]], [[Certificates and PKI]] |
| TLS handshake timeout | middlebox, MTU, or backend dead after SYN-ACK | capture ClientHello / ServerHello |
| HTTP `301`/`302` loop | bad redirect target (http↔https, wrong host) | `curl -vIL` and read `Location` |
| HTTP `401`/`403` | auth / WAF / allowlist | headers, source IP, app config |
| HTTP `502`/`504` | proxy cannot reach or wait for upstream | proxy logs, upstream `ss`/`curl` to origin |
| HTTP `5xx` from origin | application | app logs, not more curl flags |
| Fast connect, slow TTFB | origin compute / DB / lock | app metrics; `-w` already split it |
| Fast TTFB, slow total | large body or stall mid-stream | size, keep-alive, app flush |

## Investigation Tips

- Bisect: `curl 127.0.0.1:port` on the origin, then the proxy, then an external client. The hop that breaks is the hop you debug.
- Test by name *and* by IP (Host header / SNI still needed for vhosts):
  `curl -vI --resolve app.example.com:443:<ip> https://app.example.com`
- `-k` proves “TLS identity is the only problem” or it doesn’t. It is not a production workaround.
- `curl -I` uses `HEAD`. Some apps treat HEAD differently from GET. If HEAD lies, use GET with `-o /dev/null`.
- From Kubernetes, curl *inside the pod* and *from another pod* before blaming Ingress. Three different networks.
- Proxy environment variables (`http_proxy`, `HTTPS_PROXY`, `NO_PROXY`) silently divert curl on jump hosts. `curl -v` shows the proxy CONNECT. Override with `--noproxy '*' ` when you need a direct path.
- HTTP/2 vs 1.1 mismatches and corporate SSL inspection show up in `-v` as unexpected certificates or ALPN. Do not ignore the cert block.
- Timeouts: `--connect-timeout 5 --max-time 15` keep an incident shell from hanging forever.
- Exit codes matter in scripts (`curl -f`). A successful TCP+TLS session that returns 500 still exits non-zero with `-f`.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[DNS Resolution]]
- [[dig Deep Dive]]
- [[TLS Troubleshooting]]
- [[Certificates and PKI]]
- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[Reverse Proxies]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `-w` ended more “the network is slow” arguments than traceroute ever did. If `time_namelookup` is 2s, stop tuning nginx.
- `--resolve` is how I prove a CDN / LB picked a bad backend without waiting for DNS TTLs.
- I have chased TLS “errors” that were just `HTTPS_PROXY` on a bastion pointing at a filtering proxy. `-v` showed the CONNECT first; the origin cert was a distraction.
- Localhost curl succeeding while public curl fails is usually security groups, bind address, or the load balancer health check — not the binary you just restarted.
