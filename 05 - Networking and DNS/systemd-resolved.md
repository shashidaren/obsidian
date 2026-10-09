# systemd-resolved

## Concept

`systemd-resolved` is a local caching stub resolver. It owns DNS, DNS-over-TLS, LLMNR, and mDNS for the host, and it writes the file most apps actually read: `/etc/resolv.conf` (usually a symlink to `/run/systemd/resolve/stub-resolv.conf`, which points at `127.0.0.53`).

Per-link DNS (DHCP, VPN, cloud metadata) is merged with global DNS. `resolvectl` is the truth. `dig @8.8.8.8` is not.

## Why it matters

- Apps call glibc. glibc reads `resolv.conf`. If that file is a stub, `dig` against a public resolver proves nothing about the outage
- Split DNS for VPNs and cloud private zones lives in per-link routing domains. A global `nameserver` line will not see them
- DNSSEC validation failures look like random NXDOMAIN or SERVFAIL for a subset of names
- Clock skew breaks DNSSEC and DoT. A host that cannot sync time often cannot resolve afterwards
- Two resolvers fighting over `resolv.conf` (cloud-init, NetworkManager, a hand edit) is a classic post-reboot ticket

## Mental Model

```
app getaddrinfo
  → NSS (nsswitch: resolve or dns)
    → stub 127.0.0.53:53   (stub-resolv.conf)
      → resolved cache + per-link DNS
        → upstream (DHCP, DNS=, FallbackDNS=, DoT)

alternate path:
  /run/systemd/resolve/resolv.conf   # upstreams written out, no stub
  resolvectl query                   # asks resolved directly
dig @1.1.1.1                         # bypasses resolved entirely
```

Modes that matter:

- **Stub mode** (default on many distros): `nameserver 127.0.0.53`. Search domains and routing domains are applied by resolved, not only by glibc.
- **Uplink mode**: `resolv.conf` lists the real servers. Useful when an app or container runtime insists on reading upstreams. You lose the stub cache for that reader.
- **Routing domains** (`~example.com` or `~.`): which link handles which suffix. `~.` means this link is the default route for DNS.
- **LLMNR/mDNS**: on by default on some images. They answer single-label names and surprise people who expected NXDOMAIN.

NSS: `hosts: files resolve [!UNAVAIL=return] dns` uses the `nss-resolve` module. If resolved is down, behaviour depends on that `!UNAVAIL` action.

## Key Commands

```bash
systemctl status systemd-resolved
resolvectl status
resolvectl query example.com
resolvectl query example.com AAAA
resolvectl statistics
resolvectl flush-caches
resolvectl dns eth0
resolvectl domain
resolvectl log-level debug    # revert to info when done

# What glibc will use
ls -l /etc/resolv.conf
cat /etc/resolv.conf
cat /run/systemd/resolve/stub-resolv.conf
cat /run/systemd/resolve/resolv.conf

getent hosts example.com
dig example.com @127.0.0.53
dig example.com @<upstream>

journalctl -u systemd-resolved -S "30 min ago" --no-pager
networkctl status eth0
```

Persistent config is `/etc/systemd/resolved.conf` and drop-ins under `resolved.conf.d/`. Per-link config is whatever NetworkManager, systemd-networkd, or netplan wrote. `resolvectl` shows the merge. A drop-in does not override a link that has `~.`.

```ini
# /etc/systemd/resolved.conf.d/dns.conf
[Resolve]
DNS=10.1.1.1
FallbackDNS=1.1.1.1
Domains=~corp.example
DNSSEC=allow-downgrade
DNSOverTLS=no
Cache=yes
```

`systemctl restart systemd-resolved` after drop-ins. Do not restart it as the first move on a box that is mid-incident and still answering from cache unless you have the upstreams written down.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `dig` works, app fails | App bypasses stub, or NSS not using `resolve` | `getent hosts`; `nsswitch.conf`; app resolver config |
| Short names work in one VPN, not another | Routing domain only on one link | `resolvectl domain`; `resolvectl status` |
| SERVFAIL after an image rebuild | DNSSEC on, upstream does not support it, or clock skew | `resolvectl query`; `timedatectl`; DNSSEC= |
| `resolv.conf` no longer a symlink | cloud-init, installer, or a script replaced it | `ls -l /etc/resolv.conf` |
| Everything resolves to the search domain | glibc search list plus stub both appending | trailing-dot query; `resolvectl query name.` |
| Intermittent 5s delays | dead first upstream, FallbackDNS slow | `resolvectl status` Current DNS; dig each upstream |
| Single-label names resolve unexpectedly | LLMNR or mDNS | `resolvectl status` LLMNR/mDNS scope |
| Containers ignore host DNS | Runtime wrote its own `resolv.conf` | file inside the netns, not the host stub |
| Changes in `resolved.conf` ignored | Per-link DNS from DHCP wins | `resolvectl dns <iface>` vs global |

## Investigation Tips

- Page one is `resolvectl status` plus `ls -l /etc/resolv.conf`. If the symlink is broken, stop theorising about upstreams.
- Compare three answers: `getent hosts`, `resolvectl query`, `dig @upstream`. The first mismatch is the layer that is wrong.
- Use a trailing dot when you want to know if the name itself exists. Search domains hide NXDOMAIN.
- If only private zones fail, look for a missing `~corp.example` on the interface that can reach the internal resolvers. A default public DNS link will answer NXDOMAIN and cache it.
- Flush the cache after you fix upstreams. A negative cache TTL will keep the incident alive after the server is healthy.
- DNSSEC `yes` on a lab resolver that does not sign is an outage. `allow-downgrade` is the usual server setting unless you know every upstream validates.
- Do not `chattr +i` on `resolv.conf` to "stop cloud-init". Find which unit writes it (`systemd-resolved`, NetworkManager, cloud-init) and configure that unit.
- Clock first if DNSSEC or DoT failures start at boot. See [[Time Sync and chrony]].

## Related Notes

- [[DNS Resolution]]
- [[dig Deep Dive]]
- [[curl Deep Dive]]
- [[Time Sync and chrony]]
- [[TLS Troubleshooting]]
- [[systemd Units]]
- [[journalctl Deep Dive]]
- [[cloud-init]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A VPN client installed a second DNS tool that replaced the stub symlink with a static `nameserver 10.8.0.1`. After disconnect, every lookup timed out. `ls -l /etc/resolv.conf` was the whole diagnosis.
- Private zone NXDOMAIN was a link with `~.` pointing at the VPC resolver and a lab `resolved.conf` DNS= that never won. Per-link default route beats the global drop-in.
- I flushed caches before I copied `resolvectl status`. The negative answers were the evidence. Capture status, then flush.
