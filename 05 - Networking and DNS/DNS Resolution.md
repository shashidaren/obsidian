# DNS Resolution

## Concept

DNS maps names to records (A/AAAA, CNAME, MX, …). On a Linux host the path is usually:

```
Application
  → glibc getaddrinfo / NSS (/etc/nsswitch.conf)
    → files (/etc/hosts) and/or dns
      → /etc/resolv.conf  (possibly a stub toward systemd-resolved)
        → recursive resolver(s)
          → authoritative servers
```

Containers and Kubernetes insert another layer: the runtime or CNI writes `resolv.conf` inside the network namespace (ClusterFirst, hostNetwork, ndots, search domains).

## Why it matters

- A large fraction of "the network is down" tickets are DNS
- `dig` succeeding does **not** mean the application will resolve — NSS, search domains, and different resolvers mean different answers
- Timeouts, search-domain expansion, and broken first nameservers produce intermittent, hard-to-reproduce failures
- Wrong search domains turn short names into surprising FQDNs (and NXDOMAIN or the wrong service)

## Mental Model

1. App calls `getaddrinfo()` (or a language runtime equivalent).
2. NSS decides order (`hosts: files dns` is common).
3. `/etc/hosts` may short-circuit.
4. DNS config from `/etc/resolv.conf`: `nameserver`, `search`, `ndots`, `timeout`, `attempts`.
5. On many desktops/servers, `resolv.conf` points at `127.0.0.53` (systemd-resolved stub).
6. In Kubernetes, CoreDNS + `ndots:5` + long search lists change both latency and which query goes on the wire first.

Always compare **application path** (`getent`) with **direct DNS** (`dig`/`resolvectl`).

## Key Commands

```bash
# Closest to what most libc apps do
getent hosts example.com
getent ahosts example.com

# Direct queries (bypass NSS search behaviour unless you omit the trailing dot)
dig example.com
dig +short example.com A
dig example.com. +norecurse            # trailing dot = absolute
dig @8.8.8.8 example.com
dig +trace example.com

# Local config
cat /etc/resolv.conf
grep hosts /etc/nsswitch.conf

# systemd-resolved
resolvectl status
resolvectl query example.com
resolvectl statistics

# Is something listening on the stub?
ss -ulpn | grep -E ':53|:5353'

# From inside a container / Pod netns
# (kubectl exec, docker exec, or nsenter -t <pid> -n)
cat /etc/resolv.conf
getent hosts kubernetes.service.svc.cluster.local
```

Useful `resolv.conf` knobs:

- `nameserver` order — first server timeouts cost real latency
- `search` — suffixes appended when `ndots` threshold not met
- `ndots:5` (Kubernetes default) — single-label and many multi-label names trigger search expansion first

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| dig works, app fails | NSS order, search domains, different resolver, language DNS lib | `getent`; app's own DNS settings |
| NXDOMAIN for a name that exists | Search domain mangling; wrong zone | `dig name.` with trailing dot |
| Slow connects every few minutes | First nameserver timing out | `resolv.conf` order; dig each `@server` |
| Intermittent wrong answer | Split DNS, split-horizon, cache poison/stale | Compare resolvers; TTL; which client |
| Works on host, fails in Pod | Cluster DNS, ndots/search, NetworkPolicy to CoreDNS | Pod `resolv.conf`; `kubectl -n kube-system logs` on CoreDNS |
| Only some hosts fail | `/etc/hosts` override, local cache | Compare `getent` vs another machine |
| systemd-resolved weirdness | Stub down, DNSSEC failures, per-link config | `resolvectl status`; journalctl -u systemd-resolved |
| CNAME / NXDOMAIN chains | App follows differently than dig | dig full chain; check CNAMEs |

## Investigation Tips

- Reproduce with `getent hosts` before blaming the application. If `getent` fails, fix resolution; if `getent` works and the app fails, look at the language runtime, proxy settings, or hard-coded resolvers.
- Use a **trailing dot** to suppress search domains when testing the real FQDN.
- Test each `nameserver` with `dig @x.x.x.x`. A dead primary produces multi-second delays equal to `timeout × attempts`.
- In Kubernetes, note `ndots:5` and the long `search` list. Queries for external names may generate several internal NXDOMAINs first — a CoreDNS or latency problem shows up as slow external resolution.
- Containers do not use the host's `/etc/resolv.conf` unless configured that way. Always read the file *inside* the network namespace.
- Capture *when* it fails. DHCP updates, VPN connect/disconnect, and Cluster DNS rollouts change resolution underfoot.
- `dig +trace` shows the delegation path; it will not show what libc does with search domains. Use both tools.

## Related Notes

- [[dig Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Services DNS and Ingress]]
- [[curl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The classic trap: `dig redis` returned NXDOMAIN but the app "used to work" with `redis.prod.svc.cluster.local` via search domains. After a Pod security change dropped the search list, short names died. Prefer FQDNs in app config.
- A VIP in front of two resolvers had one dead backend. Half the fleet was fine (lucky client order); the other half paid a 5s timeout on every name lookup. Measure each nameserver, not just "DNS works".
- glibc and a JVM with its own DNS cache disagreed for the TTL of a failed record. We chased "split brain" until we flushed the JVM side. Know which layer caches.
- Kubernetes: CoreDNS was up, but a NetworkPolicy default-deny blocked Pods from reaching it. Symptoms looked like application timeouts. Policy and DNS are on the same critical path.
