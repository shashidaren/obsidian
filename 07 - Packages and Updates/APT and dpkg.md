# APT and dpkg

## Concept

On Debian-family systems (Debian, Ubuntu, derivatives):

- **dpkg** is the low-level package manager (installs/removes `.deb` files, tracks database)
- **APT** (`apt`, `apt-get`, `apt-cache`) is the higher-level tool that resolves dependencies, talks to repositories, and calls dpkg

Understanding both layers is required when upgrades break or the package database becomes inconsistent.

## Why it matters

- Broken packages, held packages, and partial upgrades are common sources of “service won’t start after update”
- Repository misconfiguration or GPG/key problems block all further changes
- Mixing `apt` and manual `dpkg -i` without care can leave the system in a half-configured state

## Mental Model

```
Repositories (sources.list + .list files)
        ↓
APT cache / dependency solver
        ↓
dpkg database (/var/lib/dpkg)
        ↓
Files on disk + maintainer scripts (preinst, postinst, …)
```

APT decides *what* to install; dpkg performs the actual unpack and configuration.

## Key Commands

```bash
# Update index and upgrade
apt update
apt upgrade                 # safe, no new pkgs / removals
apt full-upgrade            # may remove packages to satisfy deps

# Search and show
apt search <name>
apt show <pkg>
apt policy <pkg>            # candidate version and origins

# Install / remove
apt install <pkg>
apt remove <pkg>            # leaves config
apt purge <pkg>             # removes config too
apt autoremove              # unused dependencies

# dpkg level
dpkg -l | grep <pkg>        # list installed
dpkg -L <pkg>               # files owned by package
dpkg -S /path/to/file       # which package owns this file
dpkg --configure -a         # finish interrupted configures
dpkg -i package.deb         # install local deb (then apt -f install)

# Fix broken state
apt --fix-broken install
apt -f install

# Holds
apt-mark hold <pkg>
apt-mark unhold <pkg>
apt-mark showhold
```

Prefer `apt` over raw `apt-get` for interactive use; scripts often still use `apt-get` for stability of output.

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                              |
|--------------------------------------|-------------------------------------------|-------------------------------------------|
| `dpkg was interrupted` / half-configured | Crash or kill during configure         | `dpkg --configure -a`                     |
| Unmet dependencies                   | Partial upgrade or conflicting pkgs       | `apt --fix-broken install`               |
| Hash sum mismatch / NO_PUBKEY        | Mirror or key problem                     | `apt update` output, `/etc/apt/sources*`  |
| Package held back                    | Explicit hold or phasing                  | `apt-mark showhold`, `apt policy`         |
| Service broken after upgrade         | Maintainer script or config change        | `apt changelog <pkg>`, journal, configs   |
| “Unable to locate package”           | Wrong suite / component / arch            | `apt policy`, sources.list                |

## Investigation Tips

- After any failed `apt` run, read the full error — it usually names the conflicting package or the exact dpkg failure.
- `apt policy <pkg>` quickly shows which version is candidate and from which repository.
- When a package is “broken”, `dpkg -l | grep ^..r` (or similar) and `dpkg --configure -a` are the first recovery steps.
- Avoid `apt full-upgrade` on production without a tested change window and rollback plan.
- Keep `/etc/apt/sources.list` and files under `sources.list.d/` under configuration management.

## Related Notes

- [[RPM and DNF]]
- [[Repository Troubleshooting]]
- [[Patching Strategy]]
- [[Major Version Upgrades]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
