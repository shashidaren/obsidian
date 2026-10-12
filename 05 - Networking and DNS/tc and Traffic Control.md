# tc and Traffic Control

## Concept

`tc` (traffic control) is the kernel’s packet scheduler. It can shape outbound traffic, prioritize certain flows, or police inbound traffic. The most common production use is outbound shaping on a link that is smaller than the NIC speed, or prioritizing management/SSH over bulk transfers.

HTB (Hierarchical Token Bucket) and fq_codel are the usual qdiscs. Filters classify packets into classes.

## Why it matters

- A saturated uplink with no shaping makes latency explode for everyone (bufferbloat). SSH becomes unusable while a backup runs.
- Cloud and colo links are often rate-limited upstream. Shaping just below that rate keeps the queue in your kernel instead of the provider’s.
- Mis-applied filters can black-hole traffic or starve a class. Always have a default class.
- `tc` state does not survive reboot unless you put it in a script, NetworkManager dispatcher, or systemd unit.

## Mental Model

```
NIC
  → root qdisc (htb or fq_codel)
      → class 1:1 (parent)
          → class 1:10 (priority / guaranteed)
          → class 1:20 (bulk)
      → filters (u32, fw, bpf) match and direct to a class
```

Outbound only for most qdiscs. Inbound policing is possible but less common.

## Key Commands

```bash
# What is on the interface now?
tc qdisc show dev eth0
tc class show dev eth0
tc filter show dev eth0

# Simple fq_codel (often enough)
tc qdisc replace dev eth0 root fq_codel

# HTB sketch (shape to 900 Mbit, prioritize small flows)
tc qdisc add dev eth0 root handle 1: htb default 20
tc class add dev eth0 parent 1: classid 1:1 htb rate 900mbit
tc class add dev eth0 parent 1:1 classid 1:10 htb rate 100mbit ceil 900mbit
tc class add dev eth0 parent 1:1 classid 1:20 htb rate 800mbit ceil 900mbit
# filter example: mark from iptables/nft
# tc filter add dev eth0 protocol ip parent 1:0 prio 1 handle 10 fw classid 1:10

# Remove
tc qdisc del dev eth0 root
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Latency spikes when link is busy | no shaping, bufferbloat | `tc qdisc`, `ping` during transfer |
| Traffic slower than expected | ceil too low or filter wrong | `tc class`, counters |
| Some flows starved | missing default class or filter miss | `tc filter show`, packet marks |
| Rules gone after reboot | not persisted | NM dispatcher, systemd unit, cloud-init |
| Works on one NIC, not bond | qdisc on slave instead of bond | apply to the bond device |

## Investigation Tips

- Start with `tc qdisc show`. If you see only `pfifo_fast` or `noqueue` on a busy link, you have no protection against bufferbloat.
- fq_codel is the low-effort win for most hosts. HTB is for when you need explicit rate guarantees or priority classes.
- Persist the configuration. A one-off `tc` command is forgotten at the next reboot or NetworkManager restart.
- On bonds and bridges apply the qdisc to the top-level device, not the slaves.
- Measure before and after: `ping` or `mtr` during a bulk transfer is the quickest proof.

## Related Notes

- [[Routing]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Firewall and NAT]]
- [[NetworkManager Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A backup saturated a 1 Gbit uplink and made SSH unusable. `fq_codel` on the uplink interface dropped the latency from seconds to milliseconds with no other change.
- An HTB class with no default sent unmatched traffic into a black hole. Always set `default`.
- The shaping rules lived only in a shell history. After a NetworkManager restart they vanished and the next backup again killed interactivity. They now live in a dispatcher script.
