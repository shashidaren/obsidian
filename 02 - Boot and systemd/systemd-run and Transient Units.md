# systemd-run and Transient Units

## Concept

`systemd-run` creates a transient unit — a unit that exists only in memory and disappears when it finishes or the system reboots. It is the supported way to start a command under systemd's resource controls, cgroup, security sandbox, or timer without writing a unit file.

Transient units appear in `systemctl list-units` with a runtime path under `/run/systemd/transient/`. They are not persisted to `/etc` or `/usr`.

## Why it matters

- Quick tests of `LimitNOFILE`, `CPUQuota`, `MemoryMax`, or `PrivateTmp` without a permanent drop-in
- Running a one-shot under the same cgroup hierarchy as production services (so PSI, accounting, and oomd see it)
- Avoiding the "I ran it from SSH so it inherited my ulimits and environment" debugging trap
- Temporary timers for incident response without polluting `/etc/systemd/system`
- Scope units (`--scope`) let you move an already-running process into a managed cgroup

## Mental Model

```
systemd-run [options] -- command args
    → creates a transient .service (or .timer / .scope)
    → unit lives in /run/systemd/transient/
    → starts immediately (or on the timer)
    → vanishes on stop/finish unless --remain-after-exit

--scope     attach to an existing process tree (no new ExecStart)
--timer     also create a transient timer that starts the service
--property  any unit setting (LimitNOFILE=, MemoryMax=, etc.)
```

The transient unit still goes through the normal job engine, so `systemctl status`, `journalctl -u`, and cgroup accounting all work. It does not go through PAM, so `limits.conf` is irrelevant — set `LimitNOFILE=` explicitly.

## Key Commands

```bash
# One-shot under resource limits
systemd-run --unit=test-limits --property=LimitNOFILE=65535 \
  --property=MemoryMax=512M -- bash -c 'ulimit -n; cat /proc/self/limits'

# Scope an existing PID (useful for ad-hoc workers)
systemd-run --scope --unit=adhoc-worker --property=CPUQuota=50% \
  --pid=$(pidof myworker)

# Transient timer
systemd-run --on-active=30s --timer-property=AccuracySec=1s \
  --unit=incident-check -- /usr/local/bin/check.sh

# Inspect
systemctl status test-limits
systemctl show test-limits -p LimitNOFILE -p MemoryMax
ls /run/systemd/transient/
journalctl -u test-limits --no-pager

# Clean up (they disappear on finish, but force if needed)
systemctl stop test-limits
```

`systemd-run --user` creates a user transient unit. It still requires the user instance to be running (`loginctl enable-linger` if you need it after logout).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Transient unit vanishes before you can inspect | Normal for oneshot | `--remain-after-exit`, `journalctl -u` |
| Limits not applied | Property syntax or user vs system | `systemctl show -p LimitNOFILE` |
| Scope fails "Unit is not active" | PID already in a non-delegated cgroup | `cat /proc/PID/cgroup`, Delegate= |
| Timer never fires | Transient timer stopped with the service | `systemctl list-timers`, `--on-active` vs `--on-calendar` |
| Permission denied on property | User instance cannot set system properties | run as root or check polkit |
| Unit name collision | Previous transient still registered | `systemctl reset-failed`, unique `--unit=` |
| Environment empty | No PAM, no user session | `--setenv=`, or `Environment=` property |

## Investigation Tips

- Always give an explicit `--unit=` name. The auto-generated `run-xxxxx.service` is hard to find in logs later.
- `systemctl show <unit> -p` is the source of truth for what was applied. The command line you typed is not.
- Transient units survive `daemon-reload` but not reboot. Do not rely on them for anything that must come back.
- For cgroup experiments, prefer `--scope` on a long-running process over a oneshot that exits before you can measure.
- User transient units are invisible to `systemctl` without `--user`. On-call engineers often look in the wrong manager.

## Related Notes

- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[sysctl and Resource Limits]]
- [[Namespaces and cgroups]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We needed to confirm whether a "too many open files" was the unit limit or the binary calling `setrlimit`. `systemd-run --property=LimitNOFILE=1024 -- /path/to/binary` reproduced it in 30 seconds without touching the production unit.
- A transient timer created during an incident was left running and fired again the next day because nobody stopped the timer unit. Always `systemctl stop` both the service and the timer, or use a oneshot that does not linger.
