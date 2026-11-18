# Chaos Engineering Basics for Sysadmins

## Concept

Chaos engineering is the deliberate injection of failure (process kill, network delay, disk full, clock skew) into a system so you learn how it actually behaves before a real incident does it for you.

For sysadmins it is usually small, controlled experiments on non-production or carefully blast-radius-limited production hosts, not Netflix-scale chaos monkeys.

## Why it matters

- You discover that the "redundant" path was never tested, or that the monitoring alert never fired.
- A 30-second network blip that you inject is cheaper than the same blip at 02:00 on a Friday.
- It forces runbooks and rollback plans to be real instead of theoretical.
- It surfaces hidden dependencies (hard-coded IPs, missing retries, single points of failure).

## Mental Model

```
hypothesis: "if I kill this process / add 200 ms latency, the service stays up and the alert fires"
    → inject the failure (tc, kill, stress-ng, chronyc, etc.)
    → observe (metrics, logs, user-facing checks)
    → stop the injection
    → document what broke and what did not
```

Start with the smallest blast radius: one container, one non-critical host, one synthetic transaction.

## Key Commands

```bash
# Process
kill -STOP <pid>          # freeze
kill -CONT <pid>

# Network delay / loss (on a test interface)
tc qdisc add dev eth0 root netem delay 200ms
tc qdisc del dev eth0 root

# Disk
# fallocate a big file, or use stress-ng --hdd

# Clock
chronyc makestep          # only on a test host
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Experiment escaped the blast radius | Wrong host, wrong interface, or no rollback | inventory, `tc qdisc show`, process list |
| No alert fired | Alert rule too strict or missing | monitoring config, test the alert path separately |
| Service never recovered after injection stopped | Missing retry or stuck state | application logs, restart |
| Production impact | Ran on the wrong environment | change ticket, limit, canary |

## Investigation Tips

- Write the hypothesis and the rollback command *before* you inject anything.
- Prefer synthetic checks or a single canary host over the whole tier.
- Capture metrics and logs during the experiment; the point is the evidence, not the drama.
- Stop the injection the moment you have the data or the moment user impact appears.
- Afterward, turn the finding into a ticket (missing alert, missing retry, missing runbook step).

## Related Notes

- [[Incident Management]]
- [[On-Call Practices]]
- [[Troubleshooting Methodology]]
- [[High Availability]]

## Personal Lessons Learned

- A "redundant" database failover had never been tested. Killing the primary in staging showed the replica promotion script still had a hard-coded IP. The chaos experiment was cheaper than the real failover would have been.
- I once left a `tc netem` rule in place after the test. The latency stayed until the next reboot. The rollback command is now the first line of the experiment notes.
