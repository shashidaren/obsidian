# Auditing

## Concept

The Linux Audit subsystem is a kernel hook plus `auditd` that records security-relevant events: logins, privilege changes, selected syscalls, and file watches. It is built for evidence, not for interactive debugging. `journald` tells you a service died; audit tells you *which uid executed what* against *which inode*.

Rules decide what is recorded. Without rules you get a thin stream of auth and SELinux AVC events. With careless rules you get a second copy of every `openat` on the machine and a full disk.

## Why it matters

- After a breach or an insider change, “who touched `/etc/shadow`?” is an audit question. Application logs will not save you.
- Compliance regimes (CIS, PCI, many SOC2 evidence requests) expect auditd running, rules loaded, and logs retained off-box.
- AVC denials from SELinux land here (`ausearch -m avc`). If auditd is down, you lose that trail too.
- Over-broad `execve` logging has taken production boxes to their knees. Tuning is part of the job, not optional polish.

## Mental Model

```
syscall / inode watch / login
        → kernel audit netlink
        → auditd
        → /var/log/audit/audit.log
        → (optional) audisp plugin → syslog / SIEM

Rule types:
  -a / -A     syscall rules   (always,exit + filters)
  -w          watch a file or directory (perms r/w/x/a)
  -e / -r / -b  control: enable, rate, backlog

Keys (-k name) are how you find the needle later.
```

Persistence on RHEL-like systems:

- Drop files in `/etc/audit/rules.d/*.rules`
- `augenrules --load` compiles them into `/etc/audit/audit.rules`
- `auditctl -l` is the live set; if it disagrees with rules.d, the last load failed or someone changed the live set

Immutable mode (`-e 2`) freezes rules until reboot. Useful on hardened gold images; painful when you are still iterating.

## Key Commands

```bash
# Is it actually running and accepting events?
systemctl status auditd
auditctl -s                 # enabled, backlog, lost, rate_limit
pidof auditd

# Live rules vs on-disk
auditctl -l
ls -l /etc/audit/rules.d/
cat /etc/audit/audit.rules

# Search by time, type, actor, object
ausearch -ts recent
ausearch -ts today -i       # interpret uids/syscalls
ausearch -m USER_AUTH,USER_LOGIN,USER_START -i
ausearch -m SYSCALL -sc execve -ts today -i
ausearch -f /etc/passwd -i
ausearch -ua 1000 -i        # uid
ausearch -x /usr/bin/sudo -i
ausearch -k identity -i     # by rule key
ausearch -m avc -ts recent -i

# Summaries when you do not know the type yet
aureport
aureport -l                 # logins
aureport -au                # auth attempts
aureport -f                 # files
aureport -x                 # executables
aureport --failed           # failed events only

# Watch rules (examples — load via rules.d, not as one-offs in prod)
auditctl -w /etc/passwd -p wa -k identity
auditctl -w /etc/shadow -p wa -k identity
auditctl -w /etc/sudoers -p wa -k identity
auditctl -w /etc/ssh/sshd_config -p wa -k sshd_cfg

# Syscall rule example: execve by uid >= 1000
# -a always,exit -F arch=b64 -S execve -F auid>=1000 -F auid!=4294967295 -k user_exec

# Persist after editing rules.d
augenrules --load
auditctl -l | wc -l

# Lost events and log health
grep -i lost /var/log/audit/audit.log | tail
ls -lh /var/log/audit/
```

`auid=4294967295` (or `-1`) means “no login uid” — typically daemons. Filter it out of user-exec rules or you log every systemd unit start.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| `auditd` inactive | Disabled after a “performance” change | `systemctl status auditd`; why-disabled |
| `ausearch` empty for an action you just took | Rule not loaded, or wrong `-m` / time window | `auditctl -l`; try `-ts recent` without filters |
| `/var` filling | Broad syscall rules, no rotation, or flood | `ls -lh /var/log/audit`; `aureport`; `auditctl -s` |
| `lost=` climbing in `auditctl -s` | Backlog too small or disk too slow | Raise backlog, narrow rules, check disk await |
| Rules vanish after reboot | Edited live with `auditctl`, never wrote rules.d | Diff `auditctl -l` vs `/etc/audit/rules.d` |
| Cannot change rules | `-e 2` immutable until reboot | `auditctl -s`; schedule a window |
| SELinux denials “not in the log” | Searching journal only, or auditd down | `ausearch -m avc -ts recent` |
| Flood of `execve` from containers | Logged container runtimes / healthchecks | Exclude by `auid`, path, or cgroup |

## Investigation Tips

- Start from a time window and a key, not from `ausearch` with no filters on a 2 GiB log.
- Reproduce once with a unique key if you are writing a new rule. Confirm the event exists, then persist the rule.
- Prefer watches on sensitive paths (`/etc/passwd`, sudoers, sshd_config, cron drops, authorized_keys) over global `execve`. Add syscall rules for a specific uid or executable when a watch is not enough.
- Watch `lost` in `auditctl -s`. Silent drops mean you do not have the evidence you think you have.
- Ship `/var/log/audit/audit.log` off-box. An attacker who gets root will truncate it. `audisp` / a forwarder is part of the design, not an extra.
- Correlate with `journalctl` auth and with `last`/`lastb`. Audit is one column of the timeline.
- CIS-style rule packs are a starting point. Load them in staging and measure `lost`, disk rate, and syscall latency before production.
- For containers, decide whether you audit the *host* runtime or go through the orchestrator’s audit log. Double-logging everything is how boxes melt.

## Related Notes

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

- A “who changed sshd_config?” incident had nothing in `journalctl` except the restart. The watch rule on that file had been removed during a hardening sprint because “audit was noisy”. Restoring one `-w` line would have named the uid and the exact write.
- Enabling a copied-and-pasted `execve` rule on a busy CI runner filled `/var` in an afternoon and dropped thousands of events. `auditctl -s` showed `lost` climbing the whole time. Keys plus `auid` filters, then a SIEM shipper, then we talked about exec logging again.
- People kept using `ausearch -m avc` against a host where `auditd` had failed after a full disk. SELinux was still enforcing; we just had no record. `systemctl is-active auditd` is part of the SELinux playbook, not a separate ritual.
