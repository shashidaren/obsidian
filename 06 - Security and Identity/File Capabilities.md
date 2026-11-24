# File Capabilities

## Concept

File capabilities (`setcap` / `getcap`) let a binary gain specific Linux capabilities when it is executed, without being setuid-root. The capability is stored in the file’s extended attributes (`security.capability`).

They are evaluated at exec time and combined with the process’s inheritable and ambient sets. A file cap of `cap_net_bind_service=ep` lets an unprivileged binary bind to port 80.

## Why it matters

- Services that only need to bind a low port or open raw sockets should not run as root. File capabilities (or systemd `AmbientCapabilities=`) are the correct fix.
- Package managers often strip or ignore file capabilities on upgrade. A binary that worked after manual `setcap` fails after the next `dnf update` or `apt upgrade`.
- File capabilities are ignored when `NoNewPrivileges` is set or when the bounding set does not allow the cap. The binary can have the xattr and still fail.

## Mental Model

```
Binary with security.capability xattr
    → on exec, kernel grants the listed caps into permitted/effective
         (subject to bounding set, NoNewPrivs, and MAC)

Prefer systemd AmbientCapabilities= for long-running services.
Use file caps for short-lived helpers that are not under systemd.
```

## Key Commands

```bash
# Inspect
getcap /usr/bin/ping /usr/sbin/arping /usr/local/bin/mytool
getfattr -n security.capability /usr/bin/ping

# Grant (usually not permanent)
setcap cap_net_bind_service=ep /usr/local/bin/mybind
setcap -r /usr/local/bin/mybind          # remove

# Decode process view
grep Cap /proc/<pid>/status
capsh --decode=$(awk '/CapEff/{print $2}' /proc/<pid>/status)
```

Common flags:

- `e` — effective (turned on immediately)
- `p` — permitted
- `i` — inheritable

`=ep` is the usual setting for a helper that needs the right now.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Binary used to work, fails after package update | File cap stripped by packaging | `getcap` after update |
| `setcap` succeeds, binary still fails | Bounding set or NoNewPrivs | `/proc/PID/status`, unit file |
| Works when run by hand, fails under systemd | Unit has `NoNewPrivileges=yes` or empty AmbientCapabilities | `systemctl show` |
| Capability present, still Operation not permitted | SELinux/AppArmor denial | AVC, `ausearch`, `aa-status` |
| setuid root binary preferred by accident | File cap lost and someone added setuid | `ls -l`, `getcap` |

## Investigation Tips

- Prefer a systemd drop-in with `AmbientCapabilities=` over a manual `setcap`. The drop-in survives package updates and is visible in `systemctl cat`.
- After any package update that touches a binary you previously setcap’d, re-run `getcap`.
- `getcap -r /usr` is a quick way to see every file capability on the system during an audit.
- File capabilities do not work on scripts (the interpreter is what gets exec’d). They only work on ELF binaries.
- In containers the file cap is evaluated inside the user namespace; it may not grant the host-level right you expect.

## Related Notes

- [[Linux Capabilities]]
- [[systemd Units]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A monitoring agent had `setcap cap_net_raw=ep` applied by hand. The next RPM update replaced the binary and the capability vanished. Moving the grant into the unit’s `AmbientCapabilities=` ended the outages.
- I spent time debugging mode bits on a binary that had the correct file capability. The unit file contained `NoNewPrivileges=yes`, which silently ignored the file cap. Removing that line (or using ambient caps) fixed it.
