# Auditd Deep Dive

## Concept

auditd is the userspace daemon that receives events from the kernel audit subsystem and writes them to `/var/log/audit/audit.log`. Rules (watches and syscall filters) decide what is recorded. Without rules you get a thin stream of auth and AVC events. With careless rules you get a second copy of every open and a full disk.

It is built for evidence after the fact, not for interactive debugging.

## Why it matters

- "Who changed sshd_config?" is an audit question. Application logs and journalctl will not name the uid and the exact write.
- Compliance packs expect auditd running, rules loaded, and the log shipped off-box.
- SELinux AVC denials land here. If auditd is down you lose that trail too.
- Over-broad execve rules have filled disks and dropped events (`lost=` climbing) on production boxes.

## Mental Model

```
syscall / inode watch / login
    → kernel audit netlink
        → auditd
            → /var/log/audit/audit.log
                → (optional) audisp → syslog / SIEM

-w path -p wa -k key     file watch
-a always,exit -S execve -F auid>=1000 -k user_exec
auditctl -s              enabled, backlog, lost, rate
```

Persistence: files in `/etc/audit/rules.d/*.rules`, then `augenrules --load`. Live `auditctl -l` must match what you think is loaded.

## Key Commands

```bash
systemctl status auditd --no-pager
auditctl -s                          # enabled, lost, backlog
auditctl -l                          # live rules
ls /etc/audit/rules.d/

ausearch -ts recent -i
ausearch -ts today -k identity -i
ausearch -f /etc/passwd -i
ausearch -m avc -ts recent -i
ausearch -ua 1000 -i
ausearch -x /usr/bin/sudo -i

aureport
aureport -l                          # logins
aureport --failed

# After editing rules.d
augenrules --load
auditctl -l | wc -l

grep -i lost /var/log/audit/audit.log | tail
ls -lh /var/log/audit/
```

`auid=4294967295` means no login uid (usually daemons). Filter it out of user-exec rules.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| ausearch empty for an action you just took | Rule not loaded or wrong time window | auditctl -l; try -ts recent with no filters |
| /var filling | Broad syscall rules, no rotation | ls -lh audit.log; auditctl -s |
| lost= climbing | Backlog too small or disk slow | auditctl -s; narrow rules |
| Rules vanish after reboot | Edited live with auditctl, never wrote rules.d | diff auditctl -l vs rules.d |
| Cannot change rules | -e 2 immutable until reboot | auditctl -s |
| SELinux denials "not in the log" | Searching journal only, or auditd down | ausearch -m avc; systemctl is-active auditd |
| Flood from containers | Logged every healthcheck exec | exclude by auid, path, or cgroup |

## Investigation Tips

- Start from a time window and a key. Unfiltered ausearch on a multi-gigabyte log is how you waste the first ten minutes.
- Prefer watches on sensitive paths (`/etc/passwd`, sudoers, sshd_config, authorized_keys, cron drops) over global execve.
- Watch the `lost` counter. Silent drops mean you do not have the evidence you think you have.
- Ship the log off-box. An attacker who gets root will truncate it.
- Correlate with journalctl auth and with last/lastb. Audit is one column of the timeline.
- Load CIS-style packs in staging first. Measure lost, disk rate, and syscall latency before production.
- For containers, decide whether you audit the host runtime or the orchestrator. Double-logging everything is how boxes melt.

## Related Notes

- [[Auditing]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[PAM]]
- [[sudo]]
- [[SSH Hardening and Troubleshooting]]
- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[Incident Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- "Who changed sshd_config?" had nothing useful in journalctl except the restart. The watch rule had been removed because "audit was noisy". One -w line would have named the uid.
- A copied execve rule on a busy CI runner filled /var in an afternoon and lost thousands of events. auditctl -s showed lost climbing the whole time. Keys plus auid filters, then a shipper.
- People kept running ausearch -m avc on a host where auditd had failed after a full disk. SELinux was still enforcing; we just had no record. systemctl is-active auditd belongs in the SELinux playbook.
