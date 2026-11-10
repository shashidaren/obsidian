# systemd Service Hardening

## Concept

systemd can confine a service with a set of directives that drop privileges, restrict namespaces, system calls, filesystem access, and network. These are not a full MAC (see SELinux/AppArmor) but they are effective, easy to audit, and available on every systemd host.

The goal is “this unit can only do what it needs”, so a compromise has a smaller blast radius.

## Why it matters

- A vulnerable web app or agent running as root with full filesystem and network access is a gift to an attacker.
- Hardening directives are declarative and version-controlled with the unit file.
- `systemd-analyze security` gives a quick score and lists the missing protections.

## Mental Model

```
unit file
  → User=/DynamicUser=
  → ProtectSystem=, ProtectHome=, PrivateTmp=
  → NoNewPrivileges=, RestrictSUIDSGID=
  → SystemCallFilter= (see [[Seccomp and SystemCallFilter]])
  → RestrictAddressFamilies=, IPAddressDeny=
  → CapabilityBoundingSet=, AmbientCapabilities=
```

Start with the easy wins (`NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`) and tighten from there.

## Key Commands

```bash
# Score and suggestions
systemd-analyze security nginx.service
systemd-analyze security --json=pretty nginx.service | less

# What the running service actually has
systemctl show nginx.service -p User -p ProtectSystem -p NoNewPrivileges -p SystemCallFilter

# Drop-in for local hardening
systemctl edit nginx.service
# then
systemctl daemon-reload && systemctl restart nginx.service
```

Useful directives (non-exhaustive):

- `User=`, `Group=`, `DynamicUser=yes`
- `NoNewPrivileges=yes`
- `ProtectSystem=strict` (or `full`), `ProtectHome=yes`
- `PrivateTmp=yes`, `PrivateDevices=yes`
- `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectControlGroups=yes`
- `RestrictSUIDSGID=yes`, `LockPersonality=yes`
- `SystemCallArchitectures=native`
- `RestrictNamespaces=yes` (or a allow-list)
- `RestrictAddressFamilies=AF_INET AF_INET6`
- `IPAddressDeny=any` + `IPAddressAllow=...` for egress control

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service fails to start after hardening | Too strict ProtectSystem or missing ReadWritePaths | journalctl -u, add ReadWritePaths= |
| Cannot write pid/log file | ProtectSystem=strict without exception | ReadWritePaths=/var/log/... |
| DNS or outbound fails | RestrictAddressFamilies or IPAddressDeny | relax AF_UNIX or allow needed nets |
| `systemd-analyze security` still red | Missing NoNewPrivileges or SystemCallFilter | add the easy ones first |
| Works in shell, fails in unit | Different environment / capabilities | systemctl show, compare to manual run |

## Investigation Tips

- Run `systemd-analyze security UNIT` before and after changes. Aim to move the score, not to reach 0 at the cost of operability.
- Use a drop-in (`systemctl edit`) so package updates do not overwrite your hardening.
- If the service needs to write somewhere under `/usr` or `/etc`, prefer `ReadWritePaths=` over relaxing `ProtectSystem`.
- Test the hardened unit in a non-prod environment or with a temporary `SuccessExitStatus=` while you iterate.
- Combine with `[[Seccomp and SystemCallFilter]]` and, where available, SELinux/AppArmor for defense in depth.

## Related Notes

- [[Seccomp and SystemCallFilter]]
- [[systemd Units]]
- [[Linux Capabilities]]
- [[Namespaces and cgroups]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A monitoring agent was running as root with no restrictions. After a supply-chain incident we added `DynamicUser=yes`, `ProtectSystem=strict`, `NoNewPrivileges=yes` and a tight `SystemCallFilter`. The same binary continued to work; the blast radius shrank dramatically.
- `ProtectSystem=strict` broke a service that wrote its own binary updates into `/usr/lib`. The fix was a dedicated `ReadWritePaths=` for that directory plus a longer-term move to a proper package, not disabling the protection.
