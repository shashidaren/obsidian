# nftables Deep Dive

## Concept

nftables is the current userspace for the Netfilter packet filter. It replaces the iptables/ip6tables/arptables/ebtables family with one tool and one ruleset language. firewalld, Docker, and many CNIs write nftables rules under the hood; listing only `iptables -L` on a modern distro often shows an empty or compatibility view.

Rules live in tables → chains → rules. A chain is attached to a hook (input, forward, output, prerouting, postrouting) at a priority. The first matching rule with a terminal verdict (accept, drop, reject, return) wins unless you explicitly continue.

## Why it matters

- A timeout that looks like an application bug is frequently an nftables drop you cannot see with the wrong tool.
- Mixing `iptables -I` and `nft` on the same host produces rules that vanish on the next firewalld reload or package update.
- conntrack helpers, counters, and sets are first-class; you can rate-limit or match a dynamic set of attackers without a shell loop.
- Cloud images and Kubernetes often install both nftables and an iptables-nft compatibility layer. The effective policy is the union, not the file you edited.

## Mental Model

```
packet
  → hook (prerouting / input / forward / output / postrouting)
       → priority (raw, mangle, filter, nat, …)
            → chain
                 → rule (match + verdict)

families: ip, ip6, inet (both), arp, bridge, netdev
inert vs active: `nft list ruleset` is what the kernel is enforcing right now
```

`inet` tables handle IPv4 and IPv6 together. A rule you wrote only for `ip` leaves v6 open (or vice versa).

Sets and maps let you match thousands of addresses or ports without a linear rule list. Counters and limits attach to the rule so you can see whether it is actually hit.

## Key Commands

```bash
# What is actually loaded
nft list ruleset
nft list tables
nft list chain inet filter input

# Verbose counters and handles (needed to delete)
nft -a list ruleset

# Add a temporary rule (lost on flush/reload unless you persist it)
nft add rule inet filter input tcp dport 8443 counter accept

# Delete by handle
nft delete rule inet filter input handle 42

# Flush a chain or the whole table (incident only)
nft flush chain inet filter input

# Monitor live (useful while you reproduce)
nft monitor

# Persist: write a file and load it
nft -f /etc/nftables.conf
# or the distro unit
systemctl status nftables
```

Typical skeleton that survives reboot:

```
table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        iif "lo" accept
        tcp dport { 22, 443 } accept
        counter drop
    }
}
```

`nft list ruleset` after a firewalld or Docker start will show many generated chains. Do not delete them by hand.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `iptables -L` empty, traffic still dropped | nftables is the real backend | `nft list ruleset`, `iptables -V` |
| Rule added with `nft`, gone after reboot | Never written to `/etc/nftables.conf` or firewalld | `systemctl status nftables`, permanent store |
| Opened port in nft, still timed out | Higher-priority chain or cloud SG drops first | hook priority, `nft list ruleset`, tcpdump |
| IPv6 still blocked or open | Rule only in `ip` family | `nft list table inet filter` |
| Counter stays at 0 | Rule never matches (wrong chain, zone, or iif) | `-a` list, tcpdump, interface name |
| Docker/K8s ports stop working | You flushed the filter table | restore from backup or restart the engine |
| `Operation not permitted` on `nft` | Not root, or locked by another manager | id, who owns the ruleset |
| Conntrack full, new flows fail | Table max hit; nft rules look fine | `/proc/sys/net/netfilter/nf_conntrack_count` |

## Investigation Tips

- `nft list ruleset` first. If it is huge, pipe to `less` or grep the port/protocol you care about.
- Confirm the packet arrives with `tcpdump` before you add a rule. No SYN means the drop is upstream of this host.
- Prefer counters on the rule you just added so you can see hits without a second capture.
- On a firewalld host, use `firewall-cmd` for permanent changes. Direct `nft` edits are overwritten on the next reload.
- Sets are the right tool for dynamic allow/deny lists. A shell loop that adds one rule per IP will become unreadable and slow.
- `nft monitor` while you reproduce shows rule hits in real time. Stop it when done; it is chatty.
- Always have a console or out-of-band path before you change the input policy to drop.

## Related Notes

- [[Firewall and NAT]]
- [[firewalld Deep Dive]]
- [[tcpdump Deep Dive]]
- [[ss Deep Dive]]
- [[Routing]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `iptables -L` looked empty on a RHEL 9 box that was dropping everything. `nft list ruleset` showed a filter table with policy drop and no accept for the new port. The compatibility layer had hidden the real rules.
- I flushed the inet filter table to “start clean” during an incident. Docker’s published ports disappeared until the daemon was restarted. Now I only flush a chain I own.
- A counter that stayed at zero for ten minutes was an interface name mismatch (`eth0` vs `ens3`). The rule was correct; the packet never entered that chain.
