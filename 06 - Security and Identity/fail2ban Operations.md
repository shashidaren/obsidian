# fail2ban Operations

## Concept

fail2ban watches log files (or journal) for repeated authentication failures and temporarily bans the source IP via the firewall (nftables, iptables, firewalld, or ipset). It is a reactive control, not a substitute for strong authentication, rate limiting at the application, or network-level ACLs.

Jails define which log, which filter (regex), and which action (ban command). A ban is usually a temporary firewall rule that expires.

## Why it matters

- Stops the most common brute-force noise against SSH, mail, and web login endpoints before it fills logs or locks accounts.
- A misconfigured jail can ban your own monitoring, your jump host, or an entire NAT pool and create an outage that looks like a network failure.
- Because it parses logs, a log format change (or journal vs file) silently disables protection.
- Useful as a quick mitigation while you fix the real problem (password auth still enabled, weak app, missing MFA).

## Mental Model

```
Log line matches filter regex
  → fail2ban increments failure count for that IP
  → threshold reached → action (usually nft/iptables ban)
  → ban time expires → unban

Components:
  filter.d/*.conf   regexes
  jail.local        enabled jails, thresholds, actions
  action.d/*.conf   how to ban (nftables, firewalld, etc.)
```

The ban is only as good as the log source. If rsyslog or journald is dropping lines, fail2ban never sees the failures.

## Key Commands

```bash
# Status
fail2ban-client status
fail2ban-client status sshd

# Manual ban / unban (incident)
fail2ban-client set sshd banip 192.0.2.1
fail2ban-client set sshd unbanip 192.0.2.1

# Reload after config change
fail2ban-client reload
systemctl reload fail2ban

# Test a filter against a log line
fail2ban-regex /var/log/secure /etc/fail2ban/filter.d/sshd.conf

# What is actually banned right now
fail2ban-client get sshd banip
nft list ruleset | grep -A5 fail2ban   # or iptables -L -n
```

Typical jail snippet (`/etc/fail2ban/jail.local`):

```
[sshd]
enabled = true
port = ssh
maxretry = 5
findtime = 10m
bantime = 1h
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No bans despite failures | Wrong log path, journal vs file, filter regex drift | `fail2ban-regex`, jail status, log location |
| Legitimate users banned | Shared NAT, aggressive maxretry, monitoring probes | `fail2ban-client status`, unban, ignoreip |
| Ban action fails | firewalld/nftables backend mismatch | action logs, `fail2ban-client status` |
| fail2ban itself banned | it logged a failure from its own IP | ignoreip, careful testing |
| High CPU / log spam | very chatty jail or debug mode | journalctl -u fail2ban, log level |
| Bans disappear on restart | bantime not persistent (by design) | expected; use ipset or permanent rules for critical |

## Investigation Tips

- `fail2ban-client status <jail>` shows currently banned IPs and the number of failures. Start there.
- Always test filter changes with `fail2ban-regex` against a real log sample before reloading in production.
- Set `ignoreip` for your jump hosts, monitoring, and office NAT ranges *before* you enable a jail. Discovering the ignore list after you have banned yourself is painful.
- Confirm the action backend matches the firewall you actually run. A jail configured for iptables on an nftables-only host will log errors and ban nothing.
- Log rotation or a switch from file to journal without updating the jail silently disables the jail. Check the log path after any logging change.
- fail2ban is a backstop. If you are banning thousands of IPs, the real fix is to disable password authentication, add MFA, or rate-limit at the load balancer.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[firewalld Deep Dive]]
- [[nftables Deep Dive]]
- [[Auditing]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Enabled an SSH jail with `maxretry = 3` and no ignoreip. The office NAT and the monitoring probe were banned within an hour. The “network outage” was fail2ban. ignoreip is now mandatory in every jail.local I ship.
- A distro upgrade changed the sshd log format slightly. The filter stopped matching. `fail2ban-regex` against a fresh failure line would have caught it in testing; we noticed only when the brute-force volume returned.
- I have used a short manual ban (`fail2ban-client set ... banip`) as a temporary mitigation while the application team fixed an exposed login endpoint. Document the ban and the expiry so the next person does not treat it as a permanent firewall rule.
