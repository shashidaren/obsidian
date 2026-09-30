# Keepalived and VRRP

## Concept

keepalived implements **VRRP**: two or more routers/hosts share a virtual IP. One is MASTER and owns the VIP. If it dies or its check fails, a BACKUP takes the VIP and sends gratuitous ARP so clients follow.

This is not HTTP keep-alive. That is [[HTTP Keep-Alive and Upstreams]]. keepalived is failover of an address, not reuse of a TCP connection.

## Why it matters

- A lot of on-prem HA is still “VIP + two nginx/haproxy boxes”
- Failover that only works for `systemctl stop` and not for a hard crash is fake HA
- Split-brain (two MASTERs, two VIPs advertised) is worse than downtime
- Stale ARP after failover looks like “half the network cannot reach the site”
- Priority, `advert_int`, and the track script decide whether you fail over in 1 second or flap all night

## Mental Model

```
BACKUP watches VRRP adverts from MASTER
  MASTER dies or track_script fails
    → highest remaining priority becomes MASTER
    → VIP is added locally
    → gratuitous ARP: this MAC now owns the IP
    → clients and switches update neighbour tables
```

States: `INIT` → `BACKUP` → `MASTER` (or `FAULT` if the check fails).

`nopreempt` means a recovered higher-priority node does *not* steal the VIP back. That is usually what you want in production.

The track script must reflect *user* health (proxy can talk to backends), not merely `pidof keepalived`.

## Key Commands

```bash
# Config and process
keepalived -t -f /etc/keepalived/keepalived.conf
systemctl status keepalived --no-pager
journalctl -u keepalived -n 80 --no-pager

# Who owns the VIP right now?
ip -br addr
ip addr show dev eth0 | grep -E 'inet |secondary'

# Neighbour view from a client after failover
ip neigh show
ping -c 2 <vip>

# Is VRRP actually on the wire? (protocol 112)
tcpdump -ni eth0 proto 112

# Script the service uses — run it by hand
# (path comes from track_script in the conf)
/etc/keepalived/check_haproxy.sh; echo $?

# After a failover, confirm only one MASTER
hostname; ip -br addr; systemctl is-active haproxy nginx
```

Minimal ideas that belong in the conf (do not copy blindly):

- unique `virtual_router_id` per VIP on the LAN
- unicast peers if the switch floods VRRP poorly
- `authentication` if the L2 is shared
- `notify` scripts that dump a line to syslog: became MASTER / BACKUP

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Both nodes MASTER | Partition, different VRID, firewall drops proto 112 | `tcpdump proto 112` on both; compare conf |
| VIP stays on the dead box | Interface still “up” after crash; check too weak | Power-off test; track_script |
| Clients split after failover | Stale ARP / missing GARP | `ip neigh` on a client; [[ARP and Neighbor Discovery]] |
| Flapping every few seconds | Check too tight, or script fails under load | Script by hand; raise timeout/weight |
| Works after `systemctl stop`, not after crash | VRRP tied to a software state that never drops | Pull the cable / power off |
| VIP present, service dead | keepalived up, haproxy/nginx down, no track_script | Couple the check to the data plane |
| Cloud VIP never moves | Provider floating IP is API-driven, not VRRP | Use the cloud failover primitive |

## Investigation Tips

- Draw two boxes, one VIP, one LAN. Write who should send GARPs and who clients ARP for.
- `virtual_router_id` collisions with another pair on the same VLAN produce mystery MASTER fights.
- Unicast VRRP needs the peer IPs to stay correct after a NIC swap.
- In the cloud, keepalived GARP often does nothing. Attach/detach the floating IP with a `notify_master` script against the provider API, or use their LB.
- Test three failovers on a calendar: stop the process, stop the NIC, power off the host. Record observed time to healthy VIP.
- After failover, check *a client*, not only the new MASTER. ARP is the usual leftover.

## Related Notes

- [[High Availability]]
- [[ARP and Neighbor Discovery]]
- [[Reverse Proxies]]
- [[HTTP Keep-Alive and Upstreams]]
- [[ip Command Deep Dive]]
- [[Routing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first “keepalived outage” I owned was two MASTERs after someone cloned the VM and forgot to change `virtual_router_id`. Both boxes answered the VIP. Unique VRID is not optional.
- A check that only tested `systemctl is-active nginx` kept the VIP on a node whose upstreams were all dead. Check what the user hits.
- Cloud “just run keepalived like on-prem” wasted a day. The hypervisor never learned the GARP. The notify script that moved the floating IP was the real failover.
