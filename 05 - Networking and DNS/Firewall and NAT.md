# Firewall and NAT

## Concept

A firewall is policy on packets: accept, drop, reject, or steal them into NAT. NAT rewrites addresses or ports so many hosts can share one IP, or so an external listener can land on an internal one.

On Linux the packet filter is Netfilter. `nftables` is the current userspace; `iptables` is still everywhere as a compatibility layer. `firewalld` and `ufw` are policy front-ends. Cloud security groups, NACLs, load-balancer rules, and network policies sit *in front of* all of that. The effective policy is the intersection.

## Why it matters

- Most “the app is down” tickets that reproduce as a hang are a drop somewhere on the path, not a crashed process
- `Connection refused` vs `timed out` is a diagnostic fork: reject/nothing-listening vs silent drop
- NAT bugs break *return* traffic even when the forward rule looks perfect
- conntrack table exhaustion produces random failures under load that look like application flakes
- A rule that only exists in RAM dies on reboot and creates a “it worked until the patch window” incident

## Mental Model

```
Client packet
  → cloud SG / NACL / LB
  → routing
  → prerouting   (DNAT happens here)
  → input / forward
  → dest process   or   forwarded host
  → postrouting  (SNAT / MASQUERADE)
  → reply must reverse the same story (conntrack)
```

State is the product. A firewall that allows SYN but cannot see the ACK (asymmetric routing, helper missing, conntrack full) fails closed in ways that confuse people who only read the INPUT chain.

- **DNAT**: change destination. Typical publish-a-service pattern.
- **SNAT / MASQUERADE**: change source. Typical “private subnet needs the internet” pattern. MASQUERADE picks the outbound interface address dynamically; SNAT pins it.
- **Drop** vs **reject**: drop is a timeout for the client; reject is an ICMP or TCP RST. Timeouts are hostile to troubleshooting.
- `iptables` on a modern distro may be `iptables-nft`. Listing with the wrong tool makes you think rules are empty.

## Key Commands

```bash
# What implementation is actually in play?
nft list ruleset
iptables -V
iptables -L -n -v --line-numbers
iptables -t nat -L -n -v --line-numbers
iptables -t raw -L -n -v
lsmod | grep -E 'ip_tables|nf_tables|nft_'

# firewalld
systemctl is-active firewalld
firewall-cmd --state
firewall-cmd --get-active-zones
firewall-cmd --list-all
firewall-cmd --list-all-zones
firewall-cmd --permanent --list-all
firewall-cmd --reload

# ufw
ufw status verbose
ufw show raw

# Is anything listening, and on which address?
ss -lntup | grep -E ':80|:443|:22'

# conntrack health
conntrack -C                    # count, if conntrack-tools installed
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
dmesg | grep -i conntrack

# Path tests that distinguish layers
curl -sv --connect-timeout 3 http://127.0.0.1:<port>/health
curl -sv --connect-timeout 3 http://<private-ip>:<port>/health
curl -sv --connect-timeout 3 http://<public-name>/
nc -vz <host> <port>
ping -c 2 <host>                # ICMP often blocked; do not treat as gospel

# Watch the packet arrive (or not)
tcpdump -ni any host <client_ip> and port <port>

# Temporary accept (nft). Persist through firewalld/ufw/nftables.conf or it vanishes.
nft add rule inet filter input tcp dport 8443 accept
```

Change permanent config with the front-end the host already uses. Mixing `iptables -A` onto a firewalld box is how rules disappear at the next `--reload`.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Client times out | Silent drop at SG, NACL, host filter, or no route | `tcpdump` on the server: do SYNs arrive? do replies leave? |
| `Connection refused` | Nothing listening, or an explicit REJECT | `ss -lntup`; INPUT policy |
| Works on localhost, fails remotely | Bound to `127.0.0.1`, or host/cloud filter | `ss` local address; SG on the NIC’s security group |
| Outbound OK, inbound dead | Missing publish rule / DNAT / public SG | NAT table; LB target group health |
| One-way traffic after NAT | Reply does not hairpin or SNAT missing | Capture both sides; check routing and masquerade |
| Random failures at peak | conntrack full or helper missing (FTP/SIP) | `nf_conntrack_count` vs `_max`; dmesg |
| Fine until reboot / `firewall-cmd --reload` | Runtime-only rule | Permanent set vs running set |
| Docker/K8s broke host rules | Engine inserted its own chains | `nft list ruleset` / `iptables -L` and the CNI docs |
| Health check fails from LB only | SG allows clients but not the LB nodes | Source IP of the check vs the allow list |

## Investigation Tips

- Write the path on paper: client → edge → LB → host NIC → process. Test one hop at a time with `curl`/`tcpdump`. Do not start by adding a wide-open rule.
- If SYNs never hit `tcpdump` on the host, the problem is *not* iptables on that host.
- If SYNs hit and RSTs or nothing leaves, look at the process bind address and the OUTPUT/FORWARD policy.
- conntrack: when count sits on max, new connections fail weirdly. Raise `_max` *and* find scanners, short-lived connections, or missing timeouts. `nf_conntrack_tcp_timeout_established` is a common lever.
- IPv6 has a separate ruleset. A host that is “open on v4 and black-holed on v6” will fail for clients that prefer AAAA.
- Prefer reject during debug, drop in production if you must hide the listener. Leaving DROP everywhere makes every ticket start with a 30-second hang.
- Document *why* a port is open next to the rule. Future you will not remember the vendor callback that needed 8443.

## Related Notes

- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[ip Command Deep Dive]]
- [[Routing]]
- [[TCP IP Troubleshooting Model]]
- [[Cloud Networking]]
- [[Services DNS and Ingress]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “firewalld is broken” outage was a cloud security group that allowed 443 from the office prefix and not from the new NAT gateway. Host `nft list ruleset` was a clean accept. Packet captures on the instance never saw the SYN.
- Mixing `iptables -I INPUT` “just for today” with firewalld meant the next `firewall-cmd --reload` (or a package that reloaded it) dropped the hole and the vendor integration. If the host runs firewalld, use `--add-port` / `--add-rich-rule` and `--permanent`.
- conntrack at 100% looked like a flaky app. A misconfigured health check opened a new TCP connection every second from hundreds of probes. Raising the table was a bandage; fixing the checker was the fix.
