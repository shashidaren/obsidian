# AppArmor

## Concept

AppArmor is a Mandatory Access Control (MAC) system that confines programs using path-based profiles. Unlike SELinux (label-based), AppArmor decides what a binary may do based on the executable path and a declarative profile.

It is the default MAC system on Ubuntu and many SUSE-based distributions.

## Why it matters

- Many “permission denied” or mysterious service failures on Ubuntu are AppArmor denials, not Unix permission problems
- Profiles ship with packages; a new version or custom path can suddenly start denying legitimate access
- Disabling AppArmor globally is rarely the right fix; understanding and adjusting the profile is
- Useful for locking down services (nginx, MySQL, Docker, etc.) with relatively readable policy

Treat denials as evidence, not as a reason to turn enforcement off permanently.

## Mental Model

```
Executable path → profile → allowed operations on paths, capabilities, network, etc.

Profile states:
  enforce  → denials are blocked and logged
  complain → denials are only logged (learning mode)
  unconfined → no profile applied

Profiles live under /etc/apparmor.d/
Kernel loads them; aa-status shows the current state.
```

A process inherits the profile of its executable (or is unconfined). Changing a profile or putting it into complain mode does not require a reboot.

## Key Commands

```bash
# Overall status and loaded profiles
aa-status
aa-status --enforced
aa-status --complaining

# Kernel messages / denials (also appear in journal)
dmesg | grep -i apparmor
journalctl -k | grep -i apparmor
journalctl -t apparmor

# Put a profile into complain (learning) mode
aa-complain /etc/apparmor.d/usr.sbin.nginx

# Return to enforce
aa-enforce /etc/apparmor.d/usr.sbin.nginx

# Disable a profile temporarily (unconfined)
aa-disable /etc/apparmor.d/usr.sbin.nginx

# Reload profiles after editing
apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
systemctl reload apparmor          # or restart if needed

# Generate or update a profile interactively (careful)
aa-genprof /usr/sbin/mydaemon
aa-logprof                         # process recent denials into profile updates

# Check which profile a running process is under
ps auxZ | grep nginx               # or cat /proc/<PID>/attr/current
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| Service fails to read/write files    | Profile missing path or wrong mode         | `aa-status`, `dmesg \| grep apparmor`, journal   |
| Permission denied despite Unix perms | AppArmor denial                            | `journalctl -k -g apparmor`                       |
| Works after `aa-complain`            | Profile is too strict                      | Review denials, add paths with `aa-logprof`       |
| Custom binary / non-packaged path    | No profile or wrong profile name           | Create profile or use `aa-autodep`                |
| Docker / container weirdness         | Host profile interacting with container    | Check docker/containerd profiles                  |
| Denials after package upgrade        | Profile tightened or paths changed         | Compare package profile, re-run `aa-logprof`      |

## Investigation Tips

- Always start with `aa-status` and recent kernel/journal messages containing “apparmor”.
- Prefer `aa-complain` + `aa-logprof` over permanent disable when you need a service to work while you fix the profile.
- Profiles are text files under `/etc/apparmor.d/`; they are more readable than SELinux policy modules but still easy to get wrong.
- `#include` directives pull in abstractions (e.g. network, nameservice). Do not delete them casually.
- After editing a profile, reload it with `apparmor_parser -r` or `systemctl reload apparmor`.
- On systems that also have SELinux (rare on Ubuntu), confirm which MAC is actually enforcing.

## Related Notes

- [[SELinux Deep Dive]]
- [[Users Groups and Permissions]]
- [[Auditing]]
- [[SSH Hardening and Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
