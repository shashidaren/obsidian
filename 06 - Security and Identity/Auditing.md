# Auditing

## Concept

Linux Auditing (auditd + kernel audit subsystem) records security-relevant events according to a set of rules: file access, syscalls, login attempts, privilege escalation, and more. It is the primary source of “who did what, when” evidence on a host.

## Why it matters

- Required for many compliance regimes (PCI, SOC2, CIS, etc.)
- Invaluable for incident response and forensics after a breach or insider event
- Can answer “who deleted this file?” or “who ran this command as root?” when logs alone are insufficient
- Poorly tuned rules create huge volumes of noise and can impact performance

Good audit design balances evidence needs against storage, performance, and signal-to-noise.

## Mental Model

```
Kernel audit hooks → auditd → /var/log/audit/audit.log
                              (or syslog / remote)

Rules decide what is recorded:
- Watch rules  → file/directory access
- Syscall rules → specific syscalls by uid/gid/exe
- Control rules → backlog, rate limit, failure mode

Key tools:
  auditctl   → live rule management
  ausearch   → search the log
  aureport   → summary reports
  audit2allow / sealert → (SELinux integration)
```

Rules are usually loaded from `/etc/audit/rules.d/` and made permanent via `augenrules`.

## Key Commands

```bash
# Service and status
systemctl status auditd
auditctl -s                    # status, enabled, backlog, etc.

# List current rules
auditctl -l

# Search recent events
ausearch -ts recent
ausearch -ts today
ausearch -m USER_LOGIN
ausearch -m SYSCALL -sc openat
ausearch -f /etc/passwd        # file watches
ausearch -ua 1000              # by uid
ausearch -x /usr/bin/sudo

# Human-readable reports
aureport
aureport -l                    # login reports
aureport -f                    # file access
aureport -x                    # executables

# Common rule examples (add carefully)
auditctl -w /etc/passwd -p wa -k identity
auditctl -w /etc/shadow -p wa -k identity
auditctl -a always,exit -F arch=b64 -S execve -k exec_log

# Make rules persistent (RHEL-like)
# edit files under /etc/audit/rules.d/
augenrules --load

# Rotate / check log size
ls -lh /var/log/audit/
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| auditd not running                   | Service disabled / failed to start         | `systemctl status auditd`, journal                |
| No events for expected actions       | Rules not loaded or too narrow             | `auditctl -l`, rule files in rules.d              |
| Disk filling with audit.log          | Overly broad rules / no rotation           | Log size, `aureport`, rate limits                 |
| Backlog / dropped events             | High rate + small backlog                  | `auditctl -s`, increase backlog, tune rules       |
| “Permission denied” on ausearch      | Not root / not in audit group              | Run as root                                       |
| SELinux denials not appearing        | auditd not capturing AVC or wrong search   | `ausearch -m avc`                                 |

## Investigation Tips

- Start with `ausearch -ts recent` or a time window around the incident; broad searches are slow on large logs.
- Use keys (`-k`) in rules so you can search by meaningful labels later.
- Prefer watching specific sensitive paths over logging every syscall.
- On busy systems, monitor backlog and dropped events; silent drops defeat the purpose of auditing.
- Correlate audit events with auth logs (`/var/log/secure` or `auth.log`) and process accounting if available.
- For compliance, document which rules map to which control requirements and test them periodically.

## Related Notes

- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[PAM]]
- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
