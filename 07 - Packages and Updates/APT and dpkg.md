# APT and dpkg

## Concept

On Debian-family systems:

- **dpkg** is the low-level installer. It unpacks `.deb` files, runs maintainer scripts, and owns `/var/lib/dpkg`.
- **APT** (`apt`, `apt-get`, `apt-cache`) resolves dependencies, talks to repositories, downloads packages, and then calls dpkg.

When an upgrade "breaks the box", you are almost always looking at one of: interrupted dpkg, a failed maintainer script, a pin/hold, or a bad repository/key — not a mysterious apt bug.

## Why it matters

- A half-configured package blocks *every* later apt transaction
- Held or phased packages silently skip security fixes
- Mixing `dpkg -i`, third-party repos, and unattended-upgrades without pinning produces undebuggable version skew
- Service outages after patching are often `postinst` restarting something, or a conffile prompt that was skipped in a non-interactive run

## Mental Model

```
/etc/apt/sources.list{,.d}  +  preferences / pinning
        → apt update  (Packages / Release / signatures)
        → solver (depends, breaks, conflicts, holds)
        → download into /var/cache/apt/archives
        → dpkg unpack + configure
                preinst → unpack files → postinst
                prerm   → remove files → postrm
        → triggers (man-db, initramfs, systemd daemon-reload)
```

APT decides *what*. dpkg changes *the disk*. Maintainer scripts are ordinary shell and can fail for ordinary reasons (port in use, missing user, timeout).

Package state in `dpkg -l` first column pair: `ii` installed, `iU` unpacked not configured, `iF` failed-config, `rc` removed but conffiles left.

## Key Commands

```bash
# Index and upgrade
apt update
apt upgrade                 # no new pkgs, no removals
apt full-upgrade            # may remove packages to satisfy deps

# Search / policy
apt search <name>
apt show <pkg>
apt policy <pkg>            # candidate, pin, origin
apt-cache madison <pkg>     # all known versions

# Install / remove
apt install <pkg>
apt install <pkg>=<version>
apt remove <pkg>            # keeps conffiles
apt purge <pkg>             # drops conffiles too
apt autoremove --purge

# dpkg inspection
dpkg -l '<pkg>*'
dpkg -l | awk '/^.[^i]/ {print}'    # anything not fully installed
dpkg -L <pkg>                       # files owned
dpkg -S /path/to/file               # which package owns this
dpkg -c package.deb                 # contents before install

# Recovery
dpkg --configure -a
apt --fix-broken install
apt-get -f install

# Holds and pins
apt-mark hold <pkg>
apt-mark unhold <pkg>
apt-mark showhold
apt-config dump | grep -i unattended

# History
less /var/log/apt/history.log
less /var/log/dpkg.log
ls -lt /var/cache/apt/archives | head
```

Interactive work: `apt`. Scripts: `apt-get` with `-y` only when you have already solved the transaction in a change window.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `dpkg was interrupted` | Kill, full disk, session drop mid-configure | `df -h /var`; `dpkg --configure -a` |
| Unmet dependencies / `held broken packages` | Partial upgrade, conflict, hold | `apt-mark showhold`; `apt policy` |
| `NO_PUBKEY` / `EXPKEYSIG` / hash mismatch | Mirror, keyring, or MITM / stale cache | `apt update` full output; sources and keyrings |
| Package kept back | Hold, phasing (Ubuntu), or new deps | `apt policy`, `apt full-upgrade --dry-run` |
| Service dead after upgrade | `postinst` restart, conffile replaced | `dpkg.log`, `apt changelog`, journal |
| `Unable to locate package` | Wrong suite, component, or arch | `apt policy`, `dpkg --print-architecture` |
| `Could not get lock /var/lib/dpkg/lock` | Another apt/unattended-upgrades running | `lsof` the lock; `systemctl status unattended-upgrades` |
| Conffile mess | Local edit vs maintainer version | `/etc` vs `.dpkg-dist` / `.dpkg-old` |

## Investigation Tips

- Read the *first* dpkg error, not the last apt summary. The solver noise is downstream of one failed script.
- `apt policy <pkg>` is the fastest way to see why a version is (or is not) a candidate.
- After a failed run: `grep <pkg> /var/log/dpkg.log` and the matching block in `/var/log/apt/term.log`.
- Disk full on `/var` is a common reason configure dies halfway. Check space before you loop `dpkg --configure -a`.
- Ubuntu phased updates will "keep back" packages on some hosts. That is intentional; do not force them on prod during an incident unless you mean to.
- Third-party repos belong in `sources.list.d/` with an explicit pin. A desktop PPA on a server is how you get a surprise libc.
- Never `rm` files under `/var/lib/dpkg` to "unstick" it. That is how you get an unrecoverable database.

## Related Notes

- [[RPM and DNF]]
- [[Repository Troubleshooting]]
- [[Patching Strategy]]
- [[Major Version Upgrades]]
- [[Change Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> An unattended-upgrades run and a manual `apt full-upgrade` contended for the dpkg lock; the manual session was killed mid-postinst. The package sat in `iF` and blocked patching for two days. Check locks and `dpkg -l` for non-`ii` states before you start a change window.
>
> I have spent longer on a "missing package" than on the outage it caused. `apt policy` showed we were on the wrong component (`main` without `universe` / wrong suite). Confirm origin before you rebuild mirrors.
