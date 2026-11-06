# dnf History and Rollback

## Concept

Every successful `dnf` transaction is recorded with an id, a timestamp, the user, the command, and the set of packages that were installed, upgraded, or erased. `dnf history undo` and `dnf history rollback` use that record to compute a reverse transaction.

It is the fastest way to return a RHEL-family host to a known package set without a snapshot or a reinstall.

## Why it matters

- A bad third-party update, a wrong module stream, or an accidental `dnf remove` that pulled too much can be reversed in one command if you know the id.
- `dnf history info` shows the scriptlets that ran. A `%post` that failed leaves the database and the filesystem out of sync; the history entry is the map.
- Rollback is not magic. It cannot restore a file that a scriptlet deleted and that is not in any package, and it will not undo changes made outside RPM.
- Versionlock and module streams interact with history. Undoing a transaction that enabled a module may not reset the module.

## Mental Model

```
dnf install/upgrade/remove
    → solver builds a transaction
    → RPM applies it (files + scriptlets)
    → history records the id, the nevra list, and the result

undo <id>     reverse that one transaction
rollback <id> reverse every transaction after <id> (back to the state after <id>)
```

Always read `dnf history info <id>` before you undo. The reverse transaction can remove packages you still need.

## Key Commands

```bash
# Recent transactions
dnf history
dnf history list
dnf history info <id>
dnf history info last

# What would be reversed
dnf history undo <id> --assumeno
dnf history rollback <id> --assumeno

# Do it (after you have a console or snapshot)
dnf history undo <id>
dnf history rollback <id>

# Packages touched by a transaction
dnf history info <id> | sed -n '/Packages Altered/,/^$/p'

# Module state (EL8+)
dnf module list --enabled
dnf module reset <name>     # if a stream is the real problem
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `undo` wants to remove a package you still need | Later transactions depend on it | `history info`, plan a more precise undo |
| Rollback fails with conflicts | Module stream or third-party repo | `dnf module list`, repo priorities |
| History entry exists but files are missing | Scriptlet deleted them, or manual `rm` | `history info`, `rpm -V` |
| `dnf history` empty or truncated | rpmdb damage or `/var` full at the time | `df -h /var`, `dnf check` |
| Undo succeeds but service still broken | Config or data outside the package | Diff `/etc`, check application state |
| “No transaction” for the change you remember | It was `rpm -Uvh` or a container image | `rpm -qa --last` |

## Investigation Tips

- Snapshot or at least copy `dnf history` output before a risky change so the id is obvious later.
- Prefer `dnf history undo` of the single bad transaction over a broad `rollback` unless you know every later transaction is also unwanted.
- After undo, run `rpm -V` on the affected packages and restart the services that were touched.
- On EL8/EL9, check `dnf module list --enabled` in the same breath. A module reset may be required even after a successful undo.
- Keep `/var` from filling. A full `/var/lib/dnf` or `/var/lib/rpm` during a transaction is how history itself becomes untrustworthy.
- `dnf history` is local to the host. It does not know about changes made by image rebuilds or configuration management that later overwrote files.

## Related Notes

- [[RPM and DNF]]
- [[Patching Strategy]]
- [[Repository Troubleshooting]]
- [[Major Version Upgrades]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `dnf history undo` of a single transaction id recovered sshd after a third-party repo upgraded `openssl`. We had the id because we ran `dnf history` before the change window.
- A rollback that looked correct still left a service down because the package’s `%post` had rewritten a config that we had locally modified. The package was restored; the config drift was not.
- I once treated `rpm -qa --last` as a substitute for history. It shows install time, not the transaction grouping or the reverse set. Use the history id.
