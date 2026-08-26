# RPM and DNF

## Concept

RPM is the package format used by RHEL, Fedora, CentOS, AlmaLinux, Rocky, and related distributions. DNF (Dandified YUM) is the modern dependency resolver and repository manager that installs, updates, and removes RPM packages while handling dependencies and transaction history.

## Why it matters

- Almost every change on a RHEL-family host goes through DNF/RPM
- Broken dependencies, version locks, and bad repository configuration cause “cannot update” and runtime failures
- Transaction history and downgrade capability are critical for safe rollbacks
- Understanding local vs remote package state prevents surprise upgrades and missing security fixes

Treat the package database as a source of truth for what should be on the system.

## Mental Model

```
Repositories (baseurl / mirrorlist)
        ↓
   DNF metadata cache
        ↓
  Dependency solve → transaction
        ↓
   RPM database (/var/lib/rpm)
        ↓
  Files on disk + scriptlets (pre/post)

Key ideas:
- RPM = single package artefact + database
- DNF = solver + repo management + history
- Module streams (AppStream) add extra version dimensions on EL8+
```

A successful `dnf install` both downloads packages and runs RPM scriptlets; failures can leave partial state that history can often undo.

## Key Commands

```bash
# Status and search
dnf check-update
dnf search <keyword>
dnf info <package>
dnf list installed <package>
rpm -qa | grep <name>

# Install / remove / update
dnf install <pkg>
dnf remove <pkg>
dnf update <pkg>          # or dnf upgrade
dnf update                # all

# History and rollback
dnf history
dnf history info <id>
dnf history undo <id>
dnf history rollback <id>

# What provides a file or capability
dnf provides /usr/bin/ss
rpm -qf /usr/bin/ss
rpm -ql <package>         # list files in package
rpm -V <package>          # verify files against database

# Repositories
dnf repolist
dnf repolist -v
dnf config-manager --enable <repo>
dnf config-manager --disable <repo>

# Clean and rebuild cache
dnf clean all
dnf makecache

# Versionlock (plugin)
dnf versionlock list
dnf versionlock add <pkg>

# Low-level RPM
rpm -ivh pkg.rpm          # install local
rpm -Uvh pkg.rpm          # upgrade
rpm -e <pkg>              # erase
rpm --import /etc/pki/rpm-gpg/... 
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| Dependency conflict / broken transaction | Conflicting packages or modular streams | `dnf check`, history, module list                 |
| “No match for package”               | Repo disabled or wrong release             | `dnf repolist`, subscription / mirror config      |
| GPG check failed                     | Missing or wrong key                       | `rpm --import`, repo gpgkey setting               |
| Update blocked by versionlock        | Intentional pin                            | `dnf versionlock list`                            |
| Files modified but package claims clean | Manual edits or attack                   | `rpm -V <pkg>`, compare with known good           |
| Scriptlet failure mid-transaction    | Pre/post script error                      | `dnf history info`, logs under `/var/log`         |
| Disk full during transaction         | Metadata + packages + scriptlets           | Free space on `/var` and `/usr` before large updates |

## Investigation Tips

- Always check `dnf history` before and after significant changes; it is the fastest path to undo.
- `rpm -V` is valuable after suspected tampering or accidental edits to packaged files.
- On EL8/EL9, modular streams (`dnf module list`) can pin language runtimes and databases; conflicts often originate there.
- Prefer `dnf` over raw `rpm -Uvh` when dependencies matter; use `rpm` for inspection and verification.
- Keep `/var/cache/dnf` and `/var/lib/rpm` on filesystems with enough headroom; full disks break transactions badly.
- For offline or air-gapped systems, `dnf download` + local repo or `createrepo` is the usual pattern.

## Related Notes

- [[APT and dpkg]]
- [[Patching Strategy]]
- [[Repository Troubleshooting]]
- [[Major Version Upgrades]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
