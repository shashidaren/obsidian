# AppArmor

## Concept

AppArmor is path-based Mandatory Access Control. A profile named after an executable lists what that binary may open, map, exec, network, and which capabilities it may use. There are no filesystem labels to keep consistent; the trade-off is that a moved binary or a new data path is invisible to the profile until you say so.

Default MAC on Ubuntu and many SUSE/openSUSE systems. Same operational role as SELinux: second gate after Unix DAC. Different failure language (`apparmor="DENIED"` in the kernel log instead of AVC).

## Why it matters

- Ubuntu “permission denied” with correct `rwx` is often AppArmor, not DAC
- Packaged profiles ship with nginx, MySQL, libvirt, snap, container runtimes. An upgrade can tighten a profile overnight
- Custom install prefixes (`/opt/app/sbin/nginx`) do not match ` /usr/sbin/nginx` profiles. The process runs unconfined or under the wrong name
- Global disable (`systemctl stop apparmor`) is the Ubuntu cousin of `setenforce 0` — it hides the bug and fails the next review

## Mental Model

```
exec /usr/sbin/nginx  → kernel attaches profile usr.sbin.nginx
                      → every open/mmap/connect checked against that profile

profile states (per profile, not whole machine):
  enforce    deny + log
  complain   allow + log   (learning)
  unconfined no profile

files:
  /etc/apparmor.d/           source profiles
  /etc/apparmor.d/disable/   symlink here to disable one profile
  /etc/apparmor.d/local/     drop-in additions (prefer these)
```

A child process keeps the parent profile unless it execs a binary with its own profile (`px`/`cx` rules). That is why a helper binary suddenly “cannot read its config” after you wrap it in a launcher.

Snaps and some container stacks ship *their own* profiles. Debugging Docker/containerd denials on Ubuntu without `aa-status` is how you waste an hour in `chmod`.

## Key Commands

```bash
# What is loaded
aa-status
aa-status --enforced
aa-status --complaining
aa-status --json | jq '.profiles'    # if jq is handy

# Kernel denials
journalctl -k -g apparmor --since '1 hour ago'
dmesg --ctime | grep -i apparmor
auditd: ausearch -m AVC -ts recent   # some suites still tag these AVC

# Profile mode
aa-complain /etc/apparmor.d/usr.sbin.nginx
aa-enforce  /etc/apparmor.d/usr.sbin.nginx
aa-disable  /etc/apparmor.d/usr.sbin.nginx   # unconfined; last resort

# Reload after edit
apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
apparmor_parser -r /etc/apparmor.d/local/usr.sbin.nginx
systemctl reload apparmor

# What profile is this PID under?
cat /proc/<PID>/attr/current
ps -eo pid,label,comm | grep nginx     # label column on newer procps

# Learning tools (interactive; not for a burning prod change window)
aa-genprof /usr/sbin/mydaemon
aa-logprof
aa-autodep /usr/local/sbin/mydaemon    # skeleton only — review it

# Syntax check before reload
apparmor_parser -Q /etc/apparmor.d/usr.sbin.nginx
```

Prefer adding rules under `/etc/apparmor.d/local/` so a package upgrade does not clobber your exception. `#include <local/usr.sbin.nginx>` is already in most packaged profiles.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Service cannot read/write a path you just created | Profile has no rule for that path | `journalctl -k -g apparmor`; profile text |
| Works after `aa-complain`, fails on enforce | Profile is the blocker | `aa-logprof` or a tight local addition |
| Custom prefix binary is “fine” and also unconstrained | No profile attached | `cat /proc/PID/attr/current` → `unconfined` |
| Snap / Docker / LXD weird EACCES | Host profile on the runtime | `aa-status \| grep -E 'docker\|snap\|lxc'` |
| Broke after `apt upgrade` | Vendor profile tightened | `debsums` / package changelog; `diff` against local |
| Parser fails on reload | Syntax error in local include | `apparmor_parser -r` output; unmatched brackets |
| Deny on `/proc/sys` or `capability net_admin` | Profile never allowed that cap | Do not add cap rules to “make it work” without a threat model |
| Two profiles claim one binary | Override / disable symlink missing | `aa-status`; files in `apparmor.d/disable` |

## Investigation Tips

- Start with `aa-status` and one reproduction, then the kernel log line. The denied path and requested class (`r`, `w`, `m`, `net`, `capability`) are in that line.
- Complain mode on *one* profile is the right debug hole. Stopping the AppArmor service is the wrong one.
- Read the packaged profile before you generate a new one. You usually need one extra path, not a new policy language novel.
- `#include <abstractions/nameservice>` and friends exist so you do not hand-write DNS/nss rules. Delete them and you invent mysterious resolver failures.
- Reloading a profile does not restart the process. The running process may still carry the old attachment until exec. Restart the service after a meaningful change.
- On dual-stack mental models: Ubuntu is AppArmor; RHEL is SELinux. Confirm with `aa-status` / `getenforce` before you paste the other OS’s runbook.
- For containers, check whether the *runtime* is confined on the host. An unconfined `containerd` plus a tight service profile inside the guest are two different knobs.

## Related Notes

- [[SELinux Deep Dive]]
- [[Users Groups and Permissions]]
- [[Auditing]]
- [[Docker Operations]]
- [[Web Server Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A MySQL data directory moved to `/data/mysql` “for disk space” survived Unix perms and mount options, then died on AppArmor. The packaged `usr.sbin.mysqld` profile still listed `/var/lib/mysql/**`. One local include and a restart; not `aa-disable`.
- `aa-genprof` during an outage is how you get a profile that allows `/tmp/** w` and half of `/home`. Capture denials, add the three paths you actually need, reload, restart, re-test.
- Snap-confined CLI tools failing to read a file under `/etc` looked like a umask bug for far too long. `cat /proc/PID/attr/current` would have said `snap.foo.foo` immediately.
- Parser-reload without a service restart left us thinking the new rule “did nothing”. The worker processes were still running under the old loaded profile. Restart is part of the change.
