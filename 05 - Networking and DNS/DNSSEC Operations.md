# DNSSEC Operations

## Concept

DNSSEC adds cryptographic signatures to DNS records so resolvers can verify they came from the zone owner and were not altered in transit. It does not encrypt queries; it authenticates answers.

Validation is done by recursive resolvers (or stubs that trust a validating resolver). A broken chain, expired signature, or mismatched key produces SERVFAIL, not a wrong answer.

## Why it matters

- SERVFAIL on signed zones is a common outage cause after key rollover, clock skew, or misconfigured trust anchors
- False security: unsigned zones or validation disabled means you still get poisoned answers
- Clock skew breaks signature validity windows the same way it breaks TLS
- Debugging “DNS is down” when only signed names fail requires knowing whether validation is on

## Mental Model

```
zone owner signs RRsets with ZSK
  → DNSKEY records signed by KSK
    → DS record in parent zone (the trust link)
      → recursive resolver validates chain from root trust anchor
        → AD bit set in answer if validated
```

Failure modes: signature expired (time), key not published, DS mismatch after rollover, NSEC/NSEC3 issues, or resolver clock wrong.

## Key Commands

```bash
# Check if resolver is validating
dig +dnssec example.com
# look for AD flag, RRSIG

resolvectl query example.com   # if using systemd-resolved
resolvectl status | grep -i dnssec

# Trace validation
dig +trace +dnssec example.com

# Check signatures and expiry
dig example.com DNSKEY +dnssec
dig example.com RRSIG

# Force no validation (for comparison)
dig +cd example.com   # checking disabled
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| SERVFAIL only on signed domains | Validation failure, clock, expired sig | dig +cd vs without, date, journal |
| Works with +cd, fails otherwise | DNSSEC problem | dig +dnssec, AD bit |
| After key rollover | DS not updated in parent | dig DS, parent NS |
| Intermittent SERVFAIL | Signature timing, one bad NS | multiple digs, time |
| All validation fails | Trust anchor missing or clock | resolvectl, chronyc tracking |

## Investigation Tips

- Compare `dig` with and without `+cd`. If +cd works, it is DNSSEC.
- Check system time first. Same as TLS.
- Look at resolver logs for “bogus” or “validation failed”.
- Root trust anchor is usually automatic; corporate internal zones need explicit anchors if signed.
- Do not disable validation as the “fix”. Find the broken signature or key.

## Related Notes

- [[DNS Resolution]]
- [[systemd-resolved]]
- [[Time Sync and chrony]]
- [[dig Deep Dive]]
- [[TLS Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A zone key rollover completed on the primary but the DS in the parent registrar lagged by a day. Half the Internet got SERVFAIL. Always coordinate parent DS update and monitor validation from outside.
- Clock skew of 2 minutes was enough to invalidate short-lived signatures on a lab zone. chrony was not running.
