# TLS Troubleshooting

## Concept

TLS failures are almost never "SSL is broken". They are a mismatch in one of: certificate identity, validity window, chain of trust, protocol/cipher overlap, SNI, or the application not using the file you think it is using.

## Why it matters

- Browsers, load balancers, and language runtimes all fail differently on the same bad cert
- A hostname mismatch or incomplete chain can look like a random timeout from some clients only
- Expiry is still the most common production TLS incident and is 100% predictable
- Protocol or cipher floors (TLS 1.2+, no old RSA-only stacks) break legacy clients after a "security hardening" change

`openssl s_client` is the source of truth for what the *server actually presents*, not what the ticket says was deployed.

## Mental Model

```
Client hello (SNI + protocol + ciphers)
  → Server hello + certificate list
  → Client validates:
       name (SAN / CN) matches the name it connected to
       now is inside notBefore / notAfter
       chain walks to a local trust anchor
       usage / EKU is acceptable
  → Key exchange + finished
  → Application data

Break it into layers:
  DNS / VIP / SNI        → did I reach the intended cert?
  Leaf cert              → name, dates, key type
  Chain                  → intermediates sent? order?
  Trust store            → does *this* client trust the CA?
  Protocol / ciphers     → overlap between client and server
  App config             → which files, which passphrase, which server block?
```

## Key Commands

```bash
# What the server presents (replace name and port)
echo | openssl s_client -connect example.com:443 -servername example.com -showcerts 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# Full handshake noise (protocol, cipher, alerts)
openssl s_client -connect example.com:443 -servername example.com -tls1_2

# Verify against a CA bundle (system or custom)
echo | openssl s_client -connect example.com:443 -servername example.com -CAfile /etc/pki/tls/certs/ca-bundle.crt </dev/null

# Inspect a file on disk
openssl x509 -in /etc/pki/tls/certs/app.crt -noout -text | less
openssl x509 -in app.crt -noout -subject -issuer -dates -ext subjectAltName
openssl verify -CAfile ca-chain.pem app.crt

# Confirm key matches cert (hashes must be equal)
openssl x509 -noout -modulus -in app.crt | openssl md5
openssl rsa  -noout -modulus -in app.key | openssl md5

# Chain completeness: count certs the server sent
echo | openssl s_client -connect example.com:443 -servername example.com -showcerts 2>/dev/null | grep -c "BEGIN CERTIFICATE"

# Quick client-side view
curl -vI --max-time 10 https://example.com/
curl -vI --cacert /path/to/ca.pem https://internal.example/

# Expiry sweep
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -enddate
```

Use `-servername` whenever name-based virtual hosts or a TLS terminator is in front. Without SNI you may inspect the default cert, not the one users hit.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Browser NET::ERR_CERT_DATE_INVALID | Expired or not-yet-valid leaf | `-dates`; load balancer vs origin cert |
| Name mismatch | SAN does not include the URL host | `-ext subjectAltName` vs the name in the URL |
| Some clients fail, browsers work | Incomplete chain; browsers have cached intermediates | Count certs in `s_client -showcerts` |
| Works with curl, fails in Java/Python | Different trust store | App truststore vs `/etc/pki` / `/etc/ssl` |
| Handshake alert / protocol version | TLS 1.0/1.1 disabled or cipher floor | `s_client -tls1_2` / `-tls1_3`; nginx/apache ssl protocols |
| Connection resets at the LB | LB health check uses HTTP or wrong SNI | Target group cert, backend protocol |
| "certificate verify failed" after renewal | New cert, old key or stale file on disk | modulus match; which path the unit actually loads |
| Intermittent bad cert | Multiple backends, only one updated | Hit each backend IP with `s_client` |

## Investigation Tips

- Always pin the name you are testing (`-servername` and the URL host). Wildcards and SAN lists surprise people.
- Test from a client *outside* the box and from localhost. Different paths (LB vs origin) serve different certs.
- If chain depth is 1, the server is sending only the leaf. Bundle leaf + intermediates in the file the daemon loads.
- After renewal, confirm the running process was reloaded *and* that it points at the new files. `lsof` the pid if needed.
- Compare `notAfter` on disk, on the load balancer, and on what `s_client` shows. They diverge more often than they should.
- Corporate TLS inspection MITM will fail clients that pin CAs or use their own bundle. Treat that as a trust-store problem, not an app bug.
- Automate expiry alerts at 30/14/7 days; human calendars are not a control.

## Related Notes

- [[Certificates and PKI]]
- [[curl Deep Dive]]
- [[dig Deep Dive]]
- [[Reverse Proxies]]
- [[Web Server Troubleshooting]]
- [[Firewall and NAT]]
- [[Alert Design]]

## Personal Lessons Learned

> 
