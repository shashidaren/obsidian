# systemd-logind

## Concept

systemd-logind tracks user sessions, seats, and the devices those sessions are allowed to touch. It is the reason a local user can access `/dev/input` or suspend the machine, and the reason a remote SSH session does not automatically get a full graphical seat.

It also handles inhibit locks (so a backup can block shutdown), lid-switch actions, and the lingering of user units.

## Why it matters

- “Permission denied” on a device node that looks world-accessible is often logind’s ACL, not Unix mode.
- A service that must survive logout needs `loginctl enable-linger` or a system unit; a user unit dies when the session ends.
- Inhibited shutdowns look like “systemctl poweroff hangs”. The inhibitor is usually a user session or a process that took a lock.
- Multi-seat and remote-desktop setups break when logind’s idea of the seat disagrees with udev.

## Mental Model

```
login (getty, ssh, display manager)
  → PAM creates a session
      → logind assigns a session ID and a seat (or none)
          → udev tags devices with the seat
              → logind applies ACLs so the session owner can open them

User lingering:
  loginctl enable-linger user
    → user@UID.service stays up after logout
        → user units (timers, sockets) keep running
```

`loginctl` is the inspection tool. `systemctl --user` is what runs inside the session.

## Key Commands

```bash
# Who is logged in, and on which seat
loginctl
loginctl list-sessions
loginctl session-status <id>
loginctl user-status <user>

# Inhibitors blocking shutdown / sleep
loginctl list-inhibitors
systemd-inhibit --list

# Linger (user units survive logout)
loginctl enable-linger <user>
loginctl disable-linger <user>
loginctl show-user <user> -p Linger

# Force actions (incident)
loginctl terminate-session <id>
loginctl kill-session <id>
systemctl poweroff          # still respects inhibitors unless --force
```

Session types: tty, x11, wayland, unspecified (typical SSH).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Local user cannot open `/dev/video0` or input | Session not on the seat, or ACL missing | `loginctl session-status`, `getfacl` on the device |
| `systemctl poweroff` hangs | Inhibitor (backup, user session, lid) | `loginctl list-inhibitors` |
| User timer dies after SSH logout | No linger, and the unit is a user unit | `loginctl show-user`, `systemctl --user` |
| Graphical session has no sound / no devices | logind not running or seat mis-tagged | `systemctl status systemd-logind`, udev |
| Remote desktop user sees “not authorized” | Polkit + logind seat rules | journal for polkit, session type |
| Multiple seats fight over one GPU | udev seat tags wrong | `loginctl seat-status`, udev rules |

## Investigation Tips

- `loginctl` first when a device permission looks wrong for an interactive user. Unix mode 0660 root:video is not the whole story if an ACL is present.
- Inhibitors are deliberate. `systemd-inhibit` in a backup script is correct; forgetting to release it is the bug. List them before you `--force` a shutdown.
- Linger is per-user and survives reboot. It is the supported way to keep a user-level timer or socket running. A system unit is usually cleaner for anything that must be highly available.
- SSH sessions are normally type “unspecified” and do not get a seat. That is why they cannot suspend the machine or open local input devices. Do not “fix” that by forcing a seat unless you understand the security consequence.
- After a display-manager crash, stale sessions can linger. `loginctl terminate-session` cleans them; a reboot also does.

## Related Notes

- [[systemd User Services and Linger]]
- [[systemd Units]]
- [[PAM]]
- [[Users Groups and Permissions]]
- [[udev and Kernel Modules]]
- [[systemctl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A nightly backup used `systemd-inhibit` and never exited on error. Morning poweroff windows failed until someone ran `loginctl list-inhibitors` and killed the stale process.
- An engineer enabled linger for a monitoring agent so its user timer would survive logout. The agent then ran as that user forever, including after the account was locked. We moved it to a system unit.
- “Cannot open microphone” on a local console was a seat that logind never assigned because the display manager had crashed and left a zombie session. Terminating the old session fixed the ACL.
