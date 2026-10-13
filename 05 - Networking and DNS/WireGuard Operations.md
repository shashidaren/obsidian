# WireGuard Operations

## Concept

WireGuard is a modern, kernel-level VPN that is intentionally small: a single interface, a set of peers identified by public keys, and allowed IP ranges. There is no userspace daemon for the data plane; `wg` and `wg-quick` manage the configuration. Handshakes are Noise_IK, keys are Curve25519, and the protocol has no “session” concept that can be half-open.

It is not a full routing stack. You still need routes (static, policy, or BGP) and firewall rules for the interface.

## Why it matters

- Replaces IPsec or OpenVPN for site-to-site and road-warrior with far less configuration surface and faster handshakes.
- Cryptokey routing means a packet is only accepted from a peer if its source address is in that peer’s AllowedIPs. Mis-set AllowedIPs is the #1 “it connects but no traffic” failure.
- Because the data plane is in the kernel, it survives most userspace crashes and has excellent performance, but a bad config can blackhole a subnet just as effectively as a wrong route.
- Useful for secure jump hosts, overlay networks, and replacing brittle GRE+IPsec.

## Mental Model

```
Interface (wg0)
  private key (this host)
  listen-port (usually 51820/udp)
  peers:
    public key
    allowed-ips  (what we will accept *from* and route *to* that peer)
    endpoint     (optional, for initiator)
    persistent-keepalive (for NAT)

Packet in:
  decrypt → source IP in peer's AllowedIPs? → accept
Packet out:
  destination IP in some peer's AllowedIPs? → encrypt and send to that peer's endpoint
```

AllowedIPs is both a routing table and an ACL. Overlapping AllowedIPs across peers is undefined and usually wrong.

## Key Commands

```bash
# Status (does not require root on some distros)
wg show
wg show wg0

# Quick start / stop (reads /etc/wireguard/wg0.conf)
wg-quick up wg0
wg-quick down wg0
systemctl enable --now wg-quick@wg0

# Live changes
wg set wg0 peer <pubkey> endpoint <ip>:<port>
wg set wg0 peer <pubkey> allowed-ips 10.10.0.0/24

# Generate keys
wg genkey | tee private.key | wg pubkey > public.key

# Routing that must exist
ip route get 10.10.0.5
ip route show dev wg0
```

Typical `/etc/wireguard/wg0.conf` (server side):

```
[Interface]
PrivateKey = ...
Address = 10.10.0.1/24
ListenPort = 51820

[Peer]
PublicKey = ...
AllowedIPs = 10.10.0.2/32
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Handshake never completes | Wrong keys, firewall, or no endpoint | `wg show` (latest handshake), UDP/51820 open |
| Handshake ok, no traffic | AllowedIPs missing the dest/src | `wg show`, `ip route get` via wg0 |
| Works until NAT timeout | No PersistentKeepalive | peer config, 25s is common |
| One direction only | Asymmetric AllowedIPs or missing route on far side | both ends `wg show` + routes |
| MTU blackhole (large packets fail) | Default 1420 too big for path | set MTU lower on interface, `ping -M do` |
| Peer appears then vanishes | Clock skew (handshake timestamps) | [[Time Sync and chrony]], `wg show` timestamps |
| systemd unit fails | Permission on private key | `ls -l /etc/wireguard`, unit status |

## Investigation Tips

- `wg show` is the first command. “latest handshake” older than a couple of minutes means the tunnel is down even if the interface is up.
- Confirm the kernel module is loaded (`lsmod | grep wireguard`) and that you are not accidentally running the userspace Go implementation unless you meant to.
- AllowedIPs must cover every address you expect to receive from that peer *and* every address you want to send to it. Missing the server’s own address on the client is a classic.
- Firewall: UDP to the listen port must be open. Because there is no TCP, `ss` will not show a listening socket the way OpenVPN does; use `ss -ulpn` or `nft` counters.
- After adding a peer, you still need a route for the remote subnet (or AllowedIPs will only do cryptokey routing for addresses already in the table). `ip route add 10.20.0.0/16 dev wg0` is often required.
- PersistentKeepalive is mandatory for peers behind NAT that are not the initiator. Without it the mapping expires and the next packet from the server is blackholed.

## Related Notes

- [[Routing]]
- [[Firewall and NAT]]
- [[ip Command Deep Dive]]
- [[Time Sync and chrony]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Spent an hour debugging “no route to host” on a new WireGuard peer. The handshake was fine; the client’s AllowedIPs was `10.10.0.0/24` but the service I was reaching was on `10.20.0.5`. Cryptokey routing is not magic; it only forwards what you listed.
- A site-to-site link died every night at the same time. The far end was behind CGNAT and had no PersistentKeepalive. The mapping expired after 30 minutes of idle and only came back when the client sent something.
- MTU 1420 worked in the lab and failed in production because of an extra VLAN tag on the path. Dropping the WireGuard MTU to 1280 fixed the “small pings work, large API calls hang” symptom immediately.
