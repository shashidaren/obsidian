# Users Groups and Permissions

## Concept

Linux discretionary access control is: **who owns the object**, **what the mode bits say**, then extra layers (ACLs, capabilities, SELinux/AppArmor).

A process is allowed through only if *every* layer on the path agrees. `chmod 777` on the file fails when the real problem is a parent directory, an ACL, a missing supplementary group, or MAC.

Identity itself is not just `/etc/passwd`. Local files, SSSD/LDAP, nsswitch, and the process's *effective* UID can disagree. Permission tickets often start as identity tickets.

## Why it matters

- Most application "permission denied" tickets are path or ownership problems, not kernel bugs
- Services that work when you test as root fail as the unit user
- Broken ownership after tarballs, rsync `--no-owner`, or container volume mounts is routine
- `usermod -aG` does not take effect until a new session; systemd units keep the old group set until restart
- Security reviews start here: who can write this file, and what user does the daemon actually run as?

## Mental Model

```
Process credentials
  ruid/euid/suid, rgid/egid/sgid, supplementary groups, capabilities
        ↓
Name lookup (nsswitch): files → sss/ldap → …
        ↓
For each path component of /a/b/c/file:
  execute (search) bit on the directory  +  DAC / ACL  +  MAC
        ↓
On the final object:
  rwx for owner / group / other   or   ACL override
        ↓
Then SELinux / AppArmor / capabilities for privileged ops
```

Directory `x` means "you may traverse," not "you may list." Directory `r` means "you may list names." You need `x` on *every* parent to reach a file.

Numeric modes: `r=4, w=2, x=1`. `0750` is `rwxr-x---`.

Special bits:

- setuid / setgid on executables: run as file owner/group
- setgid on directories: new files inherit the directory group
- sticky (`/tmp`): only the owner (or root) can delete their files

`umask` subtracts bits from the mode requested at create time. A service with `UMask=0077` will never create group-readable logs no matter how you `chmod` the directory afterwards — new files keep arriving tight.

Root is not "skip DAC" in every sense. `CAP_DAC_OVERRIDE` is what makes root ignore mode bits. Dropped capabilities in a unit or container make root look mortal.

## Key Commands

```bash
# Identity of the current / target process
id
id <user>
ps -o pid,user,uid,gid,group,cmd -p <pid>
cat /proc/<pid>/status | grep -E 'Uid|Gid|Groups|Cap'
cat /proc/<pid>/loginuid

# How names resolve on this host
getent passwd <user>
getent group <group>
grep -E '^(passwd|group|shadow):' /etc/nsswitch.conf

# What the filesystem thinks
ls -ldn /path /path/to /path/to/file     # -n = numeric UIDs, no NSS delay
stat /path/to/file
namei -l /path/to/file                   # walk every component
getfacl /path/to/file
lsattr /path/to/file                     # immutable / append-only

# Who is this daemon?
systemctl show <unit> -p User -p Group -p SupplementaryGroups -p UMask -p DynamicUser

# Smallest change that works
chown user:group /path/to/file
chmod 0640 /path/to/file
chmod u+X,g+X dir                        # capital X: dirs only / already executable
chmod g+s /var/app/shared                # setgid inheritance

# Groups — then restart the service; login sessions do not update live PIDs
usermod -aG <group> <user>

# Find drift
find /var/app -xdev \( ! -user app -o ! -group app \) -ls
find /var/app -xdev -perm -0002 -type f          # world-writable
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Permission denied` on a file you can `ls` | Missing `x` on a parent, or file mode/ACL | `namei -l`, `ls -ld` each component |
| Works as root, fails as the service user | Ownership or group membership | `id serviceuser`, `ps` of the daemon |
| Works in an interactive shell, fails under systemd | Different user, stale groups, different `UMask=` / cwd | `systemctl show` |
| `Operation not permitted` not `Permission denied` | Capabilities, `chattr +i`, or MAC | `lsattr`, `getcap`, AVC / AppArmor logs |
| New files have the wrong group | Missing setgid on the directory | `ls -ld dir`, `chmod g+s dir` |
| New files always `600` | Unit `UMask=` or daemon umask | `systemctl show -p UMask` |
| Docker/K8s volume unreadable | UID in container ≠ owner on host | `ls -n`, user-namespace mapping |
| After `usermod -aG`, still denied | Groups assigned at login | restart the unit |
| `getent` works, `id` inside the process does not | Process started before the group change / SSSD cache | restart; `sss_cache -E` if used |
| Root in a container still denied | Dropped caps + user namespace + MAC | `grep Cap /proc/1/status`, `ls -Z` |

## Investigation Tips

- Reproduce as the *same user* the process uses. `sudo -u app -s` is closer than testing as yourself. Closer still: `nsenter -t <pid> -S <uid> -G <gid>` when namespaces differ.
- `namei -l /full/path` finds the first component that blocks traversal. Start there; do not chmod the leaf first.
- If `ls -l` looks fine, check ACLs (`getfacl`) and MAC (`ls -Z`, AppArmor) before chmod.
- `Permission denied` is usually DAC. `Operation not permitted` often means capabilities, `chattr +i`, or SELinux.
- Numeric `ls -n` / `stat` avoids waiting on a sick LDAP and shows the UID the inode actually stores.
- Do not fix production with `chmod -R 777`. It hides the path problem and is the next incident.
- For shared directories prefer a dedicated group + `02770` + setgid over world-writable sticky dirs, unless it is actually `/tmp`.
- `DynamicUser=` gives the unit a fresh UID. Persistent volumes owned by last week's UID will fail after the next daemon-reload. Pin a real user for stateful units.

## Related Notes

- [[sudo]]
- [[PAM]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[SSH Hardening and Troubleshooting]]
- [[File Descriptors]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- If a deploy "randomly" cannot write its log directory, check whether the unit runs as `DynamicUser=` or a new UID that no longer owns the volume from the last release.
- The classic "I added them to the group" ticket is a running JVM that still has the old `/proc/pid/status` Groups line. `id` in a new shell lies about the daemon.
- Container UID 0 on a host-owned bind mount is still UID 0 *inside* and often UID 1000 or 100000 *on the inode*. `ls -n` from both sides ends the argument.
