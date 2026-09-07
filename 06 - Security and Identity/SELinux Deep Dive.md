# SELinux Deep Dive

## Concept

SELinux is a kernel Mandatory Access Control (MAC) layer. Every process, file, socket, and port carries a *security context*. A loaded policy decides which source types may operate on which target types. Unix DAC still applies first; SELinux is a second gate.

It is default-on and enforcing on RHEL, Alma, Rocky, Fedora, and many derivatives. Most “it works if I `chmod 777` / disable SELinux” tickets are a labelling problem, not a reason to turn MAC off.

## Why it matters

- The majority of mysterious `Permission denied` on RHEL-family hosts, with Unix perms looking correct, are AVC denials
- Putting the box in permissive “just for now” becomes permanent, and then the next audit or the next attacker finds an open door
- Correct fix is almost always: restore the file type, set a boolean, or add a port type — not write a custom module on the first denial
- Containers, custom docroots, NFS homes, and “we moved the data directory” are the usual sources of wrong labels

Treat an AVC as evidence of a policy/label mismatch. Do not treat it as a product defect.

## Mental Model

```
context = user:role:type:level
             |     |     |     |
             |     |     |     MLS/MCS (s0, s0:c1,c2) — ignore until you need it
             |     |     type  ← this is what 95% of ops work is about
             |     role  (system_r / object_r)
             SELinux user (system_u, unconfined_u, user_u)

httpd_t  --read-->  httpd_sys_content_t     allowed by policy
httpd_t  --write->  default_t               denied (AVC)
```

Modes:

| Mode | What happens |
|------|----------------|
| `enforcing` | Denied *and* logged |
| `permissive` | Allowed *and* logged (the whole machine) |
| `disabled` | Off. Changing to/from disabled needs a reboot and often a full relabel |

Per-domain permissive (`semanage permissive -a httpd_t`) is almost always better than `setenforce 0` while you debug one service.

File contexts are stored in the policy (`semanage fcontext -l`) and applied to inodes by `restorecon` / `setfiles`. `chcon` writes the inode only; the next relabel undoes it. That is why `chcon` is a test, not a fix.

Booleans are named knobs the policy already anticipated (`httpd_can_network_connect`, `httpd_enable_homedirs`, `virt_use_nfs`). Check those before you generate a module.

## Key Commands

```bash
# Mode and policy
getenforce
sestatus
sestatus -v                    # policy file, process/file samples
cat /sys/fs/selinux/enforce    # 1 enforcing, 0 permissive

# Temporary mode (lost on reboot). Prefer per-domain permissive.
setenforce 0
setenforce 1
semanage permissive -a httpd_t
semanage permissive -d httpd_t

# Contexts
ls -Z /var/www/html
ls -Zd /var/lib/pgsql/data
ps -eZ | grep -E 'httpd|nginx|postgres'
id -Z
stat -c '%n %C' /srv/app

# What *should* this path be?
matchpathcon /var/www/html/index.html
semanage fcontext -l | grep '/var/www'

# Durable fix: record the mapping, then apply it
semanage fcontext -a -t httpd_sys_content_t '/srv/www(/.*)?'
restorecon -Rv /srv/www
# Remove a local mapping
semanage fcontext -d '/srv/www(/.*)?'

# Temporary label only (will not survive relabel)
chcon -t httpd_sys_content_t /srv/www/index.html

# Booleans
getsebool -a | grep httpd
getsebool httpd_can_network_connect
setsebool -P httpd_can_network_connect on     # -P = persist

# Ports
semanage port -l | grep http
semanage port -a -t http_port_t -p tcp 8443
semanage port -d -t http_port_t -p tcp 8443

# Denials
ausearch -m avc -ts recent
ausearch -m avc -ts today
ausearch -m avc -ts recent -i          # interpret uids
journalctl -t setroubleshoot --since '1 hour ago'
sealert -a /var/log/audit/audit.log    # if setroubleshoot-server is installed

# Last resort: local module. Review before install.
ausearch -m avc -ts recent | audit2allow -m localhttpd
ausearch -m avc -ts recent | audit2allow -M localhttpd
# semodule -i localhttpd.pp
semodule -l | grep local
```

Permanent mode lives in `/etc/selinux/config` (`SELINUX=enforcing`). Editing that file without understanding relabel cost is how people boot into a multi-hour `/.autorelabel`.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Service dies; Unix perms look fine | Wrong type on data/socket/log dir | `ls -Z`, `matchpathcon`, `ausearch -m avc -ts recent` |
| `Permission denied` writing a new docroot | Path not in fcontext database (`default_t`) | `semanage fcontext -a` + `restorecon` |
| httpd cannot talk to DB/API on another port | Boolean off, or port not typed | `getsebool httpd_can_network_connect`; `semanage port -l` |
| Works in permissive, fails in enforcing | Real denial, not a ghost | Capture AVC *while* reproducing, then fix label/boolean |
| NFS/CIFS home or data dir denied | Mount needs context= or a virt/httpd NFS boolean | `ps -eZ`, `getsebool -a \| grep nfs` |
| Container cannot bind a host path | Host labels vs container_file_t / spc_t | `ls -Z` on bind mount; `:z` / `:Z` only if you accept relabel |
| After restore from backup, everything denied | Backup tool dropped xattrs | `restorecon -Rv /` on the restored tree; check `getfattr -m security.selinux` |
| Login / cron / ssh oddities after `SELINUX=disabled` flip | Incomplete disable/enable, pending relabel | `sestatus`; `/.autorelabel`; boot time |
| `audit2allow` module “fixed it” and opened the world | Module allows `unconfined` or `dir_write` too broadly | Read the `.te` file; prefer fcontext/boolean |

## Investigation Tips

- `getenforce` is step zero. If it is already permissive, SELinux is not what is blocking *this* request. The logs still tell you what *would* have blocked it.
- Reproduce once, then `ausearch -m avc -ts recent -i`. One clean AVC is worth more than a page of old noise.
- `sealert` / setroubleshoot translations are a starting hypothesis, not gospel. They love recommending `audit2allow`.
- Order of preference: restore default context → add fcontext mapping → flip a boolean → add a port type → narrow local module. Never jump to “disable”.
- `restorecon -nRv /path` is a dry run. Use it before you relabel a multi-terabyte volume.
- Full relabel (`touch /.autorelabel && reboot`, or `fixfiles onboot`) is correct after enabling SELinux or restoring a filesystem without xattrs. Budget time. It is I/O bound.
- In containers, the *engine* remaps labels. Debug the host `ls -Z` of the volume and the container process context, not just `chmod` inside the image.
- Policy updates can change types after a `yum update`. If a service broke “after patching”, check AVCs before you roll the package back.

## Related Notes

- [[AppArmor]]
- [[Auditing]]
- [[Users Groups and Permissions]]
- [[Pod Troubleshooting]]
- [[Web Server Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first time I “fixed” a RHEL web box by setting `SELINUX=disabled`, we passed the outage and failed the next audit. The actual bug was `/opt/app/html` sitting as `default_t`. Two `semanage`/`restorecon` lines would have ended the incident in minutes and left enforcement on.
- `chcon` made a demo work on Friday and a Monday patch relabel took the site down. If the mapping is not in `semanage fcontext`, it is not a fix.
- `audit2allow -M` on a whole afternoon of `audit.log` produced a module that allowed `httpd_t` to write almost anywhere. Review the `.te`. If the allow rules surprise you, you used the wrong input window or the wrong problem statement.
- Per-domain permissive on `httpd_t` let the site run while we collected a clean AVC list. `setenforce 0` on the host also let a cron job write into a place it should never have touched. Scope the hole.
