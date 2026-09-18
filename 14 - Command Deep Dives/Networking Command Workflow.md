# Networking Command Workflow

## Concept

A fixed order of checks from link → address → route → socket → DNS → path → packets. Same sequence every ticket. The goal is to name the *first layer that fails*, not to collect random command output.

Most “network down” tickets are not the firewall. They are: interface down, wrong route, nothing listening, or DNS.

## Why it matters

- Jumping to `tcpdump` or iptables first burns the half hour that `ip route get` would have closed
- A consistent workflow produces notes another engineer can resume
- Containers and policy routing make “ping works, app fails” normal; layer order is how you stay sane
- You want one sentence: “fails at L3 from this namespace to that prefix” or “L4 connection refused on :5432”

## Mental Model

```
1. Link      carrier, admin state, offload oddities
2. Address   right IP, right mask, right namespace
3. Neighbour ARP/ND for the next hop
4. Route     what ip route get actually selects
5. Socket    listen / established / syn-sent / close-wait
6. Name      the name the *app* uses, not the one you typed
7. Path      ping/mtr only after 1–6 look sane
8. Packets   tcpdump/pcap to confirm, not to explore
```

Work upward through the stack. Do not skip a layer because the previous ticket was iptables.

## Key Commands

```bash
# 0. Where am I?
hostnamectl; ip netns identify $$; lsns -t net

# 1. Link + address
ip -br link
ip -br addr
ip link show dev eth0
ip addr show dev eth0
ethtool eth0 | grep -E 'Link detected|Speed|Duplex'

# 2. Route the kernel will *really* use
ip route show
ip route get 1.1.1.1
ip route get 10.4.2.15 from 10.4.2.8 iif eth0

# 3. Neighbour / next hop
ip neigh show dev eth0
ping -c 2 -W 1 <gateway>

# 4. Sockets
ss -tulpn
ss -tp state syn-sent
ss -tp state established '( dport = :443 or sport = :443 )'
ss -s

# 5. DNS as the application sees it
cat /etc/resolv.conf
resolvectl status          # if systemd-resolved
dig +short app.internal.example
dig @127.0.0.53 app.internal.example A
getent hosts app.internal.example

# 6. Path (only now)
ping -c 3 -W 2 <target-ip>
mtr -r -c 10 <target-ip>   # or traceroute -n
curl -v --connect-timeout 3 --max-time 8 https://app.internal.example/health

# 7. Packets (narrow filter)
tcpdump -ni eth0 host <ip> and port 443
```

Policy routing extra: `ip rule show` then `ip route show table <id>`. `ip route get` already consults rules; read its `table` and `src` fields.

## Common Failure Modes & Symptoms

| Symptom | Layer first | Typical commands |
|---------|-------------|------------------|
| No carrier / DOWN | Link | `ip link`, `ethtool`, dmesg, cloud ENI |
| No IPv4 / wrong prefix | Address | `ip addr`, DHCP/cloud-init logs |
| On-subnet works, off-subnet dies | Route / gateway / neigh | `ip route get`, `ip neigh` |
| Connection refused | Listen socket | `ss -tulpn` — wrong ns? |
| SYN sent, no reply | Path, remote, or filter | `ss -tp state syn-sent`, mtr, then pcap |
| Timeout with established sockets | App hang or middlebox | `ss -ti`, app logs, proxy timeouts |
| Works by IP, fails by name | DNS | `dig`, `getent`, nsswitch |
| Works on host, fails in pod | Namespace / NetworkPolicy | exec into pod, repeat from step 0 |
| Intermittent | Loss, MTU, conntrack | mtr, `ip -s link`, pcap size vs MSS |
| One VIP works, one fails | LB / backend health | [[Reverse Proxies]] |

## Investigation Tips

- `ip route get <dst>` is the single most valuable networking command. Believe it over “the default route looks fine”.
- Repeat the same steps from the *peer* when you can. Asymmetry (source NAT, return path, different resolver) shows up immediately.
- Confirm the namespace before any other conclusion. `ss` on the host will not show a socket that only exists in the pod.
- Capture after you know interface, addresses, and port. Untargeted pcap is a souvenir, not evidence.
- Write down the first failing layer in the ticket title. “DNS NXDOMAIN for db.svc from app-3” is an incident. “Network issue” is not.
- Firewall changes come after you have a packet that arrives and a packet that does not. Not before.

## Related Notes

- [[ip Command Deep Dive]]
- [[ss Deep Dive]]
- [[dig Deep Dive]]
- [[tcpdump Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Routing]]
- [[ARP and Neighbor Discovery]]
- [[DNS Resolution]]
- [[Firewall and NAT]]
- [[curl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once spent forty minutes in iptables because `curl https://db` failed. `ss -tulpn` showed nothing on 5432 — postgres had not started. Layer 4 before layer 4 filtering.
- `ip route get` exposed a leftover policy rule sending 10.0.0.0/8 into a dead tunnel after a failed change. `ip route show` on table main looked perfect.
- In Kubernetes, running the workflow *inside* the app container and again on the node is the whole job. Half of our “cluster network” tickets were resolv.conf or a NetworkPolicy, not the CNI falling over.
