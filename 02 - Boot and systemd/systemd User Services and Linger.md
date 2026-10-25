# systemd User Services and Linger

## Concept

systemd can run a per-user instance (`user@UID.service`) that manages units in the user's slice. By default that instance starts at login and stops at logout. `loginctl enable-linger USER` keeps the user manager running after logout so user timers, user services, and lingering sockets survive.

Cron-like jobs, user-level daemons, and "it works when I am logged in" failures are usually missing linger or a unit that lives only in the user session.

## Why it matters

- A user timer or service that "stops when I log out" is working as designed until you enable linger.
- `systemctl --user` fails or shows nothing if the user manager is not running.
- Lingering user services still need the right `User=` / home / environment. They do not magically get a full login session.
- On servers, lingering a human account for a long-running process is common; lingering root is unnecessary (system units are better).

## Mental Model

```
login → user@UID.service starts → user units in ~/.config/systemd/user/
logout (no linger) → user manager stops → user units stop

loginctl enable-linger USER
  → /var/lib/systemd/linger/USER created
  → user manager starts at boot and stays up

user units:
  systemctl --user status my.service
  systemctl --user enable --now my.timer

system units (preferred for daemons):
  systemctl status my.service   # no --user
```

## Key Commands

```bash
# Is the user manager running?
loginctl show-user USER
loginctl user-status USER

# Linger state
loginctl show-user USER -p Linger
ls /var/lib/systemd/linger/

# Enable / disable
loginctl enable-linger USER
loginctl disable-linger USER

# User units (as that user, or with --user and XDG_RUNTIME_DIR)
systemctl --user status
systemctl --user list-timers
journalctl --user -u my.service

# From root, for a specific user
systemctl --user -M USER@ status
# or
sudo -u USER XDG_RUNTIME_DIR=/run/user/$(id -u USER) systemctl --user status
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| User timer/service dies on logout | no linger | `loginctl show-user -p Linger` |
| `systemctl --user` says "Failed to connect to bus" | user manager not running | linger, or start a login |
| Works in SSH session, fails from cron/systemd | environment / WorkingDirectory / path | unit file, `journalctl --user` |
| Linger enabled but unit still stops | unit itself has `StopWhenUnneeded` or failed | `systemctl --user status` |
| After reboot, user service never starts | linger file missing or unit not enabled | `/var/lib/systemd/linger`, enable |

## Investigation Tips

- `loginctl show-user USER -p Linger` is the first check for "it stops when I log out".
- Prefer a system unit with `User=` for anything that must survive reboot and not depend on a human login. User units + linger are for per-user state.
- User journal is separate: `journalctl --user` or `journalctl -M USER@`.
- `XDG_RUNTIME_DIR` must be set for many user-bus operations. The linger path creates it at `/run/user/UID`.
- Do not linger accounts that should not run code after logout (shared lab accounts, etc.).

## Related Notes

- [[systemctl Deep Dive]]
- [[systemd Units]]
- [[systemd Timers]]
- [[cron and anacron]]
- [[journalctl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A developer's "backup timer" only ran while they had an SSH session open. Linger was off. One `loginctl enable-linger` and an enable of the user timer fixed it; we later moved it to a system unit.
- `systemctl --user` from a sudo shell without the runtime dir produced a confusing bus error. Checking linger and `/run/user/UID` first saves time.
