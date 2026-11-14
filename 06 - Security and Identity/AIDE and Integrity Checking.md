# AIDE and Integrity Checking

## Concept

AIDE (Advanced Intrusion Detection Environment) builds a database of file hashes, permissions, and sizes, then compares the live filesystem against that database. It is a tripwire for “something changed that should not have”.

It is not a real-time antivirus and it is not a substitute for package verification (`rpm -V`, `debsums`).

## Why it matters

- Detects unexpected binary replacements, config drift, and web-shell drops between package updates.
- Gives you a concrete diff after an incident: which files changed, when the database was last updated.
- Catches the case where an attacker modifies a binary that the package manager still thinks is “correct” because the RPM database was also altered.
- Forces a deliberate “I accept these changes” step after every legitimate update.

## Mental Model

```
aide --init
    → walk the paths in /etc/aide.conf
    → hash + metadata → /var/lib/aide/aide.db.new

aide --check
    → compare live tree to aide.db
    → report added / removed / changed

aide --update
    → check, then promote the new database
    → do this only after you have reviewed the diff
```

The database itself must be protected. If an attacker can rewrite `aide.db`, the check is worthless. Store it offline, or on a read-only medium, or sign it.

## Key Commands

```bash
# Initialise (first run, or after a known-good state)
aide --init
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db

# Daily / on-demand check
aide --check

# After a deliberate change (package update, config edit)
aide --update
# review the output, then
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db

# One path
aide --check --config /etc/aide.conf /usr/bin/sshd

# Package-manager cross-check (faster, different question)
rpm -Va          # or debsums -c
```

Typical config snippets (paths only — tune to the host):

```
/usr/bin R
/usr/sbin R
/etc R
!/var/log
!/tmp
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Check reports thousands of changes after a yum/dnf update | database not updated after the update | expected; run `--update` only after review |
| `aide.db` missing or zero | init never run, or db deleted | `ls -l /var/lib/aide` |
| Check always clean but you know a file changed | path excluded, or db was updated by the attacker | config `!` lines, db mtime vs incident time |
| High CPU for hours | first init on a large tree, or no excludes | exclude logs, caches, container overlays |
| “changed” on every boot | files that are rewritten by the package (or by systemd) | tighten rules or exclude the path |
| Database on the same disk as the files | attacker with root rewrote both | move db off-box or to immutable storage |

## Investigation Tips

- Run the check from a known-good copy of the binary and the database if you suspect the on-disk AIDE itself was replaced.
- Diff the AIDE report against the package manager’s changelog for the same window. Changes that appear in neither are the interesting ones.
- After every maintenance window that touches packages or configs, update the database in the same change ticket. An stale database creates noise that hides the real event.
- Combine with `auditd` for the “who” and AIDE for the “what”. AIDE does not record the PID that wrote the file.
- Container hosts: exclude the overlay and volume paths or you will alert on every pod start. Check the host binaries and the critical config only.
- A clean AIDE check does not mean the host is clean. It means nothing in the watched paths changed since the last database update.

## Related Notes

- [[Auditd Deep Dive]]
- [[Auditing]]
- [[RPM and DNF]]
- [[APT and dpkg]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An “unexpected sshd binary” alert was a legitimate OpenSSH security update whose AIDE database had not been refreshed. The ticket still took an hour because nobody could prove the package manager had done it. Update the database in the same change.
- I once left `/var/lib/aide` on the root filesystem of a host that was later rooted. The attacker updated the database after replacing `/usr/bin/curl`. Off-box or signed databases would have survived.
