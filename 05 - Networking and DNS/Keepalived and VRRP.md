# Keepalived and VRRP

## Concept

Keepalived implements VRRP (and optionally a simple load-balancer using IPVS). One or more hosts share a virtual IP (VIP). The host with the highest priority that is still alive owns the VIP and answers for it. When it fails or its health check fails, the next host takes the VIP.

It is the usual active/passive VIP mechanism for HAProxy, nginx, or a pair of routers when you do not want a full Pacemaker cluster.

## Why it matters

- A VIP that stays on a dead host is an outage even if the standby is healthy
- Split-brain (two hosts both owning the VIP) happens when VRRP advertisements are lost and no fencing exists
- Health checks that only test “process is running” fail over too late or not at all
- Priority, `nopreempt`, and advert intervals decide whether fail-back is automatic and how fast

If you cannot explain which host owns the VIP right now and what would make it move, you do not have HA.

## Mental Model

```
Host A (priority 150)  ──VRRP adverts──►  Host B (priority 100)
        │                                      │
        └── owns VIP 10.0.0.10 ◄────────────────┘
                (until A fails check or stops sending)

Health check script or track_interface
    → weight adjustment or state FAULT
        → priority drops or instance leaves MASTER
            → other host becomes MASTER and sends gratuitous ARP
```

States: MASTER, BACKUP, FAULT. Only MASTER should have the VIP configured on an interface.

## Key Commands

```bash
# Who has the VIP
ip -br addr show
ip addr show dev eth0 | grep 10.0.0.10

# keepalived itself
systemctl status keepalived
journalctl -u keepalived -n 100 --no-pager
keepalived -t -f /etc/keepalived/keepalived.conf   # syntax / dump

# VRRP traffic (multicast 224.0.0.18 or unicast)
tcpdump -ni eth0 vrrp
# or
tcpdump -ni eth0 host 224.0.0.18

# Force a fail-over for testing (careful)
systemctl stop keepalived          # on the current MASTER
# or lower priority temporarily via a notify script / weight
```

Minimal mental config shape:

```
vrrp_instance VI_1 {
    state BACKUP          # both sides BACKUP + nopreempt is common
    interface eth0
    virtual_router_id 51
    priority 150
    advert_int 1
    authentication { ... }
    virtual_ipaddress {
        10.0.0.10/24
    }
    track_script { chk_haproxy }
}
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| VIP never moves | Health check always succeeds, or adverts not seen | journal, tcpdump vrrp, script exit code |
| Both hosts have the VIP | Advert loss, firewall, different VRID, no preempt control | tcpdump on both, `ip addr`, VRID match |
| Flapping MASTER/BACKUP | Tight check + transient failure, or network loss | advert_int, check interval, link quality |
| Fail-over works, clients still hit old host | Gratuitous ARP missed, switch CAM, client ARP cache | tcpdump ARP, clear client ARP, switch logs |
| Works for `systemctl stop`, not for power loss | Script or notify depends on something that dies with the host | Test power-off or interface down |
| VIP on the wrong interface | `interface` directive does not match the real NIC | config vs `ip link` |
| Authentication mismatch | One side has auth, the other does not | journal “invalid” or silent drop |

## Investigation Tips

- Confirm VIP ownership with `ip addr` on both hosts before you touch anything. The journal can lag or be wrong if the process is wedged.
- `tcpdump -ni <if> vrrp` on both sides tells you whether adverts are leaving and arriving. No packets means firewall, wrong interface, or keepalived not running.
- Health-check scripts must exit non-zero when the *service* is unhealthy, not merely when the process exists. Test the script by hand.
- Gratuitous ARP is how the new MASTER tells the network. If clients or the switch ignore it, the VIP moves in `ip addr` but traffic does not.
- Prefer unicast VRRP peers when multicast is filtered. Document the peer list.
- After any change, force a fail-over in a window and confirm the VIP moves, the gratuitous ARP appears, and clients recover. Do not trust a config review alone.
- `nopreempt` stops the original higher-priority host from stealing the VIP back the moment it returns. Decide explicitly whether you want automatic fail-back.

## Related Notes

- [[High Availability]]
- [[Pacemaker and Corosync]]
- [[IPVS and LVS]]
- [[ARP and Neighbor Discovery]]
- [[Maintenance Windows and Drain]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The VIP stayed on a host whose HAProxy had deadlocked because the check only did `pidof haproxy`. Clients timed out; keepalived thought everything was fine. The check now hits the stats socket or a real backend.
- Two hosts both answered for the VIP after a switch maintenance dropped multicast. Unicast peer config would have survived. We now default to unicast unless multicast is proven.
- Fail-over looked perfect in `ip addr` and still failed for clients until we saw the missing gratuitous ARP. The new MASTER had sent it on the wrong VLAN interface.
