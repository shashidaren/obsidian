# dig Deep Dive

## Concept

`dig` asks a nameserver a question and prints the raw DNS message: header flags, rcode, answer / authority / additional sections, and query time. It is the source of truth for “what does this server claim?”, not for “what will this process resolve?”.

Applications use the system stub (`/etc/resolv.conf`, systemd-resolved, nscd, CoreDNS, musl). `dig` bypasses most of that unless you deliberately point it at the same stub. Prove the zone first, then prove the client path.

Prefer `dig` over `nslookup`. `nslookup` hides flags, mixes search-list behaviour, and is a poor ticket artifact.

## Why it matters

- A large fraction of “the network is down” tickets are NXDOMAIN, stale cache, wrong view, or a dead forwarder
- You can isolate *which* server is lying by querying local stub vs public vs each authoritative NS
- Pre- and post-change validation of A/AAAA/CNAME/MX/TXT/NS is a five-minute ritual that prevents hour-long outages
- SERVFAIL vs NXDOMAIN vs NOERROR+empty answer are different incidents. Treating them as one “DNS is broken” wastes the first half hour

## Mental Model

```
client app
  → stub resolver  (/etc/resolv.conf, resolved, nscd, container DNS)
      → recursive  (forwarder / unbound / cloud resolver)
          → authoritative NS for the zone

dig [@server] name [type] [+flags]

header
  aa = this answer came from an authoritative server
  rd/ra = recursion desired / available
  rcode = NOERROR | NXDOMAIN | SERVFAIL | REFUSED | TIMEOUT

sections
  ANSWER     = records of the requested type (or CNAME chain)
  AUTHORITY  = NS (and sometimes SOA on negative answers)
  ADDITIONAL = glue A/AAAA for those NS
```

Querying `@127.0.0.53` (resolved stub), `@the-forwarder`, and `@ns1.example.com` is the cheapest isolation technique in DNS.

## Key Commands

```bash
# What the *host stub* will ask (not always what glibc will do with search paths)
dig example.com A
cat /etc/resolv.conf
resolvectl status          # systemd-resolved
resolvectl query example.com

# Force a specific server
dig @127.0.0.53 example.com A
dig @8.8.8.8 example.com A
dig @ns1.example.com example.com A +norecurse

# Clean artifacts for tickets
dig +noall +answer +ttlid example.com A
dig +short example.com A

# Common types
dig example.com AAAA
dig example.com MX
dig example.com TXT
dig example.com NS
dig example.com SOA
dig example.com CNAME
dig _dmarc.example.com TXT
dig _http._tcp.example.com SRV

# Reverse
dig -x 203.0.113.10

# Fail fast when a forwarder is wedged
dig +time=2 +tries=1 @10.0.0.53 example.com A

# Delegation / glue walk (noisy; use when NS look wrong)
dig +trace example.com A

# Compare every authoritative NS
for ns in $(dig +short example.com NS); do
  echo "=== $ns"
  dig +norecurse +noall +answer +ttlid @$ns example.com A
done

# TCP (some answers / AXFR / firewalls only allow 53/tcp)
dig +tcp example.com A

# DNSSEC presence (you do not need to debug signatures on every ticket)
dig example.com DNSKEY
dig +dnssec example.com A
```

`ANY` is widely refused. Ask for the type you actually need.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `NXDOMAIN` | Name does not exist in this view, or typo / wrong zone | Spelling, internal vs public zone, recent delete, search domain appending |
| `NOERROR` + empty ANSWER | Name exists, not this type (or only a CNAME you did not follow) | Query CNAME, AAAA, TXT; look at AUTHORITY SOA |
| `SERVFAIL` | Recursor timed out, DNSSEC failure, lame delegation, or upstream REFUSED | Query each auth NS with `+norecurse`; check forwarder logs |
| `REFUSED` | ACL, view, recursion disabled, or rate limit | Right server? Recursion allowed for this source IP? |
| Timeout | Packet filter, wrong IP, anycast dead, UDP blocked | `dig +tcp`, `dig +time=1`, `ss`/`tcpdump` port 53 |
| Works `@8.8.8.8`, fails locally | Stub, cache, split-horizon, or poisoned forwarder | `resolvectl flush-caches` / `nscd -i hosts`; compare answers |
| Different answers per NS | Zone not in sync, hidden master lag, fat-finger on one server | Loop all NS; check serials on SOA |
| Right answer, app still fails | App is not using the stub you tested; search list; IPv6 first | `getent hosts`, container `/etc/resolv.conf`, happy-eyeballs |
| Stale record after “the fix” | TTL still cached on recursor or client | Compare TTL remaining; wait or flush the cache you control |
| CNAME to NXDOMAIN / wrong A | Alias target broken, not the name the user typed | `dig +noall +answer` without `+short` so you see the chain |

## Investigation Tips

- Always capture *server, question, rcode, answer, TTL, query time*. `+short` is for scripts; tickets need the header.
- Split-horizon: public `dig` will never see the internal zone. If the app is on a VPC resolver, query that resolver.
- systemd-resolved stub (`127.0.0.53`) can answer from cache while `/etc/resolv.conf` still lists an old forwarder. Use `resolvectl query` and `resolvectl status` together.
- Containers often have `nameserver` pointed at CoreDNS or Docker’s embedded DNS. `dig` on the node is a different path than `dig` in the pod.
- Search domains (`search corp.example`) turn `api` into `api.corp.example`. `dig api` does not apply the search list the same way glibc does. Confirm with `getent ahosts api`.
- A “fixed” record that still fails is almost always cache or a second nameserver you did not update. Check SOA serials.
- UDP fragments and oversized answers (DNSSEC, fat TXT) fail in some networks. Retry with `+tcp` before you redesign the zone.

## Related Notes

- [[DNS Resolution]]
- [[TCP IP Troubleshooting Model]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[TLS Troubleshooting]]
- [[Services DNS and Ingress]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The outage was “API down”. Public `dig` was fine. The app’s pod used cluster DNS, which still had the old ClusterIP. Always test the resolver the workload uses, not the one on your laptop.
- `+short` in Slack hid a CNAME to a name that no longer had an A record. `NOERROR` with an empty A answer is not success.
- We updated one of two authoritative servers and watched half the fleet flip every TTL. Loop *all* NS before you call a change done.
- SERVFAIL plus a working `@auth-ns` almost always meant the recursor could not reach 53/udp toward that NS. The zone was fine; the firewall change was not.
