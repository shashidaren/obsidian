# SELinux Basics for Admins

## Concept

SELinux is a mandatory access control system that labels every process and every object (files, sockets, ports) and enforces policy between them. Even root is constrained by the policy. Modes are Enforcing (deny and log), Permissive (log only), and Disabled.

On RHEL-family hosts it is usually Enforcing by default. On many others it is disabled or not installed.

## Why it matters

- “Permission denied” that `ls -l` and `chmod` cannot explain is often SELinux
- A service that worked in Permissive breaks after a package update that ships a stricter policy
- Restoring files with `tar` or `rsync` without labels leaves them `unlabeled_t` and the service fails
- Disabling SELinux to “fix” an incident removes a layer that was catching a real problem; the next attacker (or the next misconfiguration) has more room

If `ausearch` or the audit log is empty and you still have denials, you are looking at the wrong host or the audit daemon is not running.

## Mental Model

```
Process (domain_t)
    → allowed by policy →
Object (type_t)

denial → AVC message in audit log
         → sealert / ausearch turns it into a human sentence
         → restorecon or a local policy module fixes the label or the allow rule
```

Important types you will actually see:

- `httpd_t` / `nginx_t` for web servers
- `mysqld_t` / `postgresql_t`
- `container_t` / `container_file_t` for podman/docker
- `unlabeled_t` after a restore that ignored contexts

`semanage fcontext` + `restorecon` is how you make a non-standard path permanent. A one-off `chcon` is lost on the next relabel.

## Key Commands

```bash
# Current mode and policy
getenforce
sestatus
sestatus -v

# What is being denied right now
ausearch -m avc -ts recent
ausearch -m avc -ts recent | audit2why
sealert -a /var/log/audit/audit.log

# Labels
ls -lZ /var/www/html
ps -eZ | grep httpd
restorecon -Rv /var/www/html
semanage fcontext -a -t httpd_sys_content_t '/srv/www(/.*)?'
restorecon -Rv /srv/www

# Boolean (the supported way to open a common hole)
getsebool -a | grep httpd
setsebool -P httpd_can_network_connect on

# Temporary vs permanent
setenforce 0          # Permissive until reboot (or next setenforce)
# Permanent mode lives in /etc/selinux/config
```

A local policy module from `audit2allow` is acceptable for a one-off that the packaged policy does not cover. Review the `.te` file before you load it; do not blindly allow every denial.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service starts, cannot read its files | Wrong file context after restore or custom path | `ls -Z`, `ausearch -m avc` |
| “Permission denied” only for non-root | SELinux domain transition failed | `ps -Z`, policy module loaded? |
| Works after `setenforce 0`, breaks on reboot | Mode is Enforcing in config | `/etc/selinux/config`, `getenforce` |
| Container cannot bind a host port | `container_t` policy or missing boolean | `ausearch`, `getsebool container` |
| Relabel on boot takes hours | Large filesystem, `restorecond` or full relabel | `/.autorelabel` flag |
| AVC messages stop appearing | auditd not running or disk full | `systemctl status auditd`, `/var/log/audit` space |
| Custom module “worked” then stopped | Policy package update overwrote or conflicted | `semodule -l`, rebuild module |

## Investigation Tips

- Capture `ausearch -m avc -ts recent` *before* you flip to Permissive. The messages are the evidence.
- `setenforce 0` is a diagnostic, not a fix. If the service works in Permissive, you have confirmed the policy is the blocker; now fix the label or the boolean.
- After any restore or `rsync -a` from a non-SELinux host, run `restorecon` on the tree before you declare the service healthy.
- Prefer booleans (`setsebool -P`) over local modules for well-known exceptions (httpd network, samba shares, etc.).
- In containers, the host SELinux policy still applies to the processes. `podman` and the container runtimes set contexts; a bind-mount of a host path usually needs `:Z` or `:z`.
- Full filesystem relabel (`touch /.autorelabel && reboot`) is a last resort and can take a long time on multi-TB volumes.

## Related Notes

- [[AppArmor Basics for Admins]]
- [[Users Groups and Permissions]]
- [[Linux Capabilities]]
- [[systemd Units]]
- [[Auditd Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A restored web root had the right Unix permissions and the wrong SELinux type. `httpd` logged “Permission denied” while `ls -l` looked perfect. `ls -Z` plus `restorecon` ended it.
- I once left a host in Permissive “until we figure out the policy.” The next package update that expected Enforcing never got tested. Flip back as soon as the AVC is understood.
- `audit2allow -M` produced a module that allowed far more than the one denial. Reading the `.te` before `semodule -i` is mandatory.
