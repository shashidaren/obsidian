# TCP Congestion Control

## Concept

TCP congestion control decides how fast a sender may transmit after loss or delay signals. The classic algorithm is CUBIC (default on most Linux). BBR (Bottleneck Bandwidth and Round-trip propagation time) models the path differently and is less sensitive to bufferbloat.

The algorithm is a per-socket choice. The system default is `net.ipv4.tcp_congestion_control`. An application can request another with `setsockopt(TCP_CONGESTION)` if the module is loaded.

## Why it matters

- CUBIC can under-utilize long-fat networks or over-buffer small ones
- BBR can improve throughput on lossy or high-BDP paths but can be unfair to CUBIC flows
- Wrong algorithm shows up as "the network is slow" with clean `ping` and no packet loss in `ss`
- Cloud and container environments often have shallow buffers; CUBIC's loss reaction is expensive there
- Changing the default system-wide affects every new socket; existing connections keep the algorithm they started with

## Mental Model

```
loss / ECN / delay signal
    → congestion control algorithm
    → adjusts cwnd (congestion window)
    → effective rate ≈ cwnd / RTT

CUBIC: reacts to loss, probes aggressively after
BBR:  estimates bottleneck bandwidth and min RTT, paces to that
```

`ss -ti` shows the current algorithm, cwnd, RTT, and retransmits for a live socket. A sudden drop in cwnd with rising retransmits is the algorithm backing off. A stable cwnd with rising RTT is usually bufferbloat, not loss.

## Key Commands

```bash
# What is loaded and what is default
sysctl net.ipv4.tcp_congestion_control
sysctl net.ipv4.tcp_available_congestion_control
lsmod | grep -E 'tcp_bbr|tcp_cubic'

# Load BBR (if not built-in)
modprobe tcp_bbr
echo bbr > /proc/sys/net/ipv4/tcp_congestion_control
# persist in /etc/sysctl.d/

# Live sockets
ss -ti dst :443
# look for cubic or bbr, cwnd, rtt, retrans, delivery_rate (BBR)

# fq qdisc is recommended with BBR for pacing
tc qdisc show dev eth0
# tc qdisc replace dev eth0 root fq
```

BBR v1 needs the `fq` qdisc (or equivalent pacing) to work as designed. Without it, results are inconsistent. BBR v2/v3 behaviour differs; check the kernel version.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Low throughput, no loss, high RTT | Bufferbloat, CUBIC | `ss -ti` RTT vs cwnd, `tc` |
| Throughput collapses on tiny loss | CUBIC reacting hard | algorithm, loss rate, BBR trial |
| BBR "unfair" to other flows | Known BBR property | mix of algorithms on path |
| `sysctl` change does nothing | Existing sockets, or module not loaded | `ss -ti`, `lsmod` |
| BBR worse than CUBIC | No fq, or shallow bottleneck | `tc qdisc`, kernel version |
| Only some apps benefit | App sets its own algorithm | `ss -ti` per PID |
| Module load fails | Kernel config, secure boot | `dmesg`, `modprobe -v` |

## Investigation Tips

- Always capture `ss -ti` on the slow flow before changing the default. The algorithm and cwnd are in that output.
- System-wide BBR is a fleet change. Test on one host with a specific service first (`setsockopt` or a unit that loads the module).
- `fq` is not free. On a high-pps host it can increase CPU. Measure before and after.
- Cloud load balancers and middleboxes can rewrite or drop ECN; do not assume the signal you send is the signal the peer sees.
- After a kernel upgrade the available algorithms can change. Re-check `tcp_available_congestion_control`.
- Retransmits in `ss` are not automatically "the network". They can be the sender reacting to its own congestion control.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[tc and Traffic Control]]
- [[Path MTU Discovery and Blackholes]]
- [[TCP Memory and Socket Buffers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A backup job across a 100 ms, 1% loss path was stuck at ~20 Mbps on CUBIC. Switching that one process to BBR (via a wrapper that set the socket option) got it to 180 Mbps. We did not change the system default.
- Enabling BBR system-wide without `fq` produced worse latency for interactive SSH. The qdisc was the missing piece; the algorithm itself was fine.
