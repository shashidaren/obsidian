# rsyslog Deep Dive

## Concept

rsyslog is the traditional syslog daemon. It reads from the kernel, from `/dev/log`, from journald (via imjournal), and from the network, then writes to files, forwards to other hosts, or hands off to other outputs according to rules in `/etc/rsyslog.conf` and `/etc/rsyslog.d/`.

It is still the component that turns “the application called syslog()” into a line in `/var/log/messages` or a packet on the wire.

## Why it matters

- A full disk, a stopped rsyslog, or a bad include file silently drops logs. The application thinks it logged; you have nothing.
- Rate limiting (both in journald and in rsyslog) hides the exact burst you need during an incident.
- Forwarding rules that use UDP lose messages under loss; TCP or RELP is required when the remote end matters.
- A syntax error in a new `.conf` snippet prevents rsyslog from starting, which then fills the journal or loses everything.

## Mental Model

```
Input modules (imjournal, imuxsock, imudp, imtcp, imfile)
  → parser / ruleset
    → filter (facility, severity, property)
      → action (omfile, omfwd, omelasticsearch, …)

Main queue sits between input and action.
If the action is slow or down, the queue grows, then either blocks or discards.
```

## Key Commands

```bash
# Status and recent errors
systemctl status rsyslog
journalctl -u rsyslog -n 50 --no-pager

# Config test
rsyslogd -N1

# What is it writing?
ls -l /var/log/messages /var/log/secure /var/log/maillog
tail -f /var/log/messages

# Inject a test message
logger -p local0.notice -t rsyslog-test "pipeline check $(date -Is)"

# Queues and stats (if impstats is loaded)
# or just watch disk and the process
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No new lines in /var/log | rsyslog stopped or queue full | systemctl, journalctl -u rsyslog |
| Logs stop after a config change | syntax error, failed restart | rsyslogd -N1 |
| Missing messages during a burst | rate limit | journald RateLimit, rsyslog imjournal ratelimit |
| Remote logs never arrive | firewall, UDP loss, or wrong template | tcpdump 514, omfwd protocol |
| /var/log grows without bound | missing logrotate or imfile | logrotate, du -sh /var/log |
| Permissions errors on a new file | wrong FileCreateMode or owner | the action line, ls -l |

## Investigation Tips

- `logger` + immediate `tail` proves the local path. If the local file has the line and the central store does not, the problem is forwarding.
- Always run `rsyslogd -N1` before restarting after a config edit. A bad file leaves you with no syslog.
- Watch the main queue. A growing queue with a remote action down means you are about to lose messages or block local writers.
- See [[Logging Architecture]], [[journalctl Deep Dive]], and [[logrotate]]. rsyslog is one hop in that pipeline.
- imjournal + journald rate limits are the usual reason “I know the app logged it but it is not in the file”.

## Related Notes

- [[Logging Architecture]]
- [[journalctl Deep Dive]]
- [[logrotate]]
- [[journald Rate Limiting]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A new remote forwarding rule had a typo in the hostname. rsyslog started, the queue filled, and eventually local writers blocked. `journalctl -u rsyslog` showed the DNS failure; fixing the name and restarting drained the queue.
- During an incident the exact error we needed was rate-limited away. We raised the journald and rsyslog limits, reproduced, and only then saw the message. The default limits are fine until they are not.
