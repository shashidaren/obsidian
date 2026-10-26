# systemd Service Hardening

## Concept

systemd unit hardening directives reduce the damage a compromised or buggy service can do. They are declarative sandbox settings (`ProtectSystem=`, `PrivateTmp=`, `NoNewPrivileges=`, `RestrictNamespaces=`, etc.) applied by systemd before `ExecStart`.

They are not a substitute for a correct SELinux/AppArmor policy, but they are faster to apply and catch a large class of accidental or malicious escapes.

## Why it matters

- A service that can write anywhere, open raw sockets, or load kernel modules turns a single RCE into a host compromise.
- Many “it works when I run it as root from the shell but fails under systemd” tickets are hardening directives you forgot about.
- Adding hardening after the fact is cheap; discovering the missing directives during an incident is not.
- Drop-ins let you harden a vendor unit without fighting package updates.

## Mental Model

```
[Service]
ProtectSystem=strict          # /usr, /boot, /efi read-only
ProtectHome=yes               # hide /home, /root
PrivateTmp=yes                # private /tmp and /var/tmp
NoNewPrivileges=yes           # no setuid, no new caps
RestrictNamespaces=yes        # no unshare / clone new ns
RestrictRealtime=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes    # no W+X mappings (breaks some JITs)
SystemCallFilter=@system-service  # or a tighter list
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=
```

Start strict, then relax only what the service actually needs. `systemd-analyze security` scores the unit and lists the missing protections.

## Key Commands

```bash
# Score and recommendations
systemd-analyze security foo.service
systemd-analyze security --json=pretty foo.service | jq .

# What is actually applied
systemctl show foo.service -p ProtectSystem,PrivateTmp,NoNewPrivileges,RestrictNamespaces,SystemCallFilter,CapabilityBoundingSet

# Safe local hardening
systemctl edit foo.service
# then daemon-reload && restart

# See the merged unit
systemctl cat foo.service
```

Example drop-in for a typical network service:

```ini
# /etc/systemd/system/myapp.service.d/hardening.conf
[Service]
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service fails with “Permission denied” on /etc or /usr | `ProtectSystem=strict` and it needs to write | `systemd-analyze security`, journal, relax to `full` or use `ReadWritePaths=` |
| Cannot see /home or user files | `ProtectHome=yes` | Explicit `BindPaths=` or `ProtectHome=read-only` |
| Temp files missing or shared unexpectedly | `PrivateTmp=` mismatch | Check both units; each gets its own tmp |
| setuid helper fails | `NoNewPrivileges=yes` | Remove it only if the helper is required and audited |
| JIT / Java / Node crashes | `MemoryDenyWriteExecute=yes` | Disable for that unit; it breaks W+X |
| “Operation not permitted” on mount/unshare | `RestrictNamespaces=yes` | Expected; do not disable unless the service is a container runtime |
| Score looks good but process still root | Hardening ≠ dropping root | Still set `User=` and `DynamicUser=` or a static user |

## Investigation Tips

- Run `systemd-analyze security` before and after your drop-in. The score is a guide, not a goal; some services cannot be fully locked down.
- Prefer `ReadWritePaths=` / `ReadOnlyPaths=` / `BindPaths=` over turning a Protect* directive off entirely.
- `DynamicUser=yes` gives a transient UID/GID and is excellent for services that do not need a stable user. It pairs well with `StateDirectory=` and `CacheDirectory=`.
- After adding `SystemCallFilter=`, watch the journal for `status=31/SYS` or similar; that is a blocked syscall. Use `strace -e` or `systemd-analyze syscall-filter` to see the set.
- Hardening that breaks the service in CI is better than hardening that breaks it at 3 a.m. Test the exact drop-in.
- Vendor units sometimes already ship hardening. `systemctl cat` before you add more.

## Related Notes

- [[systemd Units]]
- [[Linux Capabilities]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[sysctl and Resource Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A web service that “randomly” failed to write its cache was `ProtectSystem=strict` plus a path under `/usr/local`. `ReadWritePaths=/var/cache/myapp` fixed it without opening the whole filesystem.
- `MemoryDenyWriteExecute=yes` took down a Java service on the next restart. The directive is correct for most C services and wrong for most JITs. Check the runtime before you copy-paste hardening snippets.
- I used to disable `NoNewPrivileges` to make a helper work. The real fix was to drop the setuid helper and let the service bind the low port via `AmbientCapabilities=CAP_NET_BIND_SERVICE`.
