# AppArmor Basics for Admins

## Concept

AppArmor is a path-based mandatory access control system. Profiles confine processes to the files, capabilities, and network operations listed in the profile. Unlike SELinux it is not label-based; the profile is attached to the binary path.

Common on Ubuntu, Debian, and SUSE. Modes are enforce and complain (log only).

## Why it matters

- A service that “works as root” can still be denied by its AppArmor profile
- Package updates sometimes ship a tighter profile; the service starts failing with no Unix permission change
- `aa-complain` is the diagnostic equivalent of SELinux Permissive
- Docker/podman on AppArmor hosts inherit or are confined by the runtime profile; bind-mounts outside allowed paths fail

If `dmesg` or the journal shows `apparmor="DENIED"` and you have not looked at the profile, you are debugging the wrong layer.

## Mental Model

```
Binary path (/usr/sbin/nginx)
    → profile loaded by AppArmor
        → allow / deny rules for files, network, capabilities
            → DENIED logged to journal / syslog

aa-complain   = log but allow
aa-enforce    = log and deny
```

Profiles live in `/etc/apparmor.d/`. A local override is usually a new file in that directory or an abstraction include, not a hand-edit of the packaged profile (which will be overwritten).

## Key Commands

```bash
# Status
aa-status
apparmor_status

# Put a profile into complain (diagnostic)
aa-complain /usr/sbin/nginx
# or
aa-complain /etc/apparmor.d/usr.sbin.nginx

# Back to enforce
aa-enforce /usr/sbin/nginx

# Reload after editing a profile
apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
systemctl reload apparmor

# Recent denials
journalctl -k | grep -i apparmor
dmesg | grep DENIED
grep DENIED /var/log/syslog /var/log/audit/audit.log 2>/dev/null | tail

# Generate a profile skeleton (interactive, careful)
aa-genprof /usr/sbin/myapp
```

`aa-logprof` can turn recent denials into suggested rules. Review every suggestion; it will happily allow things you do not want.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service fails to open a config or socket | Profile does not allow the path | `aa-status`, journal DENIED lines |
| Works after `aa-complain`, fails on enforce | Missing allow rule | DENIED message names the path |
| Docker container cannot write a bind-mount | Runtime profile or lack of `:Z`-style exception | AppArmor profile for docker, mount options |
| Profile “disappeared” after upgrade | Packaged profile changed; local edit lost | Diff `/etc/apparmor.d/` against package |
| No DENIED messages but still blocked | AppArmor not the cause, or logging disabled | `aa-status`, confirm profile is loaded |
| Boot hangs or service timeout | Profile denies something early | journal from the unit, temporary complain |

## Investigation Tips

- `aa-status` first. If the binary is not listed, AppArmor is not confining it.
- The DENIED line names the exact path and the requested permission. That is the rule you need to add or the path you need to change.
- Prefer a local override profile or an include over editing the file shipped by the package.
- After any profile change, reload and re-test the exact operation that failed. A successful start does not prove the later code path is allowed.
- On mixed fleets, know which hosts use SELinux and which use AppArmor. The denial messages and the fix commands are different.
- Complain mode is for diagnosis. Leaving a production service in complain removes the confinement you thought you had.

## Related Notes

- [[SELinux Basics for Admins]]
- [[Users Groups and Permissions]]
- [[Linux Capabilities]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An nginx upgrade shipped a profile that no longer allowed a custom `/srv/cache` path. The error in the nginx log was generic; the journal had the AppArmor DENIED with the path. One line in a local profile fixed it.
- I used `aa-complain` on a database “to see.” It stayed in complain through the next patch cycle. Enforce is the steady state; complain is a temporary window.
- Docker bind-mount of a host directory outside `/var/lib/docker` failed with no Unix error inside the container. The host AppArmor profile for the runtime was the blocker.
