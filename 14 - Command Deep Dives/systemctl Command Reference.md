# systemctl Command Reference

## Concept

This is the day-to-day cheat sheet for `systemctl`: inspect state, find why a unit failed, apply drop-ins safely, and restart without guessing. Conceptual background lives in [[systemctl Deep Dive]] and [[systemd Units]].

## Why it matters

- `active (running)` is not the same as healthy. A unit can be running the wrong binary, looping crash-restart, or listening on the wrong socket.
- Most “restart it again” incidents are missing one of: `status`, `cat`, `show`, `list-dependencies`, or the journal.
- Drop-ins and `daemon-reload` mistakes are a top source of “I edited the unit and nothing changed”.

## Mental Model

```
Want to know WHAT systemd thinks?
  status  → human summary + last log lines + main PID
  show    → every property (ActiveState, Result, ExecMainStatus, ...)
  cat     → effective unit file after drop-ins

Want to know WHY it is in that state?
  journalctl -u <unit> -b
  systemctl list-dependencies [--reverse] <unit>

Want to CHANGE state?
  start / stop / restart / reload / try-reload-or-restart
  enable / disable / mask / unmask
  daemon-reload after any unit file or drop-in change
```

`enable` = start at boot (symlink into a target).  
`start` = start now.  
`mask` = make start impossible (symlink to `/dev/null`). Stronger than disable.

## Key Commands

```bash
# Failed units first — always
systemctl --failed
systemctl list-units --state=failed

# The three inspection commands you should run together
systemctl status nginx.service
systemctl cat nginx.service
systemctl show nginx.service -p ActiveState,SubState,Result,ExecMainStatus,MainPID,FragmentPath,DropInPaths,NRestarts

# Recent logs for that unit this boot
journalctl -u nginx.service -b --no-pager
journalctl -u nginx.service -o short-iso --since "10 min ago"

# Dependencies and reverse (what would stop if this dies)
systemctl list-dependencies nginx.service
systemctl list-dependencies --reverse nginx.service

# Listings
systemctl list-units --type=service --state=running
systemctl list-unit-files --type=service | grep -E 'enabled|disabled|masked'
systemctl list-timers --all
systemctl list-sockets
systemctl list-jobs          # pending start/stop jobs (stuck jobs matter)

# Lifecycle
systemctl start|stop|restart|reload nginx.service
systemctl try-restart nginx.service          # only if already active
systemctl reload-or-restart nginx.service    # reload if supported, else restart
systemctl kill -s HUP nginx.service          # send a signal to MainPID / control group

# Boot enablement
systemctl enable --now nginx.service         # enable + start
systemctl disable --now nginx.service
systemctl is-enabled nginx.service
systemctl is-active nginx.service
systemctl is-failed nginx.service

# Prevent start entirely (use sparingly; document why)
systemctl mask postfix.service
systemctl unmask postfix.service

# After editing /etc/systemd/system or a drop-in
systemctl daemon-reload
systemctl restart nginx.service

# Drop-in without touching the vendor unit
systemctl edit nginx.service                 # opens /etc/systemd/system/nginx.service.d/override.conf
systemctl edit --full nginx.service          # copy whole unit into /etc
systemctl revert nginx.service               # remove local overrides

# Default target / boot target
systemctl get-default
systemctl isolate multi-user.target          # dangerous; know what you are doing

# User units (lingering / non-root services)
systemctl --user status foo.service
loginctl enable-linger $USER                 # user units survive logout
```

Short names work (`nginx` instead of `nginx.service`) when the type is unambiguous. Prefer the full name in runbooks.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Unit not found` | Wrong name, package not installed, missing `.service` | `systemctl list-unit-files \| grep name`, `rpm -ql` / `dpkg -L` |
| `activating (auto-restart)` forever | ExecStart fails immediately; `Restart=` looping | `status`, `journalctl -u`, `Result=` / `ExecMainStatus=` |
| Edit has no effect | Forgot `daemon-reload`, edited the wrong file, drop-in ignored | `systemctl cat`, `DropInPaths` |
| `inactive (dead)` after enable | Enabled for boot but never started now | `enable --now`, or `start` |
| `masked` | Someone ran `mask` to stop a war | `is-enabled`, `ls -l /etc/systemd/system/<unit>` |
| `start-limit-hit` | Crash loop tripped StartLimitInterval | journal; reset with `systemctl reset-failed <unit>` after fixing the cause |
| Config reload did nothing | Service has no `ExecReload=` | `systemctl show -p ExecReload`; use restart if reload is unsupported |
| User unit dies on logout | No lingering | `loginctl show-user`, `enable-linger` |
| Stuck `start job running` | Dependency waiting on a mount, network, or device | `systemctl list-jobs`, `list-dependencies` |

## Investigation Tips

- Run `status`, `cat`, and `journalctl -u ... -b` before any restart. Restarting wipes a useful `Result=` / last-exit picture.
- `systemctl show` is the structured source of truth. `status` is a summary; it omits most properties.
- After a unit-file change, if `cat` still shows the old `ExecStart`, you did not `daemon-reload` (or you edited a different unit).
- `NRestarts` climbing during an incident means the unit is crash-looping, not “a bit busy”.
- `mask` is for “this must never start, even as a dependency”. Do not use it as a substitute for disable.
- Prefer drop-ins (`systemctl edit`) over copying vendor units into `/etc/systemd/system/`. Package upgrades overwrite `/usr/lib` but not your drop-in.
- On containers, `systemctl` may be a stub or talk to a different systemd. Confirm PID 1 is systemd before trusting output.

## Related Notes

- [[systemctl Deep Dive]]
- [[systemd Units]]
- [[systemd Timers]]
- [[journalctl Deep Dive]]
- [[journalctl Command Reference]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
