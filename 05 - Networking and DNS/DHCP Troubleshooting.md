# DHCP Troubleshooting

## Concept

DHCP is how a host learns its address, mask, gateway, and usually DNS without static config. The client (dhclient, NetworkManager’s DHCP plugin, systemd-networkd) broadcasts DISCOVER, the server offers, the client requests, the server acks with a lease.

Leases expire. Renewals are unicast to the server that granted them. Failover, relay agents, and “option 82” are where most production incidents live.

## Why it matters

- A host that boots with no address or the wrong subnet is offline before any service starts.
- Duplicate addresses (two servers, or a static host colliding with the pool) cause intermittent blackholes that look like “random packet loss”.
- PXE/network boot depends on DHCP options (next-server, filename). A working data-plane lease can still leave machines unable to install.
- Cloud and bare-metal both use DHCP for the management interface; a broken relay is a fleet-wide outage.

## Mental Model

```
client (link up)
  → DHCPDISCOVER (broadcast, or unicast renew)
      → relay (if present) adds giaddr / option 82
          → server matches pool by giaddr or interface
              → DHCPOFFER
                  → DHCPREQUEST
                      → DHCPACK (lease, options)
                          → client configures address, starts T1/T2 timers

T1 (usually 50% of lease): unicast renew to original server
T2 (usually 87.5%): rebind broadcast if renew failed
```

Two independent things must work: the lease grant, and the options the application actually needs (DNS, NTP, domain, PXE).

## Key Commands

```bash
# Live lease state
ip addr show
nmcli -f DHCP4 device show eth0          # NetworkManager
networkctl status eth0                   # networkd
cat /var/lib/dhclient/dhclient.leases    # classic dhclient
cat /run/systemd/netif/leases/*          # networkd

# Capture the conversation (filter on port 67/68)
tcpdump -ni eth0 -vvv port 67 or port 68

# Force a renew (distro-specific)
nmcli connection up "System eth0"
dhclient -v eth0
networkctl renew eth0

# Server side (if you own it)
journalctl -u dhcpd -n 50 --no-pager
# or dnsmasq, kea, etc.
```

Key options to verify in the ACK: subnet-mask, routers, domain-name-servers, domain-name, ntp-servers, next-server, filename.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No address after boot | Server unreachable, wrong VLAN, relay dead | tcpdump on client and relay, giaddr |
| Address appears then disappears | Lease too short, renew fails | lease file timestamps, server logs |
| Wrong subnet / no route | Relay giaddr points at wrong pool | option 82, server pool config |
| Duplicate address warnings | Static host in pool, or two servers | arp, server lease DB, ping -c 1 |
| PXE fails, DHCP “works” | Missing next-server / filename | packet capture of ACK options |
| Works on one NIC, not the other | Profile bound to MAC that changed | nmcli connection show, udev |
| Renew works, rebind fails | Firewall blocks broadcast after T1 | tcpdump during T2 window |
| Cloud metadata unreachable | DHCP gave no route to 169.254.169.254 | route, cloud-init logs |

## Investigation Tips

- Capture on the client first. If you see DISCOVER and no OFFER, the problem is between the client and the server (VLAN, relay, server down, pool exhausted).
- If you see OFFER but the client ignores it, check that the client is not already holding a valid lease it prefers, or that the offered address is already in use (client does DAD).
- Relay agents rewrite the packet. A capture on the server side will show the giaddr; a capture on the client side will not. Compare both.
- Short leases during an incident are a feature: they force fast recovery. Long leases hide a broken renew path until the outage is large.
- NetworkManager and networkd both speak DHCP. Confirm which one owns the interface before you run dhclient by hand — two clients fight.
- After a server move or pool change, existing leases may point at the old server. Clients will fail renew until T2, then broadcast. Plan for that window.

## Related Notes

- [[NetworkManager Deep Dive]]
- [[systemd-networkd]]
- [[ip Command Deep Dive]]
- [[Routing]]
- [[cloud-init]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “random” outage on a new VLAN was option-82 missing on the switch. The DHCP server never saw the giaddr and offered from the wrong pool. One packet capture on the relay interface would have shown it.
- I once ran dhclient while NetworkManager was active. Both renewed, the address flapped, and a database connection pool died. One owner of the interface.
- PXE “DHCP works” tickets are almost always missing next-server in the ACK. Filter the capture for that option before you touch the TFTP server.
