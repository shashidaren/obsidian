# systemd Timers

## Concept

A systemd timer is a unit that activates another unit (almost always a `.service`) on a calendar schedule or after a monotonic delay. It is the supported replacement for most cron jobs on systemd hosts: same dependency graph, same journal, same `systemctl` workflow.

The timer does not run your command. The paired service does.

## Why it matters

- “Cron did not run” tickets on modern images are often a timer that never got `enable --now`
- Failures land in `journalctl -u the.service`, not in a mailed cron body you will never see
- `Persistent=true` catches up after downtime; without it, a missed window is just gone
- Randomised delay (`RandomizedDelaySec`) is how you stop a fleet from thundering the same NFS share at 00:00

If you only look at crontab you will miss half the scheduled work on a current RHEL/Ubuntu server.

## Mental Model

```
foo.timer     →  wakes systemd
                  → starts foo.service  (Type=oneshot typically)
                       → ExecStart= runs once
                       → result logged on foo.service, not the timer

OnCalendar=  wall-clock (like cron, understands timezones)
OnBootSec= / OnUnitActiveSec= / OnUnitInactiveSec=   monotonic
Persistent=true  → run once if the last window was missed while down
```

Two files. Name them together. Putting `ExecStart=` on the timer unit does nothing useful.

`systemctl list-timers` is the crontab `-l` equivalent. `LAST` / `PASSED` / `NEXT` tell you whether the problem is “never armed”, “ran and failed”, or “not due yet”.

## Key Commands

```bash
# What is scheduled, and when did it last fire?
systemctl list-timers --all
systemctl list-timers --all --no-pager

# Status of both halves
systemctl status backup.timer backup.service --no-pager
systemctl cat backup.timer backup.service

# Arm it (timer enabled ≠ service enabled)
systemctl enable --now backup.timer

# Fire immediately without waiting for the calendar
systemctl start backup.service

# Logs — the service, not the timer
journalctl -u backup.service -n 100 --no-pager
journalctl -u backup.timer -n 20 --no-pager

# Calendar sanity check before you install the unit
systemd-analyze calendar '*-*-* 02:30:00'
systemd-analyze calendar 'Mon..Fri 09:00'

# Next elapse while iterating on a drop-in
systemctl show backup.timer -p LastTriggerUSec,NextElapseUSecRealtime,Persistent

# After any unit-file edit
systemctl daemon-reload
systemctl restart backup.timer
```

Minimal pair:

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Nightly backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/backup.service
[Unit]
Description=Nightly backup

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
```

Do not put `[Install] WantedBy=multi-user.target` on the oneshot service unless you also want it at every boot. The timer is what you enable.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Timer never listed as NEXT | Not enabled, or wrong `WantedBy` | `list-timers --all`, `is-enabled backup.timer` |
| LAST empty after days up | Never triggered; calendar in the past-only sense, or inactive | `systemd-analyze calendar`, `status` |
| LAST updates, work did not happen | You are reading the timer journal | `journalctl -u backup.service` |
| Service `inactive (dead)` right now | Normal for oneshot between runs | Look at result of last run, not current ActiveState |
| Missed run after patch reboot | `Persistent=` left at default false | Add `Persistent=true` |
| Fleet spike at midnight | No `RandomizedDelaySec` | Add delay; consider `AccuracySec=` |
| Works with `start`, not on timer | `OnCalendar` TZ vs UTC, or `WakeSystem` | `timedatectl`; calendar analysis |
| `start-limit` / failed too fast | Service failing in a loop, or `OnUnitInactiveSec` too small | `systemctl show` start-limit properties |
| Still seeing cron behaviour | Both cron *and* a timer fire the same script | `crontab -l`, `/etc/cron.*`, `list-timers` |

## Investigation Tips

- Always inspect the **service** result. `backup.timer` being `active (waiting)` is healthy. Failure is `backup.service` `result=exit-code`.
- `systemctl list-timers --all` includes disabled timers. If NEXT is `n/a`, it is not armed.
- Calendar expressions are not cron. `OnCalendar=daily` is 00:00:00 *in the system timezone*. Confirm with `systemd-analyze calendar` and `timedatectl`.
- For jobs that must not overlap, set `RefuseManualStart=no` as you like but add `ExecStart=` locking in the script, or `RuntimeMaxSec=` plus a unit `Conflict`. Timers will happily start a second service if the last one is still running unless you prevent it (`RefuseManualStart` will not save you).
- Use `Type=oneshot` and a non-zero `ExecStart` exit code so failure is visible in `systemctl --failed` after the run.
- Drop-ins: `systemctl edit backup.timer` to change the schedule without touching the vendor unit. Then `daemon-reload` and `restart backup.timer`.
- Migrating off cron: keep cron disabled for that job *before* enabling the timer, or you double-run. Check `/etc/cron.d`, user crontabs, and anacron.

## Related Notes

- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[journalctl Deep Dive]]
- [[Change Management]]
- [[Backup Strategy]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have spent longer than I will admit staring at a green timer while the oneshot was `status=1/FAILURE` five hours earlier. `list-timers` shows LAST, not result. Pair it with `systemctl status foo.service` every time.
- `Persistent=true` without an idempotent script will replay a missed window and double-apply a change after a long outage. The timer is doing its job; the script has to tolerate it.
- Fleet-wide `OnCalendar=*-*-* 00:00:00` is a self-inflicted load test. `RandomizedDelaySec=30m` is cheaper than scaling the backup target.
