# Repository Troubleshooting

## Concept

Package operations fail as often on the *path to metadata* as on the package itself. DNS, proxy, TLS, GPG, entitlement, suite/version mismatch, and a poisoned local cache all present as “yum/apt is broken”.

Fix identity and connectivity before you disable signature checks. `--nogpgcheck` / `--allow-unauthenticated` turns a metadata problem into a supply-chain incident.

## Why it matters

- A dead repo blocks the emergency CVE you needed an hour ago
- A wrong-suite or third-party repo installs incompatible packages and then poisons the next major upgrade
- Corporate SSL-inspect proxies break TLS to vendor CDNs in ways that look like mirror outages
- Air-gapped mirrors that stop syncing look like “there are no updates”

## Mental Model

```
Client DNS / proxy / firewall
        ↓
Repo URL  (baseurl / mirrorlist / metalink)
        ↓
TLS + signature  (InRelease / Release.gpg / RPM-GPG-KEY / signed-by=)
        ↓
Metadata         (Packages / repomd.xml)
        ↓
Package payload matching that metadata
        ↓
Local cache      (apt lists, /var/cache/dnf)
```

Ask, in order: can I resolve it, can I connect, can I trust it, is the metadata for *this* OS version, does the payload match the metadata, is my cache lying?

## Key Commands

```bash
# --- Debian / Ubuntu ---
cat /etc/os-release
ls /etc/apt/sources.list /etc/apt/sources.list.d/
apt-config dump | grep -iE 'proxy|source'
apt update
apt policy
apt policy <pkg>                 # which origin owns the candidate?

getent hosts archive.ubuntu.com
curl -vI https://archive.ubuntu.com/ubuntu/

# NO_PUBKEY / signed-by
ls /etc/apt/trusted.gpg.d/
gpg --show-keys /etc/apt/trusted.gpg.d/* 2>/dev/null

# --- RHEL / Fedora / Rocky ---
ls /etc/yum.repos.d/
dnf repolist -v
dnf repoinfo <id>
dnf --disablerepo='*' --enablerepo=<id> check-update

subscription-manager status 2>/dev/null
subscription-manager repos --list-enabled 2>/dev/null

# Cache reset (after you know why it failed)
apt clean && apt update
dnf clean all && dnf makecache

# Hit the exact URL from the repo file
grep -hE '^(deb |baseurl=|metalink=|mirrorlist=)' \
  /etc/apt/sources.list /etc/apt/sources.list.d/* \
  /etc/yum.repos.d/*.repo 2>/dev/null
```

Never add a random third-party repo to production to “just get a newer package” without a pin and an exit plan.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Could not resolve host` | DNS, search domain, split-horizon | `getent hosts`, resolvers, proxy env |
| Timeout / `Connection refused` | Firewall, mandatory proxy, dead mirror | `curl -vI` the baseurl |
| `Certificate verify failed` | MITM proxy, expired mirror, old CA store | `curl -vI`, `ca-certificates` package |
| `NO_PUBKEY` / GPG recovery failed | Key not installed or rotated | vendor key + `signed-by=` on that source |
| Hash / checksum mismatch | Bad mirror, partial sync, dirty cache | other mirror, `clean`, compare `Release` dates |
| `404` on Packages / `repomd.xml` | Suite in the URL is wrong (jammy vs noble, 8 vs 9) | `os-release` vs repo file |
| Empty `repolist` on RHEL | Subscription lapsed, repos disabled | `subscription-manager status` |
| Older candidate than expected | Pin, hold, versionlock, disabled origin, Ubuntu phasing | `apt policy` / `dnf repoinfo` |
| `full-upgrade` explodes | Third-party origin with higher priority | disable extras, retry |
| “No updates” on an air-gap | Mirror sync job died | mirror cron/logs, `Release` date |

## Investigation Tips

- Reproduce with `curl -vI` against the *exact* baseurl. Package managers hide HTTP codes and proxy CONNECT.
- Check `http_proxy` / `https_proxy` in the *environment* and in `/etc/apt/apt.conf.d/` or `/etc/dnf/dnf.conf`. They disagree more often than people expect.
- Confirm `/etc/os-release` and `uname -m` before you rewrite a URL. Containers sometimes ship with no CA store and a copied repo file from another release.
- Prefer `signed-by=/path/to/that-repo.gpg` on one source file over dumping keys into the global trust store.
- Read the *first* error in an `apt update` / `dnf makecache` cascade. The last line is usually fallout.
- Pin third-party packages so they cannot hijack `libc`, `sudo`, `openssh`, or the kernel.
- Monitor the sync job on internal mirrors. Stale metadata is indistinguishable from “the vendor published nothing”.

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

- The “yum is broken” ticket that ate an afternoon was a corporate SSL-inspect proxy plus a stale `ca-certificates`. `curl -vI` to the metalink showed the real error in ten seconds; DNF only said “failed to download metadata”.
- A developer added a desktop Copr to a production EL box to get a newer `git`. Six months later `dnf upgrade` wanted to replace glibc. Third-party repos need a pin *and* an owner.
- `--nogpgcheck` “just this once” survived into the golden image. That is how you turn a key-rotation problem into a supply-chain problem.
- Our air-gapped mirror’s cron had been failing quietly for 37 days. Every host reported “already up to date.” Check the `Release` / `repomd` timestamp, not the client’s opinion.
