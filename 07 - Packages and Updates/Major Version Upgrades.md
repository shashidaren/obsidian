# Major Version Upgrades

## Concept

A major OS or platform upgrade changes repositories, default configs, library SONAMEs, init/unit behavior, kernel ABI expectations, and sometimes the bootloader. It is a planned migration with a rollback path, not "yum update on Friday".

## Why it matters

- Third-party modules, kernel drivers, and compiled agents break across major releases
- Default crypto, TLS, Python, PHP, and Java runtimes move; apps that "just worked" stop
- `sshd`, sudoers, firewall, and SELinux/AppArmor policy can change enough to lock you out
- There is no reliable undo once you have upgraded the only copy of a host without a snapshot or clone

Treat production major upgrades as a change with an explicit backout, not a patch window.

## Mental Model

```
Inventory → Rehearse on a clone → Freeze changes → Backup / snapshot
  → Upgrade repos and packages → Reboot / switch kernel
  → Verify boot, identity, network, services, apps
  → Soak → Either keep or roll back the whole machine

What actually changes:
  package metadata and default configs (*.rpmnew / *.dpkg-dist)
  libc, OpenSSL, Python, language runtimes
  kernel + modules + initramfs
  systemd units and targets
  SELinux policy / AppArmor profiles
  repo files themselves
```

In-place upgrade tools (`leapp`, `dnf system-upgrade`, `do-release-upgrade`) are conveniences. The real plan is: known inventory, known rollback, known verification.

## Key Commands

```bash
# Before: inventory
cat /etc/os-release
uname -r
rpm -qa | sort > /root/pre-upgrade-rpm.txt          # RHEL-like
dpkg -l | awk '{print $2"\t"$3}' | sort > /root/pre-upgrade-dpkg.txt
systemctl list-unit-files --state=enabled > /root/pre-enabled-units.txt
ip -br a; ip r; ss -lntup
find /etc -name '*.rpmnew' -o -name '*.rpmsave' -o -name '*.dpkg-dist' -o -name '*.dpkg-old'

# Repos and held packages
dnf repolist -v                     # or apt-cache policy
dnf versionlock list 2>/dev/null
apt-mark showhold 2>/dev/null

# Space and boot
df -hT / /boot /var /usr
lsblk -f
ls /boot; df -h /boot

# RHEL-like in-place path (example)
dnf install -y leapp leapp-upgrade
leapp preupgrade
less /var/log/leapp/leapp-report.txt
# only proceed after inhibitors are cleared

# Debian/Ubuntu in-place path (example)
do-release-upgrade --help
apt-get update && apt-get dist-upgrade

# After: compare and find dropped units / missing packages
comm -3 /root/pre-upgrade-rpm.txt <(rpm -qa | sort)
systemctl --failed
journalctl -b -p err --no-pager | head

# Config drift from package managers
find /etc -name '*.rpmnew' -o -name '*.dpkg-dist'
```

Prefer a blue/green host or a snapshot-backed clone over a heroic in-place upgrade of the only production box.

## Common Failure Modes & Symptoms

| What you see | Likely cause | First checks |
|--------------|--------------|--------------|
| Won't boot after upgrade | Kernel/initramfs/module or GRUB change | GRUB menu, `journalctl -b -1`, chroot from rescue |
| SSH dead after reboot | sshd defaults, crypto policy, firewall | Console, `sshd -t`, listen address, AllowUsers |
| App binary missing symbol | libc / OpenSSL / language runtime bump | `ldd`, vendor compatibility matrix |
| Third-party repo 404 | Repo file still points at old release | `/etc/yum.repos.d`, `/etc/apt/sources.list*` |
| SELinux denials everywhere | Policy version / unlabeled files | `getenforce`, `ausearch -m avc -ts recent` |
| Disk full mid-upgrade | `/var` or `/boot` too small for two kernels | `df -h /boot /var`; remove old kernels first |
| "Success" but config reset | New package default overwrote local edit | `*.rpmnew` / `*.dpkg-dist` vs running config |
| No rollback | In-place on the only disk, no snapshot | Stop; restore from backup or rebuild |

## Investigation Tips

- Build a clone from backup or a snapshot and run the vendor upgrade tool there first. Read the inhibitor report as the plan, not as optional reading.
- Snapshot or take a filesystem-consistent backup *and* export config (`/etc`, unit overrides, secrets location, cron/timers).
- Check `/boot` capacity before a kernel lands. Two failed kernels and a full `/boot` is a classic recovery hole.
- Disable or rewrite third-party repos before the upgrade; re-add versions built for the *new* release.
- After upgrade, diff enabled units and listening ports against the pre-upgrade files you saved.
- Merge `.rpmnew` / `.dpkg-dist` deliberately. Blindly keeping old configs can hide required syntax changes.
- Verify identity path (sshd, sudo, PAM, LDAP/sssd) from console before you leave the data center or drop the out-of-band session.
- Soak with production-like traffic on the clone or a canary host; package success ≠ application success.

## Related Notes

- [[Patching Strategy]]
- [[RPM and DNF]]
- [[APT and dpkg]]
- [[Repository Troubleshooting]]
- [[GRUB and Kernel Parameters]]
- [[Linux Boot Process]]
- [[Change Management]]
- [[Backup Strategy]]
- [[SELinux Deep Dive]]

## Personal Lessons Learned

> 
