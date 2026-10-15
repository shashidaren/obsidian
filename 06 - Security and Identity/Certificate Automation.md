# Certificate Automation

## Concept

Certificate automation is the pipeline that obtains or renews a certificate, installs it where the service will see it, reloads the service, and verifies the *live* handshake. The ACME client (certbot, acme.sh, lego, step-ca, etc.) is only the first step.

A renewal that writes files but does not reload, or reloads the wrong unit, or installs a chain the service does not read, is an outage with extra steps.

## Why it matters

- Manual renewal does not scale and fails at the worst time (expiry weekend).
- The most common failure is “files updated, process still has the old certificate.”
- Different services want different formats (PEM fullchain, PKCS12, separate key). The automation must produce the one the daemon actually loads.
- Internal CAs and public CAs have different trust-distribution problems. Automating issuance without automating trust rollout just moves the outage.
- Rate limits, DNS-01 vs HTTP-01, and firewall rules for the challenge are operational, not “ACME details.”

## Mental Model

```
Trigger (timer / hook / CI)
  → prove control (HTTP-01, DNS-01, TLS-ALPN-01)
  → receive leaf + chain
  → install to the path the service reads
  → reload or restart the service
  → verify with s_client against the listener (with SNI)
  → alert if any step fails or if notAfter < N days
```

The acceptance test is never “the files have a new mtime.” It is “`openssl s_client` shows the new dates and the correct SAN.”

## Key Commands

```bash
# What certbot (or equivalent) thinks
certbot certificates
certbot renew --dry-run

# After a real renew, prove the listener
echo | openssl s_client -connect localhost:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -dates -subject -ext subjectAltName

# Deploy hook example (certbot)
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#!/bin/sh
systemctl reload nginx
# or the specific unit that reads the cert

# Check the unit actually reloaded
systemctl status nginx --no-pager
journalctl -u nginx --since "5 min ago" | grep -i reload

# For a service that wants PKCS12
openssl pkcs12 -export -in fullchain.pem -inkey privkey.pem -out bundle.p12
```

DNS-01 is required when the host cannot be reached on port 80/443 from the internet (internal services, wildcards on some CAs). HTTP-01 needs the challenge path reachable and not redirected away.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Files new, clients see old cert | No reload, or wrong unit reloaded | `s_client`; `systemctl status`; hook logs |
| Renewal “succeeds”, next day expiry page | Hook failed silently; service not restarted | deploy-hook exit code; journal |
| HTTP-01 fails | Port 80 blocked, redirect, wrong vhost | curl the challenge URL from outside |
| DNS-01 fails | TXT record not visible, wrong zone, propagation | `dig TXT _acme-challenge.…` |
| Rate limited | Too many failed attempts or duplicate certs | CA error; back off; use staging first |
| Chain incomplete after install | Automation copied only the leaf | `s_client -showcerts`; compare to fullchain |
| Service fails to start after renew | Key permissions or format wrong | journal; `ls -l` on key; modulus match |
| Internal clients fail after public renew | They do not trust the new intermediate | trust store rollout, not just the leaf |

## Investigation Tips

- Dry-run the renewal on a schedule. A dry-run that fails is a future incident you can fix in daylight.
- The deploy hook must be idempotent and must target the correct unit. Reloading “nginx” when the cert is used by “haproxy” does nothing useful.
- Always verify with `s_client` (SNI set) after the hook. Add it to the hook if you can.
- Staging / test CA first. Production rate limits are real and will block you during an incident.
- For wildcards or hosts behind a load balancer that terminates TLS, DNS-01 or a centralised issuer is usually simpler than trying to make HTTP-01 work on every backend.
- Log the notAfter you just installed. Alerting on the live certificate (not the file) catches the “hook wrote files, service ignored them” case.
- Key permissions: the automation often runs as root and leaves the key 0644. Fix it in the hook.

## Related Notes

- [[Certificates and PKI]]
- [[TLS Troubleshooting]]
- [[Secrets Management]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Certbot renewed correctly for months. The nginx reload hook had a typo in the unit name. We discovered it when the leaf expired and `s_client` still showed the old dates. The hook now runs `s_client` and fails the renewal if the dates do not match.
- An internal service used HTTP-01. After a firewall change, port 80 from the internet was blocked. Renewals failed for weeks; we only noticed near expiry. DNS-01 would have survived the change.
- We automated the public leaf and forgot that Java clients needed the new intermediate in their trust store. Issuance succeeded; half the fleet could not connect. Trust distribution is part of the automation, not a follow-up ticket.
