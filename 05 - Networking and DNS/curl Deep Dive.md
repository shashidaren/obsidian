# curl Deep Dive

## Concept

`curl` is the Swiss-army knife for testing HTTP/HTTPS (and many other protocols).  
It can show DNS resolution, TCP connect, TLS handshake, headers, redirects, and timing breakdowns.

## Why it matters

When an application or user reports “the site is down”, `curl` lets you test the exact path from the server (or your machine) and see which layer fails.

## Mental Model

```
curl -v   → verbose: DNS → Connect → TLS → Request → Response
curl -w   → write-out: precise timing metrics
```

## Key Commands

```bash
# Basic verbose request (most useful starting point)
curl -v https://example.com

# Show only headers
curl -I https://example.com

# Follow redirects
curl -vL https://example.com

# Timing breakdown
curl -w "\nDNS: %{time_namelookup}\nConnect: %{time_connect}\nTLS: %{time_appconnect}\nTTFB: %{time_starttransfer}\nTotal: %{time_total}\n" -o /dev/null -s https://example.com

# Test from specific interface or with custom resolve
curl --interface eth0 https://example.com
curl --resolve example.com:443:1.2.3.4 https://example.com

# Ignore certificate errors (testing only)
curl -vk https://example.com

# POST / with data
curl -v -X POST -d 'key=value' https://example.com/api
```

## Common Failure Modes & Symptoms

| What curl shows                      | Likely layer                     | Next step                        |
|--------------------------------------|----------------------------------|----------------------------------|
| Could not resolve host               | DNS                              | [[DNS Resolution]]               |
| Connection timed out                 | Network / firewall / routing     | [[TCP IP Troubleshooting Model]] |
| Connection refused                   | Nothing listening or firewall    | `ss -tulpn` on target            |
| SSL certificate problem              | TLS / certificate                | `openssl s_client`               |
| HTTP 5xx                             | Application                      | Application logs                 |
| Slow TTFB                            | Backend / application            | App metrics & logs               |

## Investigation Tips

- Always test both by name and by IP when possible.
- Use `-v` first to see the full handshake.
- The `-w` timing format is excellent for quantifying slowness.
- From the server itself, `curl localhost` or `curl 127.0.0.1` helps separate local vs external path issues.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[DNS Resolution]]
- [[TLS Troubleshooting]]
- [[ss Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
