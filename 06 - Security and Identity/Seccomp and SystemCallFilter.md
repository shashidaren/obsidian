# Seccomp and SystemCallFilter

## Concept

Seccomp restricts the set of system calls a process is allowed to make. systemd exposes this as the `SystemCallFilter=` unit directive, which installs a seccomp-bpf filter before `ExecStart`. Disallowed calls fail (or kill the process) instead of executing.

## Why it matters

- A service that can call `mount`, `ptrace`, `kexec_load`, `unshare` or `bpf` turns a single remote code execution into a much larger incident.
- "Permission denied" or immediate exit with status 31/SYS after you add hardening is frequently a filtered syscall, not a file permission or capability problem.
- It is one of the cheapest high-value controls you can add to a unit without writing a full SELinux or AppArmor policy.

## Mental Model

```
systemd
  → installs seccomp-bpf from SystemCallFilter=
      → process image starts
          → only listed syscalls succeed
              → others return EPERM (if configured) or the process is killed
```

`@system-service` is a curated allow-list suitable for most ordinary daemons. You can also deny specific groups (`~@privileged`) or list individual calls.

## Key Commands

```bash
# What the unit actually has
systemctl show foo.service -p SystemCallFilter,SystemCallArchitectures,SystemCallErrorNumber

# Recommendations and current score
systemd-analyze security foo.service
systemd-analyze syscall-filter

# Journal evidence of a blocked call
journalctl -u foo.service -b --no-pager | grep -E 'seccomp|syscall|status=31'

# Temporary confirmation (dev/test only)
# comment out SystemCallFilter=, daemon-reload, restart, see if it works
```

Minimal drop-in:

```ini
# /etc/systemd/system/foo.service.d/syscall.conf
[Service]
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
SystemCallArchitectures=native
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Unit enters failed state immediately, status 31/SYS | Startup path uses a filtered syscall | journalctl -u , temporarily remove filter |
| Works when started from a shell, fails under systemd | Filter only applied by the unit | `systemctl show -p SystemCallFilter` |
| Language runtime (Go, Java, Node) crashes after filter added | Needs extra calls (clone3, newer futex, etc.) | journal for the exact syscall; add it explicitly |
| "Operation not permitted" on an expected call | Filter too tight or wrong architecture | SystemCallArchitectures, error number setting |
| Nested container or user namespace fails | Filter blocks `unshare`/`clone` | expected for non-runtime services; do not loosen globally |

## Investigation Tips

- Begin with `SystemCallFilter=@system-service`. It is the set most daemons already fit.
- Set `SystemCallErrorNumber=EPERM` while you are tuning. A clean EPERM in the journal or in strace is easier to diagnose than a killed process.
- When a service breaks, remove the filter, confirm the service is healthy, then re-add and watch the journal for the blocked syscall name. Add only that call (or the smallest group that contains it).
- `SystemCallArchitectures=native` prevents the process from switching to a 32-bit or foreign ABI to escape the filter.
- Test the exact drop-in in CI or a staging unit. A filter that works for one Go version may fail on the next.
- Combine with `NoNewPrivileges=yes`, capability bounding, and `ProtectSystem=` — they cover different escape paths.

## Related Notes

- [[systemd Service Hardening]]
- [[Linux Capabilities]]
- [[SELinux Deep Dive]]
- [[AppArmor]]
- [[strace Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Go binary started failing only after I enabled `@system-service`. The journal (with `SystemCallErrorNumber=EPERM`) named `clone3`. Adding that single call restored service without opening the rest of the privileged set.
- I once commented out a SystemCallFilter during an incident and never restored it. The next compliance scan flagged the unit. The filter now lives in the same drop-in file as the other hardening directives and is part of the service's tested configuration.
