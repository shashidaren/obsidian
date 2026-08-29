# Patching Strategy

## Concept

A patching strategy is the operational system for applying security and bugfix updates: what gets patched, how fast, on which hosts first, how you prove it is safe, and how you roll back. It is risk management, not “run `yum update` on Friday”.

## Why it matters

- Unpatched kernels and libraries are how most commodity exploits land on production hosts
- Blind full upgrades cause outages that are worse than the CVEs they were meant to fix
- Without inventory, reboot policy, and rollback, you cannot meet either security or uptime goals
- Auditors ask “what is patched, since when, and how do you know?” — not “do you care about security?”

## Mental Model

```
Classify  → Test  → Stage  → Roll out  → Verify  → Reboot if needed  → Record

Urgency buckets (example):
  Emergency   — actively exploited, internet-facing. Hours, not days.
  Fast        — high CVSS on reachable services. Days.
  Routine     — monthly/quarterly baseline. Planned window.
  Defer       — no exposure path; document exception + review date.

Blast radius control:
  canaries / lowest-tier first
  one failure domain at a time (rack, AZ, cluster quorum)
  never patch the last healthy replica first
```

Kernel patches usually need a reboot (or livepatch). Library patches need a process restart to unmap the old `.so`. Package “installed” ≠ “running the new code”.

## Key Commands

```bash
# What needs updating?
# Debian/Ubuntu
apt update
apt list --upgradable
apt changelog <pkg> | head -40

# RHEL/Fedora/Rocky
dnf check-update
dnf updateinfo list security
dnf updateinfo info <advisory>
needs-restarting -r          # yum-utils / dnf-utils: reboot needed?
needs-restarting -s          # which services need restart

# What is actually running vs on disk?
rpm -V openssl               # verify files vs package
apt-get changelog openssl
# After glibc/openssl/ssh updates, restart (or reboot) consumers

lsof | grep 'DEL\|deleted'  # processes still holding replaced libraries

# Kernel / reboot awareness
uname -r
rpm -q kernel || dpkg -l 'linux-image-*'
# Compare running kernel to latest installed package

# Record what changed in a window
grep -E 'Installed|Updated|Erased' /var/log/dnf.log | tail
grep -E 'upgrade |install ' /var/log/apt/history.log | tail
journalctl --since "2026-08-29 01:00" | grep -i -E 'dnf|yum|apt'
```

Live kernel patching (kpatch, Ksplice, Canonical Livepatch) reduces reboot urgency for some CVEs. It is not a substitute for eventually running a supported kernel.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service down after “successful” patch | Restart picked up incompatible config or ABI | journal of that unit, package changelog, last working version |
| Host patched, process still vulnerable | Old library still mapped; no restart/reboot | `needs-restarting`, `lsof` deleted libs, `uname -r` |
| Partial fleet patched | Automation inventory gap, hold, or failed repo | compare versions across hosts, `apt-mark showhold` / versionlock |
| Quorum / HA outage | Patched too many members at once | cluster status, one-at-a-time rule |
| Rollback impossible | No previous package kept, no snapshot | `dnf history`, VM/LVM snapshot policy |
| Emergency CVE ignored for weeks | No owner, no SLA, ticket drowned | named owner + urgency bucket |
| Dev boxes current, prod ancient | “prod is too scary to touch” | that is the risk; shrink the batch, do not skip |

## Investigation Tips

- Treat patching as a change: ticket, window, canary, rollback, verification. See [[Change Management]].
- Maintain a software bill of what is internet-facing. Those packages get the fast bucket by default.
- Reboots are part of the strategy. A “no-reboot” estate accumulates months of kernel CVEs and deleted-but-mapped libraries.
- Keep at least one unpatched or snapshot-restorable path for the first wave (previous kernel on GRUB, `dnf history undo`, VM snapshot).
- Verify function, not just package version: health check, TLS handshake, login path, replication.
- Phased Ubuntu packages and RHEL versionlocks silently hold updates. Check them when “nothing is upgrading”.
- Automate inventory (`rpm -q` / `dpkg-query` across the fleet) so drift is visible without SSH-ing host by host.

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

> 
