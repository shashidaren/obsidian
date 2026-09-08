# Users Groups and Permissions

## Concept

Linux discretionary access control is: **who owns the object**, **what the mode bits say**, then extra layers (ACLs, capabilities, SELinux/AppArmor).

A process is allowed through only if *every* layer on the path agrees. “chmod 777 the file” fails when the real problem is a parent directory, an ACL, or MAC.

## Why it matters

- Most application “permission denied” tickets are path or ownership problems, not mysterious kernel bugs
- Services running as non-root fail in ways that work fine when you test as root
- Broken ownership after unpacking tarballs, rsync, or container volume mounts is extremely common
- Security reviews start here: who can write this file, and what user does the daemon actually run as?

## Mental Model

```
Process credentials
  uid, euid, gid, egid, supplementary groups, capabilities
        ↓
For each path component of /a/b/c/file:
  execute (search) bit on the directory  +  DAC / ACL  +  MAC
        ↓
On the final object:
  rwx for owner / group / other   or   ACL override
        ↓
Then SELinux / AppArmor / capabilities for privileged ops
```

Directory `x` means “you may traverse,” not “you may list.” Directory `r` means “you may list names.” You need `x` on every parent to reach a file.

Numeric modes: `u=4 r, 2 w, 1 x` — `0750` is `rwxr-x---`.

Special bits:
- setuid / setgid on executables: run as file owner/group
- setgid on directories: new files inherit the directory group
- sticky (`/tmp`): only owner can delete their files

## Key Commands

```bash
# Identity of the current / target process
id
id <user>
ps -o pid,user,uid,gid,group,cmd -p <pid>
cat /proc/<pid>/status | grep -E 'Uid|Gid|Groups|Cap'

# What the filesystem thinks
ls -ld /path /path/to /path/to/file
stat /path/to/file
namei -l /path/to/file          # walk every component
getfacl /path/to/file           # ACLs, if present

# Who is this daemon?
systemctl show <unit> -p User -p Group -p SupplementaryGroups
# or in the unit file:
grep -E '^(User|Group|DynamicUser)=' /etc/systemd/system/<unit>.d/* /lib/systemd/system/<unit> 2>/dev/null

# Change ownership / mode (smallest change that works)
chown user:group /path/to/file
chmod 0640 /path/to/file
chmod u+X,g+X dir               # add execute only if it is a directory or already executable

# Groups
getent passwd <user>
getent group <group>
usermod -aG <group> <user>      # then the user must log in again

# Find overly open or wrongly owned files
find /var/app -xdev \( ! -user app -o ! -group app \) -ls
find /var/app -xdev -perm -0002 -type f          # world-writable
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Permission denied` on a file you can `ls` | Missing `x` on a parent, or file mode/ACL | `namei -l`, `ls -ld` each component |
| Works as root, fails as the service user | Ownership or group membership | `id serviceuser`, `ps` of the daemon |
| Works in an interactive shell, fails under systemd | Different user, no lingering group, different cwd | unit `User=`, `systemctl show` |
| `Operation not permitted` not `Permission denied` | Capabilities, immutable bit, or MAC | `lsattr`, `getcap`, `ausearch` / `journalctl` AVC |
| New files have the wrong group | Missing setgid on the directory | `ls -ld dir`, `chmod g+s dir` |
| Docker/K8s volume unreadable | UID in container ≠ owner on host | `ls -n`, user namespace mapping |
| After `usermod -aG`, still denied | Groups are assigned at login | restart the service or new session |

## Investigation Tips

- Reproduce as the *same user* the process uses. `sudo -u app -s` is closer than testing as yourself.
- `namei -l /full/path` is the fastest way to find the first component that blocks traversal.
- If `ls -l` looks fine, check ACLs (`getfacl`) and MAC (`ls -Z`, AppArmor status) before chmod.
- `Permission denied` is DAC. `Operation not permitted` often means capabilities, `chattr +i`, or SELinux.
- Do not fix production with `chmod -R 777`. It hides the real path problem and creates the next incident.
- For shared directories, prefer a dedicated group + `02770` + setgid over world-writable sticky dirs, unless it is actually `/tmp`.

## Related Notes

- [[sudo]]
- [[PAM]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[SSH Hardening and Troubleshooting]]
- [[File Descriptors]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> If a deploy “randomly” cannot write its log directory, check whether the unit runs as `DynamicUser=` or a new UID that no longer owns the volume from the last release.
