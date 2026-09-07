# Certificates and PKI

## Concept

PKI binds a public key to a name with a certificate a client will trust. Operationally you care about four properties of the *live* handshake: chain, name (SAN), time validity, and whether the process actually loaded the new files.

Most “TLS is broken” tickets are an expired leaf, a missing intermediate, a wrong name, or a service that was never reloaded after renewal. The math is fine.

## Why it matters

- Certificate expiry is a calendar event that becomes a production event if nobody owns rotation and reload
- Clients that are not browsers (Java, Python `ssl`, curl with a pinned CA, gRPC, Kafka) each have their own trust store. “Works in Chrome” is not a test
- A leaf sent without its intermediate fails a large fraction of server-to-server clients and some mobile ones
- Name mismatch (`CN=oldname`, SAN missing the load-balancer name) fails modern clients even when dates are perfect
- Private keys sitting world-readable next to the cert in `/etc/nginx` are an incident, not a style note

## Mental Model

```
client trust store                    server must send
┌── root CA (trusted, offline) ──────┐     leaf
│                             │     + intermediates (not the root)
│   intermediate CA(s)        │
│                             │     client already has the root
└── leaf / server cert  ←───────┘

checks the client actually runs:
  1. time: notBefore ≤ now ≤ notAfter   (leaf *and* intermediates)
  2. name: SNI hostname ∈ SAN (CN is legacy fallback; do not rely on it)
  3. chain: each issuer signature verifies; trust anchor in the store
  4. usage: serverAuth / clientAuth EKU matches the role
  5. optional: revocation (OCSP / CRL) — flaky internal PKI loves this one
```

SNI (`-servername`) chooses the certificate on a multi-vhost listener. Without it you test the default vhost and file a wrong ticket.

Formats you will trip over: PEM (`-----BEGIN CERTIFICATE-----`), DER (binary), PKCS#12 / `.p12` / `.pfx` (cert+key+chain, common on Windows/Java), Java JKS/PKCS12 keystores. Convert; do not guess.

## Key Commands

```bash
# File on disk
openssl x509 -in leaf.pem -noout -text
openssl x509 -in leaf.pem -noout -dates -subject -issuer -ext subjectAltName
openssl x509 -in leaf.pem -noout -enddate

# What the listener actually presents (always set SNI)
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer -ext subjectAltName

echo | openssl s_client -connect example.com:443 -servername example.com -showcerts

# Chain verify against a bundle you believe
openssl verify -CAfile ca-bundle.pem -untrusted intermediate.pem leaf.pem

# Compare leaf pubkey to a private key (must match before you reload)
openssl x509 -in leaf.pem -noout -modulus | openssl md5
openssl rsa  -in key.pem  -noout -modulus | openssl md5

# Connect-level view: protocol, cipher, verify return code
echo | openssl s_client -connect example.com:443 -servername example.com -brief

# STARTTLS services
echo | openssl s_client -connect mail.example:587 -starttls smtp -servername mail.example
echo | openssl s_client -connect ldap.example:389 -starttls ldap

# Java trust store (different universe)
keytool -list -v -keystore /etc/pki/java/cacerts     # default pass: changeit
keytool -list -v -keystore app.p12 -storetype PKCS12

# Convert
openssl x509 -inform DER -in leaf.crt -out leaf.pem
openssl pkcs12 -in bundle.p12 -out bundle.pem -nodes   # protect the output
```

After any renew: inspect the *listener*, not only the files Ansible wrote. `s_client` against localhost with the right `-servername` is the acceptance test.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `certificate has expired` | Missed rotation, or an intermediate expired | `-enddate` on leaf *and* each `-showcerts` frame |
| `Hostname mismatch` / `certificate is not valid for name` | SAN does not include the name the client used | `-ext subjectAltName`; what SNI the client sends |
| `unable to get local issuer certificate` | Intermediate not sent; client has only roots | `-showcerts` vs a working host |
| Browser OK, Java/Python/curl-with-`--cacert` fail | Different trust store; or missing intermediate | App CA bundle / JKS; do not use Chrome as oracle |
| Intermittent wrong cert | SNI off, default vhost, or multiple listeners | `s_client` with and without `-servername` |
| Files on disk new, clients still see old leaf | No reload, or process pinned old fd | reload/restart; `s_client`; `lsof` on the key |
| `key values mismatch` after deploy | Cert and key from different requests | modulus compare before reload |
| Internal mTLS fails after CA rotation | Clients still trust old issuing CA only | Distribute new bundle; check both sides’ EKU |
| Outage at midnight UTC on expiry day | `notAfter` is that second; clients are strict | Alert at 30/14/7 days; renew at 1/3 of lifetime |

## Investigation Tips

- Always pass `-servername`. Always. Load balancers and `default_server` make this non-optional.
- Walk `-showcerts` and run `openssl x509 -noout -subject -issuer -dates` on *each* PEM block. Expiry of the intermediate is a classic “we only monitor the leaf” hole.
- Confirm the live endpoint after deploy. ACME can write files and still leave nginx pointing at last year’s fullchain path.
- Chrome adding an intermediate from its own cache hides a broken server chain. `curl -vI --http1.1` and `s_client` do not.
- Pin alerts to the name clients use (LB DNS), not the hostname on the cert request, if those differ.
- Private keys: mode `0400`, owner the daemon user, not in git, not in world-readable config management output. Rotation of a leaked key is a cert *and* a trust event.
- For internal CA: short-lived leaves, documented trust-anchor rollout, and a tested revocation story. An internal CA nobody can replace is a future fleet outage.
- Kubernetes / ingress: the Secret in the cluster is not the same object as the file on a jump host. Debug the object the controller mounts.

## Related Notes

- [[TLS Troubleshooting]]
- [[curl Deep Dive]]
- [[Reverse Proxies]]
- [[Secrets Management]]
- [[SSH Hardening and Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We once monitored files under `/etc/ssl/certs` and not the listener. Certbot renewed on disk; nginx still served a 90-day-old leaf until the next reboot. The acceptance test is `s_client` against the VIP with SNI, every time.
- A Java app “trusted the internet” because Chrome did. Its JKS had never received the new internal intermediate. Browser-as-verifier is how you miss an entire class of clients.
- An intermediate expired six days before the leaf. Every dashboard that scraped `notAfter` from the leaf stayed green. Parse every cert in `-showcerts`.
- The worst PKI outage I have been in was not expiry; it was a key/cert mismatch after a partial Ansible run. `modulus` compare is a 5-second gate that belongs in the deploy script, not in the incident channel.
