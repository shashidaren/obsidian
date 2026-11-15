# User Namespaces

## Concept

A user namespace gives a process its own set of UIDs and GIDs. Inside the namespace UID 0 is root; on the host that UID maps to an unprivileged range (often 100000+). This is how rootless containers and many sandboxing tools work.

The mapping lives in `/proc/<pid>/uid_map` and `/proc/<pid>/gid_map`. Capabilities and file ownership are evaluated after the mapping.

## Why it matters

- A bind-mounted volume that is “owned by root” inside a container is frequently owned by a high UID on the host. `chmod` and `chown` from the wrong side produce confusing permission errors.
- Rootless Podman/Docker and many Kubernetes runtimes rely on user namespaces. Debugging “permission denied” without looking at the map wastes time.
- Overlapping or exhausted subordinate UID ranges (`/etc/subuid`, `/etc/subgid`) prevent new user namespaces from being created.
- Security boundaries change: a process with CAP_SYS_ADMIN inside its user namespace does not have it on the host.

## Mental Model

```
Host UID space                    Container / user-ns UID space
0 (real root)                     ← not mapped, or mapped only for privileged cases
100000–165535 (subuid range)     → 0‑65535 inside the namespace

/proc/<pid>/uid_map:
  0 100000 65536
  (inside-start host-start length)
```

File ownership on disk stores the host UID. Tools inside the namespace see the mapped UID. `ls -n` on both sides is the way to reconcile them.

## Key Commands

```bash
# Mapping for a process
cat /proc/<pid>/uid_map
cat /proc/<pid>/gid_map

# Host ranges available for unprivileged user namespaces
cat /etc/subuid
cat /etc/subgid

# Create a quick test namespace (unprivileged)
unshare --user --map-root-user --mount-proc bash
# inside: id; cat /proc/self/uid_map

# Numeric ownership (avoids NSS)
ls -ln /path/on/host
nsenter -t <pid> -U -- ls -ln /path/inside

# Capabilities inside vs outside
grep Cap /proc/<pid>/status
# or capsh --print inside the ns
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Permission denied on a bind mount that looks correct inside | Host UID ≠ mapped UID | `ls -n` both sides, uid_map |
| Cannot create user namespace | subuid/subgid exhausted or missing | `/etc/subuid`, `unshare` error |
| Root inside container cannot chown host files as expected | Mapping does not include the target host UID | uid_map length and start |
| `newuidmap` / `newgidmap` fails | setuid helper missing or AppArmor/SELinux denial | package, audit log, `ls -l $(which newuidmap)` |
| Works as rootful, fails rootless | Different mapping and capability set | compare uid_map of both |
| Volume ownership “drifts” after restart | Runtime allocated a different subuid range | pin the mapping or use a consistent user |

## Investigation Tips

- Always compare `ls -n` (numeric) from the host and from inside the namespace. Name-based `ls` hides the mapping.
- Read `/proc/<pid>/uid_map` before changing ownership. The first column is the inside UID, the second is the host UID.
- For rootless containers check `/etc/subuid` for the user that owns the runtime. An empty or overlapping range is a common CI failure.
- Capabilities are namespaced. `CAP_SYS_ADMIN` inside a user namespace does not let the process mount arbitrary filesystems on the host or change host ownership outside the map.
- When a Kubernetes volume or a Podman volume shows wrong ownership, start with the pause/container PID’s uid_map rather than chmod from the host as real root.
- See also [[Linux Capabilities]] for the interaction between mapped root and capability bounding sets.

## Related Notes

- [[Namespaces and cgroups]]
- [[Linux Capabilities]]
- [[Users Groups and Permissions]]
- [[Container Internals]]
- [[Podman Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A config file bind-mounted into a rootless Podman container was mode 600 and owned by UID 0 inside. On the host it was owned by 100999. The application (running as inside-UID 0) could read it; a host-side backup process running as a normal user could not. `ls -n` on both sides ended the argument.
- CI jobs started failing with “unshare: cannot create user namespace” after a base-image change that dropped the `newuidmap` setuid helper. Restoring the helper (and the subuid entry) fixed it; disabling user namespaces would have been the wrong long-term answer.
- We once “fixed” ownership with `chown -R 100000:100000` from the host. The next runtime restart allocated a different range and the volume became unreadable again. Pinning the subuid range or letting the runtime own the chown is more reliable.
