# dig Deep Dive

## Concept

`dig` (domain information groper) is the definitive command-line tool for querying DNS servers. It shows the full response (answer, authority, additional sections), query path, and timing, making it far more useful than `nslookup` or `host` for serious troubleshooting.

## Why it matters

- Most “network is broken” tickets are actually DNS problems
- Applications use the system resolver; `dig` lets you query specific servers and see the raw records
- You can prove whether a record is missing, wrong, or simply not reaching the client
- Critical for validating changes before and after DNS updates

`dig` answers “what does this nameserver say?” — not necessarily “what does the application see.”

## Mental Model

```
dig [@server] name [type] [options]

Response sections:
- ANSWER     → the records you asked for
- AUTHORITY  → NS records for the zone
- ADDITIONAL → often A/AAAA for the NS servers (glue)

Key flags in the header:
- aa  = authoritative answer
- ra  = recursion available
- rcode = NOERROR / NXDOMAIN / SERVFAIL / REFUSED …
```

Querying different servers (local resolver vs authoritative) is the fastest way to isolate where a problem lives.

## Key Commands

```bash
# Basic lookup (uses system resolvers from /etc/resolv.conf)
dig example.com

# Specific record type
dig example.com A
dig example.com AAAA
dig example.com MX
dig example.com TXT
dig example.com NS
dig example.com SOA
dig example.com CNAME

# Query a specific nameserver
dig @8.8.8.8 example.com
dig @1.1.1.1 example.com A

# Short answer only (great for scripts)
dig +short example.com
dig +short example.com MX

# Trace the full resolution path from the root
dig +trace example.com

# Reverse lookup
dig -x 8.8.8.8

# Show only the answer section, clean output
dig +noall +answer example.com

# Useful for debugging recursion / timeouts
dig +norecurse @ns1.example.com example.com
dig +time=2 +tries=1 example.com   # fail fast

# Any record type (including unknowns)
dig example.com ANY          # often blocked by modern servers
```

## Common Failure Modes & Symptoms

| What dig shows                        | Likely meaning                              | Next step                                      |
|---------------------------------------|---------------------------------------------|------------------------------------------------|
| `NXDOMAIN`                            | Name does not exist (or wrong zone)         | Check spelling, zone, recent deletions         |
| `SERVFAIL`                            | Upstream failure / DNSSEC / timeout         | Query authoritative servers directly           |
| `REFUSED`                             | Server will not answer this query           | ACLs, views, or recursion disabled             |
| Empty ANSWER, but NOERROR             | Name exists but no records of that type     | Try other types or check zone content          |
| Different answers from different NS   | Zone inconsistency / propagation lag        | Compare all authoritative servers              |
| Timeout                               | Network path, firewall, or dead nameserver  | `dig +time=1`, check connectivity to port 53   |
| Works with `@8.8.8.8` but not local   | Local resolver / caching problem            | Check `/etc/resolv.conf`, systemd-resolved, nscd |

## Investigation Tips

- Always compare local resolver vs a public resolver vs the authoritative servers.
- `dig +trace` is excellent for understanding the full delegation chain and spotting broken glue or missing NS records.
- Remember that applications may use different resolvers (container DNS, custom `resolv.conf`, glibc vs musl, systemd-resolved stub).
- TTL matters: a “fixed” record can still be cached for the remaining TTL on clients and intermediate resolvers.
- For split-horizon / internal DNS, query the internal servers explicitly; public dig will not see private zones.
- Pair with `resolvectl status` (systemd) or `cat /etc/resolv.conf` to understand what the host actually uses.

## Related Notes

- [[DNS Resolution]]
- [[TCP IP Troubleshooting Model]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[TLS Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
