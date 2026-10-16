# Linux Capabilities

## Concept

Capabilities split the traditional all-or-nothing root privilege into discrete rights (CAP_NET_BIND_SERVICE, CAP_SYS_ADMIN, CAP_DAC_OVERRIDE, …). A process can hold only the rights it needs. File capabilities let an ordinary binary gain a specific right without setuid-root.

The kernel still treats capability checks as an extra gate after DAC. Dropping a capability turns “root can do anything” into “root can do only what this set allows”.

## Why it matters

- Most modern services and containers run with a reduced capability set. “Permission denied” or “Operation not permitted” under root is frequently a missing cap, not a mode-bit problem.
- Ambient and inheritable sets decide whether a child process keeps privileges after exec. Wrong ambient caps are how a helper suddenly cannot bind port 80 or open raw sockets.
- File capabilities (`setcap`) survive package upgrades only if the packaging system preserves them. A “it worked after install, failed after update” is often a lost file cap.
- SELinux/AppArmor and user namespaces further restrict what a capability actually allows. The cap can be present and still be useless.

## Mental Model

```
Process capability sets (see /proc/PID/status Cap*)
  CapEff   — effective; checked right now
  CapPrm   — permitted; can be raised into effective
  CapInh   — inheritable; passed across exec if the file also allows it
  CapBnd   — bounding set; hard ceiling
  CapAmb   — ambient; kept across exec even without file caps (systemd AmbientCapabilities=)

File capabilities (getcap)
  =ep  effective+permitted on the binary
  =eip inheritable too

systemd unit
  AmbientCapabilities=CAP_NET_BIND_SERVICE
  CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_SETUID …
```

A non-root process with CAP_NET_BIND_SERVICE in effective can bind :80. Root without that cap cannot.

User namespaces give the “root” inside the namespace a full set that maps to nothing outside. That is why a container root still cannot touch host devices.

## Key Commands

```bash
# What this process actually has
grep ^Cap /proc/<pid>/status
capsh --decode=$(grep CapEff /proc/<pid>/status | awk '{print $2}')
# or
getpcaps <pid>

# File capabilities
getcap /usr/bin/ping /usr/sbin/arping
setcap cap_net_bind_service=ep /usr/local/bin/mybind   # careful; usually package-managed

# Bounding set and ambient (systemd)
systemctl show <unit> -p AmbientCapabilities -p CapabilityBoundingSet -p User
cat /proc/<pid>/status | grep -E 'Cap|NoNewPrivs'

# Quick test
capsh --print
# Drop everything and see what breaks
capsh --drop=all -- -c 'ping -c1 127.0.0.1'   # expect failure without NET_RAW
```

Common useful caps for services:

- CAP_NET_BIND_SERVICE — ports < 1024
- CAP_NET_RAW — ping, raw sockets
- CAP_SYS_TIME — set clock (chrony sometimes)
- CAP_DAC_OVERRIDE / CAP_DAC_READ_SEARCH — ignore mode bits
- CAP_SYS_ADMIN — the “almost root” hammer; avoid granting it casually

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Operation not permitted` as root | Cap missing from effective or bounding set | `grep Cap /proc/PID/status`, `systemctl show -p CapabilityBoundingSet` |
| Works from shell, fails under systemd | Unit dropped AmbientCapabilities or set NoNewPrivileges | `systemctl cat`, `systemctl show` |
| Binary used to bind low port, now fails | File cap lost after package update | `getcap` on the binary |
| Container root cannot touch host path | User-namespace mapping + dropped caps | `ls -n`, `capsh --decode` inside netns |
| `ping` works as user, fails as service | Missing CAP_NET_RAW | `getpcaps`, unit AmbientCapabilities |
| setuid binary ignored | NoNewPrivs or bounding set blocks it | `grep NoNewPrivs /proc/PID/status` |
| Capability present but still denied | MAC (SELinux/AppArmor) or seccomp | AVC logs, `aa-status`, seccomp filter |

## Investigation Tips

- Always look at `/proc/<pid>/status` Cap* lines for the *running* process, not the binary. File caps and ambient caps only matter at exec time.
- `systemctl show -p AmbientCapabilities,CapabilityBoundingSet,User,NoNewPrivileges` tells you what systemd intended. Compare to the live process.
- `Operation not permitted` + root user → capabilities or MAC or immutable flag. `Permission denied` is still usually DAC.
- Do not grant CAP_SYS_ADMIN to “make it work”. Find the single cap that is actually required (often NET_BIND_SERVICE or NET_RAW).
- After a package update, re-check `getcap` on any binary you previously setcap’d. Prefer a systemd AmbientCapabilities= drop-in so the right survives updates.
- In containers, the interesting question is “what does this cap mean *outside* the user namespace?” Host devices and raw sockets usually still fail.

## Related Notes

- [[Users Groups and Permissions]]
- [[sudo]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[Namespaces and cgroups]]
- [[sysctl and Resource Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service “suddenly” could not bind :443 after a container base-image change. The new image dropped CAP_NET_BIND_SERVICE from the default set. AmbientCapabilities= in the unit made the requirement explicit and visible.
- I chased mode bits for twenty minutes on a root-owned binary that failed with Operation not permitted. `getpcaps` showed an empty effective set because the unit had `CapabilityBoundingSet=` with only a few entries and the binary needed one more.
- File capabilities on a custom monitoring agent vanished after the next RPM update. Moving the grant into a systemd drop-in (`AmbientCapabilities=`) ended the cycle.
