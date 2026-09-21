# RPM and DNF

## Concept

RPM is the on-disk package format and local database used by RHEL, Fedora, Alma, Rocky, and cousins. DNF is the resolver that talks to repositories, computes a transaction, downloads artefacts, and hands them to RPM — including scriptlets.

RPM answers “what files belong to this package and have they been altered?” DNF answers “what *should* be installed next, from where, and can I undo it?”

## Why it matters

- Almost every planned change on a RHEL-family host goes through DNF
- “Cannot update” is usually repos, modules, versionlock, or a full `/var` — not a mysterious RPM bug
- `dnf history` is the fastest rollback you will get without a snapshot
- `rpm -V` is how you prove a packaged file was edited, replaced, or tampered with
- Modular streams on EL8+ pin language runtimes and databases in ways that look like dependency hell if you ignore them

Treat `/var/lib/rpm` plus enabled repos as the source of truth for what the box is *supposed* to be.

## Mental Model

```
.repo files / subscription
        ↓
  metadata cache  (/var/cache/dnf)
        ↓
  solver  →  transaction  (install / upgrade / erase)
        ↓
  RPM database     (/var/lib/rpm)
        ↓
  files + scriptlets (pre/post/%transfiletrigger)

RPM  = one artefact + the local database of files/owners/scripts
DNF  = repos + depsolve + history + modules + plugins (versionlock)
```

A “successful” `dnf install` that dies in a `%post` can leave the database and the filesystem disagreeing. `dnf history info <id>` is the reconstruction tool.

On EL8/EL9, AppStream *module streams* add a second version axis. Enabling `postgresql:15` is a policy decision, not a one-off `dnf install`.

## Key Commands

```bash
# What is installed / what would change
dnf list installed <pkg>
dnf info <pkg>
dnf check-update
dnf check-update --security
rpm -q <pkg>
rpm -qa | grep -i <name>

# Install / remove / update
dnf install <pkg>
dnf remove <pkg>
dnf upgrade <pkg>
dnf upgrade                  # everything the solver will allow

# History — read before you undo
dnf history
dnf history info <id>
dnf history undo <id>
dnf history rollback <id>

# Who owns this file / what files are in the package
dnf provides /usr/bin/ss
rpm -qf /usr/bin/ss
rpm -ql <pkg>
rpm -qc <pkg>                # packaged config files
rpm -V <pkg>                 # verify against the database

# Repos and modules
dnf repolist -v
dnf repoinfo <id>
dnf config-manager --enable <id>
dnf config-manager --disable <id>
dnf module list
dnf module list <name>

# Pins
dnf versionlock list
dnf versionlock add <pkg>
dnf versionlock delete <pkg>

# Cache
dnf clean all
dnf makecache

# Local RPM when you must (prefer dnf even for a file)
dnf install ./foo-1.2-3.el9.x86_64.rpm
rpm -qp --scripts foo-1.2-3.el9.x86_64.rpm    # inspect scriptlets first
```

`rpm -V` output letters: `S` size, `M` mode, `5` digest, `D` device, `L` symlink, `U` user, `G` group, `T` mtime, `P` capabilities. A `c` in the last column means “this is a config file” — drift there is often intentional.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Dependency conflict / broken transaction | Mixed modules, third-party repo, leftover package | `dnf check`, `dnf module list`, `dnf history` |
| `No match for argument` | Repo disabled, wrong releasever, subscription | `dnf repolist -v`, `/etc/os-release` |
| GPG check failed | Missing/rotated key, wrong `gpgkey=` | repo file, `rpm -q gpg-pubkey` |
| Update does nothing | versionlock, exclude=, modular pin, phasing N/A | `dnf versionlock list`, repo `exclude=` |
| `rpm -V` screams after a “good” host | Local edits or an incomplete restore | decide: restore package file or own the override |
| Scriptlet error mid-transaction | `%pre`/`%post` failed (user, path, selinux) | `dnf history info`, journal around that minute |
| Disk full during transaction | Cache + packages + `/var` | `df -h /var /usr`; never continue half-full |
| `rpmdb` errors | Interrupted transaction, crashed disk | `dnf check`, vendor `rpm --rebuilddb` *only* with a backup |
| Two versions of a library after “upgrade” | Old package not erased; module reset needed | `rpm -q`, `dnf module reset` |

## Investigation Tips

- Snapshot `dnf history` *before* a risky transaction so you know the id to undo.
- Prefer `dnf install ./file.rpm` over raw `rpm -Uvh` whenever dependencies exist. Use `rpm` for query and verify.
- `rpm -V` after an incident or a backup restore is cheap integrity. Ignore config-file drift you expect; do not ignore changed binaries.
- On EL8/EL9, `dnf module list --enabled` belongs in the same breath as `dnf repolist`.
- Keep headroom on `/var` and `/usr`. A full `/var/lib/rpm` or `/var/cache/dnf` turns a routine patch into a recovery drill.
- `exclude=` in a `.repo` file and versionlock both hide updates. Search both when “the CVE package is not coming down”.
- For air-gapped boxes: `dnf download --resolve` on a twin, then a local `file://` repo. Do not scp random RPMs onto production.

## Related Notes

- [[APT and dpkg]]
- [[Patching Strategy]]
- [[Repository Troubleshooting]]
- [[Major Version Upgrades]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I used to run `rpm -Uvh` from a vendor tarball “because DNF could not find it”. The next `dnf upgrade` then fought the unpackaged library for six months. If the file is an RPM, let DNF own the transaction.
- `dnf history undo` saved a Friday when a third-party repo upgraded `openssl` out from under sshd. Knowing the transaction id *before* we started was the whole trick.
- Versionlock on `kernel` looked smart until the next CVE. The lock file is part of the patching strategy, not a set-and-forget.
- A host with a corrupted rpmdb after a power loss looked like “yum is broken”. The real sequence was: copy `/var/lib/rpm` aside, then rebuild. Running rebuild on the only copy is how you lose the database twice.
