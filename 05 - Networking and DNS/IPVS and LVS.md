# IPVS and LVS

## Concept

IPVS (IP Virtual Server) is the in-kernel load balancer. LVS is the userspace tooling and architecture around it (`ipvsadm`, keepalived, or a custom director). Traffic arrives at a virtual IP (VIP). The director rewrites destination (and sometimes source) and forwards to real servers without terminating the TCP connection in userspace.

Unlike HAProxy, IPVS does not speak HTTP, check application health itself, or terminate TLS. It is a packet-level director.

## Why it matters

- High connection rates and low latency forwarding (especially DR mode) that userspace proxies cannot match.
- Misconfigured persistence, weight, or scheduler produces sticky or black-holed backends that look like application bugs.
- Direct routing (DR) mode requires real servers to accept packets for a VIP they do not own; ARP suppression is mandatory or the VIP flaps.
- Connection tracking and NAT modes interact with firewalls and SNAT in ways that drop return traffic.

If the VIP answers but backends are silent, the problem is usually the director or the real-server ARP setup, not the application.

## Mental Model

```
Client → VIP (director)
    → scheduler picks real server (rr, wrr, lc, wlc, sh, ...)
    → forwarding method:
         NAT  (director rewrites both ways; return path must go through director)
         DR   (director only rewrites MAC/dest; real server answers directly with VIP as source)
         TUN  (IPIP tunnel to real server)

Persistence: connection affinity by client IP (or other) for a timeout.
```

DR mode is fastest and most common for high throughput. Real servers need the VIP on a loopback or dummy interface and must not answer ARP for it.

## Key Commands

```bash
# Current virtual services and real servers
ipvsadm -Ln
ipvsadm -Ln --stats
ipvsadm -Ln --rate

# Detailed connection table (can be large)
ipvsadm -Ln -c | head

# Module and parameters
lsmod | grep ip_vs
cat /proc/net/ip_vs
cat /proc/sys/net/ipv4/vs/*

# Common with keepalived
systemctl status keepalived --no-pager
journalctl -u keepalived -n 30 --no-pager

# On real servers (DR mode)
ip addr show | grep VIP
sysctl net.ipv4.conf.all.arp_ignore
sysctl net.ipv4.conf.all.arp_announce
```

Typical `ipvsadm` lines:

```
-A -t 10.0.0.10:80 -s wlc
-a -t 10.0.0.10:80 -r 10.0.1.11:80 -g -w 100
```

`-g` is DR (gatewaying), `-m` is NAT, `-i` is tunnel.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| VIP silent | Director down, or no real servers active | `ipvsadm -Ln`, keepalived logs |
| Traffic only to one real server | Persistence too long, or scheduler weight | `ipvsadm -Ln --stats`, persistence timeout |
| DR mode: clients get no reply | Real server not configured for VIP, or ARP not suppressed | `ip addr`, arp_ignore/announce, tcpdump on real server |
| NAT mode: one-way traffic | Return path not through director, or SNAT missing | routing on real servers, conntrack |
| New connections fail after failover | Stale persistence entries, or wrong VIP owner | `ipvsadm -Ln -c`, VRRP state |
| High CPS but low throughput | Scheduler or weight mismatch, or real server overload | `--rate` and real server metrics |
| Connections stuck after real server removal | No graceful drain | weight to 0, then delete after drain |

## Investigation Tips

- `ipvsadm -Ln` first. If the VIP is missing or all real servers are weight 0 / inactive, the director is not forwarding.
- In DR mode, confirm the real server has the VIP on lo and that `arp_ignore=1` / `arp_announce=2` (or equivalent) is set. A real server that answers ARP for the VIP steals traffic.
- Persistence is client-IP based by default. A single NAT gateway or proxy in front of many clients looks like one source and sticks everything to one backend.
- Compare `ipvsadm --stats` ActiveConn / InActConn against real server load. Imbalance is usually weight or persistence, not the scheduler name.
- When draining, set weight to 0 first so existing connections finish; do not delete the real server immediately.
- IPVS does not do application health checks. That is keepalived's job (or an external checker). A real server that is "up" in IPVS can still be returning 500s.

## Related Notes

- [[HAProxy Operations]]
- [[Keepalived and VRRP]]
- [[Routing]]
- [[nf_conntrack and Connection Tracking]]
- [[nftables Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- DR mode worked in the lab until the real servers answered ARP for the VIP. Traffic arrived at the director, then at a random real server that had claimed the VIP. arp_ignore fixed it; the application was never the problem.
- A long persistence timeout after a bad deploy pinned every client from a corporate NAT to the broken backend for 30 minutes. Lowering persistence and draining by weight was faster than waiting.
- I treated IPVS like HAProxy and looked for HTTP logs on the director. There are none. The evidence is `ipvsadm` and packet captures on the real servers.
