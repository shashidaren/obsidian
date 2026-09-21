# Patching Strategy

## Concept

A patching strategy is the operational system for applying security and bugfix updates: classification, test path, blast-radius control, reboot/restart policy, verification, and rollback. `dnf upgrade` / `apt upgrade` is one step inside that system, not the system.

Package “installed” is not the same as “running the new code”. Kernels need a reboot or a livepatch. Libraries need the processes that mapped them to restart.

## Why it matters

- Unpatched internet-facing kernels and TLS libraries are how commodity exploits land
- Blind full-fleet upgrades create outages that dwarf the CVE they were meant to close
- Auditors ask “what is patched, since when, and how do you know?” — inventory, not intent
- Without a reboot policy you accumulate months of deleted-but-still-mapped libraries
- Without rollback (previous kernel in GRUB, `dnf history`, snapshot) you cannot move quickly on emergency CVEs

## Mental Model

```
Classify → Test → Canary → Stage → Roll out → Verify → Restart/reboot → Record

Urgency buckets:
  Emergency  — exploited *and* reachable. Hours.
  Fast       — high impact on a reachable service. Days.
  Routine    — monthly/quarterly baseline. Planned window.
  Defer      — no exposure path. Written exception + review date.

Two clocks that people collapse:
  package on disk     (rpm -q / dpkg -l)
  code in memory      (uname -r, needs-restarting, lsof deleted)
```

Blast radius: one failure domain at a time. Never patch the last healthy replica first. Quorum services (etcd, galera, consul, kube control plane) have their own membership math.

Livepatch (kpatch, Ksplice, Ubuntu Livepatch) buys time on some kernel CVEs. It does not replace eventually running a supported kernel.

## Key Commands

```bash
# What is pending?
# Debian/Ubuntu
apt update
apt list --upgradable
apt changelog <pkg> | head -40
unattended-upgrades --dry-run   # if that path is in use

# RHEL-family
dnf check-update
dnf updateinfo list security
dnf updateinfo info <advisory>
needs-restarting -r             # reboot needed?
needs-restarting -s             # which services still map old libs

# Running vs on disk
uname -r
rpm -q kernel || dpkg -l 'linux-image-*'
lsof 2>/dev/null | grep -E 'DEL|deleted' | head

# Holds that silently skip the CVE
apt-mark showhold 2>/dev/null
dnf versionlock list 2>/dev/null

# What changed in the window
grep -E 'Installed|Updated|Erased' /var/log/dnf.log | tail
grep -E 'upgrade |install ' /var/log/apt/history.log | tail
journalctl --since "-2h" -t dnf -t yum -t apt

# Aftercare
systemctl --failed
journalctl -b -p err --no-pager | tail
```

Verification is a *user path* (login, TLS probe, health check, replication), not `echo $?` from the package manager.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service down after “successful” patch | New default config, ABI, or scriptlet | unit journal, changelog, last good version |
| Host patched, scanner still flags CVE | Process still maps old `.so` / old kernel | `needs-restarting`, `lsof` deleted, `uname -r` |
| Partial fleet | Inventory gap, hold, failed repo, canary never resumed | version compare across hosts |
| Cluster outage | Too many members patched at once | quorum status; one-at-a-time rule |
| Cannot roll back | Old kernel purged, no snapshot, history vacuumed | GRUB list, `dnf history`, backup policy |
| Emergency CVE sits for weeks | No owner, no bucket, ticket drowned | named owner + SLA per bucket |
| Prod frozen, dev current | “prod is too scary” | shrink the batch; do not skip the tier |
| Patch window used for a major upgrade | Scope creep | that is [[Major Version Upgrades]], stop |

## Investigation Tips

- Treat every production patch wave as a change: ticket, canary, rollback, verify. See [[Change Management]].
- Maintain a short list of internet-facing packages. Those default into the Fast bucket.
- Reboots are scheduled work, not a moral failing. A no-reboot estate is a CVE museum.
- Keep the previous kernel in GRUB until the new one has soaked. `dnf` will happily remove it if you let `installonly_limit` get too aggressive.
- Check Ubuntu phased updates and RHEL versionlock when “the advisory is out but this host will not pick it up”.
- Automate `rpm -q` / `dpkg-query` across the fleet. SSH-and-eyeball is not inventory.
- Record the transaction id / apt history stanza in the change ticket so undo is a copy-paste, not an archaeology project.

## Related Notes

- [[Change Management]]
- [[Major Version Upgrades]]
- [[Repository Troubleshooting]]
- [[APT and dpkg]]
- [[RPM and DNF]]
- [[GRUB and Kernel Parameters]]
- [[Incident Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We once marked a kernel CVE “patched” because `rpm -q` showed the new version. `uname -r` was still the previous one. The scanner was right; we had skipped the reboot policy.
- Patching both galera nodes “quickly so we could finish the window” lost quorum. Membership math is part of the strategy, not a footnote.
- The cleanest emergency patch I have run was: snapshot, one canary, `dnf history` id written in the ticket, user-path probe, then the rest of the AZ. The messy ones skipped the first four.
- `lsof | grep deleted` after glibc/openssl nights is now a required after-check. Package success with a still-mapped library is how scanners and attackers disagree with you.
