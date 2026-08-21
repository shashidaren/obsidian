# Certificates and PKI

## Concept

Public Key Infrastructure (PKI) binds identities to public keys via certificates issued by a trusted Certificate Authority (CA). TLS, mutual TLS, code signing, and many internal services rely on this trust chain.

Operationally you mostly care about: correct chain, correct hostname/SAN, validity period, and timely reload after rotation.

## Why it matters

- Expired or mis-matched certificates are one of the most common causes of sudden “TLS handshake failed” or browser warnings
- Missing intermediate certificates break clients that do not have the full chain
- Hostname / SAN mismatches fail modern clients even if the cert is otherwise valid
- Poor rotation and reload practices cause outages during certificate renewal

Most certificate problems are configuration or operational, not cryptography.

## Mental Model

```
Client trust store
        ↓
   Root CA (trusted)
        ↓
 Intermediate CA(s)
        ↓
  Leaf / server certificate  ← presented by the service

Validation checks:
- Chain of trust to a trusted root
- Not expired / not yet valid
- Hostname matches CN or SAN
- Key usage / extended key usage appropriate
- (Optional) revocation (CRL / OCSP)
```

The server must send the leaf + intermediates; the client supplies the root.

## Key Commands

```bash
# Inspect a certificate file
openssl x509 -in cert.pem -text -noout
openssl x509 -in cert.pem -noout -dates -subject -issuer

# Check a remote server’s presented certificate
openssl s_client -connect example.com:443 -servername example.com </dev/null
openssl s_client -connect example.com:443 -servername example.com -showcerts </dev/null

# Verify a chain (leaf + intermediates against a CA bundle)
openssl verify -CAfile ca-bundle.pem -untrusted intermediate.pem leaf.pem

# Extract dates only (good for monitoring)
openssl x509 -in cert.pem -noout -enddate

# Check certificate from a running service (nginx example)
openssl s_client -connect localhost:443 -servername myhost </dev/null 2>/dev/null | openssl x509 -noout -dates

# Convert formats when needed
openssl x509 -in cert.crt -outform PEM -out cert.pem
openssl pkcs12 -in bundle.p12 -out bundle.pem -nodes

# Quick expiry check script idea
echo | openssl s_client -connect host:443 -servername host 2>/dev/null | openssl x509 -noout -dates
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| Certificate has expired              | Missed renewal / no monitoring             | `openssl x509 -enddate`, monitoring alerts        |
| Hostname mismatch                    | Cert issued for wrong name / missing SAN   | `openssl x509 -text` → Subject Alternative Name   |
| “Unable to get local issuer”         | Missing intermediate in server chain       | `-showcerts`, compare with working chain          |
| Works in browser, fails in app       | App trust store different / incomplete     | App’s CA bundle, Java keystore, etc.              |
| Intermittent TLS failures            | Multiple certs / SNI / wrong vhost         | Check which cert is served per name               |
| Service still serves old cert        | Forgot reload after renew                  | Reload nginx/haproxy/apache, confirm with s_client|
| Client rejects after CA change       | New root not in client trust store         | Distribute updated CA bundle                      |

## Investigation Tips

- Always use `-servername` (SNI) when testing HTTPS; otherwise you may get the default vhost certificate.
- Compare the chain the server actually sends (`-showcerts`) with what you expect.
- Check both the leaf expiry and any intermediate expiry.
- For internal PKI, keep the root offline and use short-lived intermediates; document the trust distribution process.
- Automate expiry monitoring (30/14/7 day warnings) and test the renewal + reload path regularly.
- After renewing, verify the live endpoint, not only the files on disk.

## Related Notes

- [[TLS Troubleshooting]]
- [[curl Deep Dive]]
- [[SSH Hardening and Troubleshooting]]
- [[Secrets Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
