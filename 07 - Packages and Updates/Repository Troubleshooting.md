# Repository Troubleshooting

## Concept

Package operations fail as often because of the *repository path* (DNS, proxy, TLS, GPG, entitlement, suite/version mismatch) as because of the package itself. Fix identity and connectivity before you disable signature checks.

## Why it matters

- A broken repo blocks all patching and installs — including the emergency CVE you needed an hour ago
- Wrong-suite or third-party repos quietly install incompatible packages and wreck upgrades
- “Just add `--nogpgcheck`” turns a metadata problem into a supply-chain incident

## Mental Model

```
Client resolver / proxy
        ↓
Repo URL (mirror or vendor CDN)
        ↓
TLS + GPG / RPM-GPG-KEY / apt-key / signed-by
        ↓
Repodata / InRelease / Release + Packages / repomd.xml
        ↓
Package files matching that metadata
        ↓
Local cache (apt lists, dnf cache)
```

Failures cluster at: cannot resolve, cannot connect, cannot trust, metadata does not match payload, metadata is for the wrong OS version.

## Key Commands

```bash
# --- Debian / Ubuntu ---
cat /etc/apt/sources.list /etc/apt/sources.list.d/*
apt update
apt-config dump | grep -i -E 'proxy|source'
apt policy
apt policy <pkg>                 # which repo owns the candidate?

# Network / TLS to the mirror
getent hosts archive.ubuntu.com
curl -vI https://archive.ubuntu.com/ubuntu/
# Look at HTTP code, TLS verify, and any proxy CONNECT

# Signature / key problems
# apt update will say NO_PUBKEY <ID>
ls /etc/apt/trusted.gpg.d/
gpg --show-keys /etc/apt/trusted.gpg.d/*

# --- RHEL / Fedora / Rocky ---
ls /etc/yum.repos.d/
dnf repolist -v
dnf repoinfo
dnf --disablerepo='*' --enablerepo=<id> check-update

# Entitlement / subscription (RHEL)
subscription-manager status
subscription-manager repos --list-enabled

# Cache corruption
apt clean && apt update
dnf clean all && dnf makecache

# See the exact URL dnf will hit
dnf --setopt=reposdir=/etc/yum.repos.d config-manager --dump | grep -i baseurl
# or read baseurl=/metalink= from the .repo file and curl it
```

Never point production at a random third-party repo “just to get a newer package” without pinning and an exit plan.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Could not resolve host` | DNS, split-horizon, missing search domain | `getent hosts`, `/etc/resolv.conf`, proxy env |
| Timeout / `Connection refused` | Firewall, proxy required, mirror down | `curl -vI` the baseurl, proxy vars, `ss` |
| `Certificate verify failed` | Corporate MITM proxy, expired mirror cert, old ca-certificates | `curl -vI`, `update-ca-certificates` / `ca-certificates` package |
| `NO_PUBKEY` / `GPG key recovery failed` | Key not installed, key rotated, wrong keyring | vendor key instructions; `signed-by=` on the source |
| `Hash Sum mismatch` / `metadata does not match checksum` | Bad mirror, partial sync, poisoned cache | another mirror, `clean` + update, compare `Release` dates |
| `404` on Packages or repomd.xml | Suite/version in URL wrong (jammy vs noble, 8 vs 9) | `os-release`, repo file `baseurl`, `apt policy` |
| Empty `repolist` on RHEL | Subscription lapsed, repos disabled | `subscription-manager status` |
| Package version older than expected | Disabled repo, priority/pin, versionlock, Ubuntu phasing | `apt policy` / `dnf repoinfo`, holds, versionlock.list |
| Third-party repo breaks `full-upgrade` | Mixed origins, higher priority junk | `apt policy`, disable the extra repo and retry |

## Investigation Tips

- Reproduce with `curl -vI` (or `wget`) against the exact `baseurl` / `mirrorlist`. Package managers hide HTTP details.
- Check `http_proxy` / `https_proxy` / `HTTPS_PROXY` in the environment **and** in `/etc/apt/apt.conf.d/` or `/etc/dnf/dnf.conf`. They often disagree.
- Confirm the machine’s identity: `/etc/os-release`, architecture (`uname -m`), and whether it is a container with no CA store.
- Prefer `signed-by=/path/to/key.gpg` on a single source file over a global trusted keyring.
- After a failed update, look at the first error, not the last. APT/DNF print a cascade.
- Pin third-party packages (`APT pinning` / `dnf versionlock`) so they cannot hijack libc, sudo, or the kernel.
- Air-gapped estates need a local mirror whose *sync job* is monitored. Stale mirrors look like “no updates exist”.

## Related Notes

- [[APT and dpkg]]
- [[RPM and DNF]]
- [[Patching Strategy]]
- [[Major Version Upgrades]]
- [[DNS Resolution]]
- [[TLS Troubleshooting]]
- [[Certificates and PKI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
