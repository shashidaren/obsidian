# TCP Retransmission and Loss Detection

## Concept

TCP retransmits segments that are not acknowledged within the RTO. Retransmits are normal under mild loss; a rising retransmit rate, especially with high RTT, indicates path loss, bufferbloat, or a middlebox. `ss -ti` and `nstat` expose per-socket and system-wide counters without a packet capture.

## Why it matters

- Application timeouts are often retransmit storms, not application bugs.
- A single lossy hop (or a full switch buffer) can make an entire service look slow while CPU and disk are idle.
- Capturing every packet on a busy host is expensive; counters let you confirm loss first.
- Cloud “packet loss” alerts are frequently asymmetric routing or a security group that drops return traffic.

## Mental Model

```
sender → segment
    → ACK expected within RTO
        → no ACK → retransmit (cwnd shrinks)
            → more loss → exponential backoff, throughput collapse

ss -ti shows:
  retrans, rto, rtt, cwnd, bytes_acked
nstat shows system totals:
  TcpRetransSegs, TcpExtTCPLoss, etc.
```

High retrans + low CPU = network or remote. High retrans + local softirq = often local stack or driver.

## Key Commands

```bash
# Per-socket view (look for retrans, high rtt)
ss -ti dst <ip> or ss -ti state established

# System counters (delta over time)
nstat -az TcpRetransSegs TcpExtTCPLoss TcpExtTCPLostRetransmit
# or
cat /proc/net/snmp | grep Tcp
watch -n1 'nstat -az | grep -E "Retrans|Loss"'

# Interface errors that can cause apparent loss
ethtool -S eth0 | grep -E 'err|drop|fifo'
ip -s link show eth0
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Slow responses, low CPU | Path loss or bufferbloat | `ss -ti`, nstat Retrans |
| Retrans climb after deploy | New route, MTU, or firewall | traceroute, Path MTU |
| Only one direction slow | Asymmetric path or return DROP | tcpdump both ends |
| High retrans on one socket | Remote app slow or full queue | remote `ss`, app logs |
| Zero retrans but timeouts | Blackhole or idle timeout | conntrack, firewall logs |

## Investigation Tips

- Sample `ss -ti` on a few representative connections before you start tcpdump. A few sockets with `retrans` > 0 and rising RTT is enough evidence.
- `nstat` deltas over 10–30 seconds are more useful than absolute counters. Reset with `nstat -r` only if you know the previous values are uninteresting.
- Interface `rx_dropped` or `tx_fifo_errors` point at the local NIC; pure retransmits with clean ethtool counters point at the path.
- After confirming loss, check MTU and PMTUD next — black-hole MTU produces the same symptom as random loss. See [[Path MTU Discovery and Blackholes]].

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[TCP Memory and Socket Buffers]]
- [[Path MTU Discovery and Blackholes]]
- [[ss Deep Dive]]
- [[ethtool Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “database is slow” ticket showed 8–12% retransmits on the app-to-DB connections and zero on the DB host itself. The loss was on a overloaded top-of-rack switch; fixing the switch buffer config restored normal latency without touching the database.
- I once spent an hour in application logs because `ss` was not in the default path on a minimal container. Installing iproute2 or using `cat /proc/net/tcp` would have shown the retrans column immediately.
