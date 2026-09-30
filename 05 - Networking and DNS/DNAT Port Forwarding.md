# DNAT Port Forwarding

## Concept

DNAT (destination NAT) rewrites the destination address and/or port of a packet *before* the host decides where it goes. Typical use: public `203.0.113.8:443` lands on `10.0.0.20:8443`.

SNAT / MASQUERADE rewrites the *source* on the way out so replies can find their way back. You usually need both for a forwarded service.

Hairpin / NAT loopback is the extra case: a host *inside* the LAN tries to reach the service via the public IP. Without a hairpin rule, that packet dies.

## Why it matters

- “Port 443 is open on the firewall” is not the same as “traffic arrives on the app”
- Missing SNAT on forwarded traffic produces one-way connections: SYN arrives, reply goes the wrong path
- Hairpin bugs look like “it works from the office phone network, fails on office Wi-Fi”
- Docker and kube-proxy are DNAT engines. Their rules fight homemade iptables.
- A DNAT rule without a matching filter/FORWARD accept is a silent black hole

## Mental Model

```
Internet client
  → PREROUTING  DNAT  203.0.113.8:443 → 10.0.0.20:8443
  → FORWARD accept
  → 10.0.0.20:8443 app
  → reply
  → POSTROUTING SNAT/MASQUERADE so the client sees 203.0.113.8
```

Hairpin:

```
LAN client 10.0.0.50 → public VIP:443
  → must DNAT to 10.0.0.20
  → and SNAT to the gateway
  or the app replies straight to 10.0.0.50
    and the client rejects it (it expected the public IP)
```

Conntrack binds the rewrite. If conntrack is full or the helper is wrong, new forwards fail while old ones still look fine.

## Key Commands

```bash
# See the actual NAT rules
nft list ruleset
iptables -t nat -L -n -v --line-numbers
iptables -L FORWARD -n -v --line-numbers

# firewalld forward (example shape, adjust zone/family)
firewall-cmd --query-forward
firewall-cmd --list-all
firewall-cmd --permanent --add-forward-port=port=443:proto=tcp:toport=8443:toaddr=10.0.0.20
firewall-cmd --reload

# Is the app really listening where DNAT points?
ss -lntp | grep 8443
curl -sv --connect-timeout 3 http://10.0.0.20:8443/healthz

# From outside vs from the LAN vs from the box itself
curl -sv --connect-timeout 3 https://203.0.113.8/
curl -sv --connect-timeout 3 https://public.example/

# Follow one client
tcpdump -ni any host <client_ip> and port 443
conntrack -L -p tcp --dport 443 2>/dev/null | head

# IP forwarding must be on if this box is the router
sysctl net.ipv4.ip_forward
# 1, or forwarded packets die here
```

nft sketch (read, then adapt; do not paste into prod blind):

```
# dnat in prerouting, accept in forward, masquerade in postrouting
nft add rule inet nat prerouting tcp dport 443 dnat to 10.0.0.20:8443
nft add rule inet filter forward ip daddr 10.0.0.20 tcp dport 8443 accept
nft add rule inet nat postrouting ip saddr 10.0.0.0/24 masquerade
```

Persist with the front-end the box already uses (firewalld, nftables.conf, cloud DNAT). Runtime `nft add` dies on reboot.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Outside works, LAN via public IP fails | No hairpin / no SNAT on LAN sources | Test from a LAN host to the public IP |
| SYN arrives, no data | DNAT yes, FORWARD drop or rp_filter | FORWARD counters; `sysctl` rp_filter |
| Works to private IP, not to public | No DNAT or wrong port | `nft`/`iptables -t nat`; `tcpdump` |
| One-way traffic | Missing SNAT; reply bypasses the NAT box | Capture both directions |
| Fails only after idle | conntrack timeout vs client reuse | conntrack count; timeouts |
| Docker published port fights you | docker-proxy / iptables DOCKER chain | `iptables -t nat -L -n` |
| Fine until reboot | Runtime-only rule | Permanent config |
| Cloud: SG open, still dead | Need LB listener or provider NAT, not host DNAT | Provider path first |

## Investigation Tips

- Test three sources: localhost on the app, LAN private IP, public IP. The hairpin case is the third.
- If `tcpdump` on the NAT box never sees the SYN, this is not a DNAT problem. Start at the cloud SG / upstream router.
- `Connection refused` after DNAT means the rewritten destination had nothing listening. `Timed out` means drop or no route.
- Hairpin fix is SNAT-to-gateway for LAN clients talking to the public VIP. Split DNS (give LAN clients the private IP) is cleaner when you can.
- IPv6 is a separate ruleset. Dual-stack clients may hit AAAA while you only forwarded v4.
- See [[Firewall and NAT]] for conntrack exhaustion and front-end vs raw nft fights.

## Related Notes

- [[Firewall and NAT]]
- [[Routing]]
- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[Reverse Proxies]]
- [[Cloud Networking]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- “Port forward 443 to the new app” worked from my phone and failed from every office laptop. Office clients used the public DNS name on the LAN. No hairpin. Split-horizon DNS was cheaper than another NAT rule.
- A FORWARD policy of DROP with only an INPUT accept for 443 forwarded exactly nothing. Counters on FORWARD stayed zero until we added the accept on the *rewritten* port.
