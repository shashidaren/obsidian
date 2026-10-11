# firewalld Deep Dive

## Concept

firewalld is a zone-based front-end to nftables (or iptables, on older builds). It does not replace Netfilter. It owns the ruleset and will rewrite it on `--reload`, restart, or package update.

A zone is a trust bucket bound to a source CIDR or an interface. Services and ports are allowed *inside a zone*. The default zone is where traffic goes when nothing more specific matches. Runtime changes and permanent changes are different stores.

## Why it matters

- `iptables -I` on a firewalld host is gone at the next reload. The ticket returns after the next patch window
- A service can be listening and still time out because the packet hit `drop` in the wrong zone
- `--permanent` without `--reload` means the running host and the next boot disagree
- Docker and podman insert their own chains. firewalld can forward past them, or fight them, depending on version and `FirewallBackend`
- Rich rules and direct rules are how one-off exceptions become unreadable policy

## Mental Model

```
packet in
  → source zone (CIDR match)  wins over
  → interface zone
  → else default zone (often public)
       → services / ports / rich rules
       → target: ACCEPT, DROP, REJECT, or default (reject-ish)

stores:
  runtime   firewall-cmd --list-all          (lost on reload/reboot)
  permanent /etc/firewalld/                   (applied on reload/boot)
```

Zones you will actually see: `public` (default, ssh often pre-allowed), `internal`, `trusted` (accept everything), `drop`, `block`. Assigning an interface to `trusted` to "make it work" is how a management NIC becomes a wide-open path.

`firewall-cmd --list-all` is the running policy for the default zone only. Always check `--get-active-zones` and `--list-all-zones` when more than one NIC exists.

## Key Commands

```bash
systemctl is-active firewalld
firewall-cmd --state
firewall-cmd --get-active-zones
firewall-cmd --get-default-zone
firewall-cmd --list-all
firewall-cmd --list-all-zones
firewall-cmd --permanent --list-all

# What is allowed, exactly
firewall-cmd --zone=public --list-services
firewall-cmd --zone=public --list-ports
firewall-cmd --zone=public --list-rich-rules
firewall-cmd --info-service=https

# Runtime only (lost on reload) — use to test
firewall-cmd --zone=public --add-port=8443/tcp
# Then persist
firewall-cmd --permanent --zone=public --add-port=8443/tcp
firewall-cmd --reload

# Bind a NIC or a source
firewall-cmd --permanent --zone=internal --change-interface=eth1
firewall-cmd --permanent --zone=internal --add-source=10.8.0.0/24

# Panic and logging while you debug
firewall-cmd --set-log-denied=all    # revert to off after
nft list ruleset | less
iptables -V                          # nf_tables vs legacy
```

Confirm the process is listening before you open a hole:

```bash
ss -lntup | grep 8443
tcpdump -ni eth0 port 8443
```

Backend: `FirewallBackend=nftables` in `/etc/firewalld/firewalld.conf` on current RHEL/Fedora. Listing only `iptables -L` can look empty when nftables is the real table.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Timeout from outside, works on localhost | Packet in `public` drop; process bound to localhost | `ss` bind address; active zone; tcpdump |
| Opened the port, still closed after reboot | Runtime add, never `--permanent` | compare `--list-all` vs `--permanent --list-all` |
| Permanent add, still closed | No `--reload`, or wrong zone | active zones; interface binding |
| Worked until `dnf update` / reload | Direct iptables rule, or direct.xml | who owns the ruleset; `nft list ruleset` |
| Second NIC wide open or fully closed | Interface in unexpected zone | `--get-active-zones` |
| Source-based rule never matches | Overlapping sources; interface zone used instead | more specific source zone; rich rule order |
| Docker published port dead after firewalld start | Chain order / docker zone integration | `nft list ruleset`; docker network docs for the distro |
| `REJECT` vs clients that hang | Client expected drop, or ICMP blocked so reject is invisible | target of the zone; capture ICMP |
| Rich rule "added" but not hit | Wrong family, priority, or zone | `--list-rich-rules`; log-denied |

## Investigation Tips

- Prove the SYN arrives with `tcpdump` before you add a port. No SYN means the cloud security group or an upstream ACL, not firewalld.
- Change runtime first. When the path works, copy the same change to `--permanent` and `--reload` while you still have a session.
- `--reload` drops runtime-only rules and can blip established flows that were allowed only by a direct rule. Do not reload a production box to "see if it sticks" without a backout.
- `public` allows `ssh` on a default RHEL install. Removing the ssh service without a console path is a lockout. Add the new path first.
- Services are XML port bundles (`/usr/lib/firewalld/services`). A custom app on 8443 is a port or a copied service, not `--add-service=https`.
- IPv6 is a separate match. Opening `443/tcp` usually covers both, but a rich rule with `family="ipv4"` does not.
- Log denied packets briefly (`--set-log-denied=all`, then `journalctl -k` or `/var/log/messages`). Leave it on and you will fill the disk.
- If the host is supposed to be managed by nftables drop-in files or security groups only, disabling firewalld is a decision. Running both and editing the lower layer is how rules vanish.

## Related Notes

- [[Firewall and NAT]]
- [[nftables Deep Dive]]
- [[DNAT Port Forwarding]]
- [[Routing]]
- [[ss Deep Dive]]
- [[tcpdump Deep Dive]]
- [[Cloud Networking]]
- [[TCP IP Troubleshooting Model]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The port was open in `--permanent` and closed in runtime for three weeks because nobody reloaded. The next reboot was the outage. I now diff the two lists before I close the change.
- A rich rule on `public` never matched traffic from the VPN because the source CIDR was bound to the `internal` zone, which had no matching rule. Source zone wins. I had edited the wrong bucket.
- `iptables -I INPUT -j ACCEPT` "for the vendor" survived until the next `firewall-cmd --reload` from a config-management run. The vendor path died at 02:00. Permanent firewalld or do not touch the host.
