# SELinux Deep Dive

## Concept

SELinux (Security-Enhanced Linux) is a Mandatory Access Control (MAC) system that labels every process, file, and port, then enforces a policy deciding what is allowed. It runs in addition to traditional Unix discretionary permissions.

## Why it matters

- Many “permission denied” or mysterious application failures on RHEL/CentOS/Fedora/Alma are actually SELinux denials
- Disabling SELinux is a common (and usually wrong) first reaction; the correct approach is to understand and fix the label or policy
- In enforcing mode it can prevent real attacks; in permissive mode it only logs

Treat denials as evidence, not as a reason to turn enforcement off permanently.

## Mental Model

```
Everything has a label (context):
  user:role:type:level

Example:
  system_u:system_r:httpd_t:s0     ← httpd process
  system_u:object_r:httpd_sys_content_t:s0  ← web content

Policy decides whether a process type can operate on an object type.
```

Modes:
- `enforcing` — denials are blocked and logged
- `permissive` — denials are only logged
- `disabled` — SELinux is off (requires reboot to change fully)

## Key Commands

```bash
# Current mode and status
getenforce
sestatus

# Temporary mode change (survives until reboot)
setenforce 0          # permissive
setenforce 1          # enforcing

# File and process contexts
ls -Z /var/www/html
ps -eZ | grep httpd
id -Z                 # current shell context

# Restore default contexts (very common fix)
restorecon -Rv /var/www/html
chcon -t httpd_sys_content_t /path/to/file     # temporary
semanage fcontext -a -t httpd_sys_content_t '/path(/.*)?'
restorecon -Rv /path

# Booleans (tunables)
getsebool -a | grep httpd
setsebool -P httpd_can_network_connect on

# Recent denials
ausearch -m avc -ts recent
ausearch -m avc -ts today
journalctl -t setroubleshoot

# Generate a local policy module from denials (careful)
audit2allow -M mymodule < /var/log/audit/audit.log
# then: semodule -i mymodule.pp
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                              |
|--------------------------------------|--------------------------------------------|-------------------------------------------|
| Service fails to start / write files | Wrong file context                         | `ls -Z`, `restorecon`                     |
| Permission denied despite Unix perms | SELinux denial                             | `ausearch -m avc -ts recent`              |
| Network connect blocked              | Boolean or port type missing               | `getsebool`, `semanage port -l`           |
| New directory under /var/www ignored | Not labelled httpd_sys_content_t           | `semanage fcontext` + `restorecon`        |
| Denials after package update         | Policy change or relabel needed            | `fixsebool`, full relabel if necessary    |

## Investigation Tips

- Always check `getenforce` first. If it is permissive, SELinux is not the blocker (but logs may still show what would have been denied).
- `ausearch -m avc -ts recent` is the fastest way to see current denials.
- Prefer `restorecon` and proper `semanage fcontext` over permanent `chcon`.
- `audit2allow` is powerful but can create overly broad modules; review the generated policy before installing.
- A full filesystem relabel (`touch /.autorelabel && reboot`) is sometimes needed after major changes; it can take a long time.
- setroubleshoot / sealert (when installed) give human-readable explanations of denials.

## Related Notes

- [[AppArmor]]
- [[Users Groups and Permissions]]
- [[Auditing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
