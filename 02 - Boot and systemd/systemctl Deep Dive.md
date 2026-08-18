# systemctl Deep Dive

## Concept

`systemctl` is the main interface for controlling systemd.  
It manages units (services, sockets, timers, mounts, targets, etc.), shows their state, and lets you start/stop/restart/enable them.

## Why it matters

Almost every modern Linux service is a systemd unit.  
Understanding how to inspect state, dependencies, and failure reasons is essential for day-to-day operations and incident response.

## Mental Model

```
systemctl status <unit>     → current state + recent logs
systemctl cat <unit>        → effective unit file content
systemctl show <unit>       → all properties
systemctl list-dependencies → what it needs / what needs it
```

## Key Commands

```bash
# Overview of failed units
systemctl --failed

# Status of a service (most used command)
systemctl status <service>

# Detailed properties
systemctl show <service> | grep -E 'ActiveState|SubState|MainPID|FragmentPath|DropInPaths'

# Effective configuration (after drop-ins)
systemctl cat <service>

# Dependencies
systemctl list-dependencies <service>
systemctl list-dependencies --reverse <service>

# Enable / disable (start at boot)
systemctl enable <service>
systemctl disable <service>

# Restart / reload
systemctl restart <service>
systemctl reload <service>          # if supported
systemctl try-restart <service>     # only if already running
```

### Useful listing commands

```bash
systemctl list-units --type=service --state=running
systemctl list-unit-files --type=service
systemctl list-timers
```

## Common Failure Modes & Symptoms

| Symptom                          | First commands to run                     |
|----------------------------------|-------------------------------------------|
| Service won’t start              | `systemctl status`, `journalctl -u`       |
| Service starts then dies         | `journalctl -u <service> -b`, look for exit code |
| Changes not taking effect        | `systemctl cat` (check drop-ins), daemon-reload |
| Unit not found                   | Check spelling, `systemctl list-unit-files` |
| Dependency loop or ordering issue| `systemctl list-dependencies`             |

## Investigation Tips

- After any unit file change: `systemctl daemon-reload`.
- Prefer `systemctl status` + `journalctl -u <service> -b` over just restarting repeatedly.
- Drop-in files (`*.conf` under `/etc/systemd/system/<unit>.d/`) override the main unit — always check `systemctl cat`.
- Exit codes and “status=” lines in the journal are often the fastest path to root cause.

## Related Notes

- [[journalctl Deep Dive]]
- [[systemd Units]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
