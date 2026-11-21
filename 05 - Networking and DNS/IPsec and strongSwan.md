# IPsec and strongSwan

## Concept

IPsec is the kernel’s packet-level security framework (ESP/AH, transport or tunnel mode). strongSwan is the most common userspace IKE daemon that negotiates the keys and policies. The kernel enforces the SAs; strongSwan only sets them up and tears them down.

It is heavier than WireGuard and more flexible (route-based vs policy-based, NAT-T, legacy interoperability). See [[WireGuard Operations]] for the modern alternative when you control both ends.

## Why it matters

- Site-to-site tunnels to vendors, cloud VPN gateways, and older network gear still speak IPsec.
- A stuck CHILD_SA or a missing traffic selector looks exactly like a routing blackhole.
- NAT traversal (UDP/4500) is mandatory for almost every internet path; forgetting it produces “IKE works, data does not”.
- Dead Peer Detection (DPD) and rekey timers decide whether a tunnel recovers after a path change or stays half-dead.

If packets vanish only for certain subnets and `ip route` looks correct, check whether an IPsec policy is eating them.

## Mental Model

```
IKE (UDP/500 or 4500)
    → strongSwan negotiates IKE_SA
    → then CHILD_SA (ESP)
    → kernel xfrm policies + states

Policy-based: traffic selectors decide what is encrypted (no extra interface)
Route-based: VTI or XFRM interface; you route into it like any other device
```

A packet matches a policy → it must have a matching state or it is dropped (or sent in the clear if the policy allows). `ip xfrm policy` and `ip xfrm state` are the ground truth; swanctl is the control plane.

## Key Commands

```bash
# Is strongSwan running and what does it think?
systemctl status strongswan-starter strongswan --no-pager
swanctl --list-sas
swanctl --list-conns

# Kernel view (the one that actually matters)
ip xfrm policy
ip xfrm state
ip xfrm monitor   # live

# Force a rekey or bring up
swanctl --initiate --child <name>
swanctl --terminate --ike <name>

# Logs
journalctl -u strongswan -f
# or charon debug in strongswan.conf

# Quick path check
ping -c 3 <remote-subnet-host>
# then look at byte counters in swanctl --list-sas
```

Typical swanctl.conf fragment (route-based VTI style):

```
connections {
  site-a {
    remote_addrs = 203.0.113.5
    local { auth = psk; id = @left }
    remote { auth = psk; id = @right }
    children {
      net {
        local_ts = 10.1.0.0/16
        remote_ts = 10.2.0.0/16
        updown = /usr/libexec/ipsec/_updown iptables
        # or mark + VTI
      }
    }
  }
}
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| IKE establishes, no data | traffic selectors mismatch or policy not installed | `swanctl --list-sas`, `ip xfrm policy` |
| Works one way only | asymmetric TS or firewall on ESP | both ends `ip xfrm state`, counters |
| Tunnel dies after idle | DPD too aggressive or NAT mapping expired | DPD settings, UDP/4500 keepalive |
| “No proposal chosen” | cipher mismatch (legacy peer) | charon log, ike= / esp= lines |
| Packets disappear for one subnet | overlapping policy or wrong mark | `ip xfrm policy`, route table |
| High CPU on charon | rekey storm or too many SAs | `swanctl --list-sas`, timers |
| After reboot, tunnel stays down | auto=route or auto=start missing | conn definition, `swanctl --load-all` |

## Investigation Tips

- Start with `swanctl --list-sas`. If the CHILD_SA is missing or has zero bytes, the problem is negotiation or selectors, not the application.
- `ip xfrm policy` shows what the kernel will encrypt. If your packet does not match any policy, it goes in the clear (or is dropped by a drop policy).
- NAT-T: if either side is behind NAT, you need UDP/4500 open and `forceencaps=yes` or the equivalent. ESP alone (protocol 50) will not traverse most NATs.
- Clock skew breaks certificate-based IKE the same way it breaks TLS. See [[Time Sync and chrony]].
- A route-based setup is easier to debug than policy-based: you can `tcpdump` on the VTI and on the physical interface separately.
- After a path change (failover, cloud floating IP), DPD must be enabled or the SA stays pointed at the old address until the rekey timer fires.

## Related Notes

- [[WireGuard Operations]]
- [[Routing]]
- [[Firewall and NAT]]
- [[Time Sync and chrony]]
- [[ip Command Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A vendor tunnel showed “ESTABLISHED” in swanctl but zero bytes on the CHILD_SA. The remote traffic selector was `10.0.0.0/8`; ours was `10.1.2.0/24`. The SA came up; the kernel policy never matched the packets we sent. Narrowing both sides fixed it.
- After a firewall change that allowed UDP/500 but not 4500, new tunnels from behind NAT failed while old ones kept working until the next rekey. Always open both.
- I spent an afternoon chasing a “routing loop” that was an xfrm policy with a higher priority than the VTI route. `ip xfrm policy` sorted by priority would have shown it immediately.
