# coredumpctl

## Concept

`coredumpctl` queries dumps captured by `systemd-coredump`. When a process dies on a fatal signal (usually SIGSEGV, SIGABRT, SIGBUS), the kernel writes a core according to `kernel.core_pattern`. On systemd hosts that pattern usually pipes to `systemd-coredump`, which stores a metadata record in the journal and the dump itself under `/var/lib/systemd/coredump` (or inside the journal, if configured).

A core is a snapshot of the process address space at death. It is evidence. It is also secrets, queries, and keys.

## Why it matters

- “The service restarted” without a dump is a crash you cannot root-cause
- `ulimit -c 0`, a tiny `ProcessSizeMax`, or a full `/var` silently discards the only artifact
- `coredumpctl gdb` is the shortest path from a PID to a backtrace when debuginfo exists
- Cores of databases and app servers are credential stores. Leaving them world-readable is an incident of its own

If the unit is `Restart=` looping, list dumps *before* you raise the restart limit or delete `/var/lib/systemd/coredump`.

## Mental Model

```
fatal signal
   │
   ▼
kernel.core_pattern = |/usr/lib/systemd/systemd-coredump …
   │
   ├─ journal fields: COREDUMP_PID, EXE, SIGNAL, UID, …
   └─ file: /var/lib/systemd/coredump/core.<exe>.<uid>.<boot>.<pid>.<time>
            (lz4/zstd, mode 0600, owned by root)

coredumpctl list | info | dump | gdb
limits: systemd-coredump.conf
   ProcessSizeMax, ExternalSizeMax, JournalSizeMax, Storage=, MaxUse=
```

`Storage=none` records the journal line and throws the core away. `Storage=journal` puts the payload in the journal (easy to fill). `Storage=external` is the usual server choice. `ulimit -c` / `LimitCORE=` is still applied: 0 means the kernel never calls the pattern.

Container crashes may be handled by the runtime (`--ulimit core=0` is a common Docker default) and never reach the host’s `coredumpctl`.

## Key Commands

```bash
# Did we capture anything?
coredumpctl list --no-pager
coredumpctl list /usr/sbin/nginx --since "1 hour ago" --no-pager

# Metadata without extracting the dump
coredumpctl info -1
coredumpctl info PID

# Journal view of the same event
journalctl -t systemd-coredump -S "1 hour ago" --no-pager
journalctl _UID=0 MESSAGE_ID=fc2e22bc6ee647b6b90729ab34a250b1 -n 5

# Extract or debug (debuginfo / debuginfod needed for names)
coredumpctl dump -1 -o /tmp/core.nginx
coredumpctl gdb -1

# Why capture failed
sysctl kernel.core_pattern
ulimit -c
systemctl show <unit> -p LimitCORE
cat /etc/systemd/coredump.conf /etc/systemd/coredump.conf.d/*.conf 2>/dev/null
df -h /var/lib/systemd/coredump
```

Enable a core for one service without flipping the host default:

```ini
[Service]
LimitCORE=infinity
```

Then `systemctl daemon-reload` and restart the unit. The process must start *after* the limit change.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Crash loop, `coredumpctl` empty | `LimitCORE=0`, pattern not systemd, container ulimit | `core_pattern`, unit `LimitCORE`, runtime flags |
| `info` exists, dump file missing | `Storage=none`, vacuum, or size cap | `coredump.conf`, `journalctl -u systemd-coredump` |
| Dump truncated / refused | `ProcessSizeMax` smaller than RSS | conf vs process RSS; raise only if disk allows |
| `/var` filled by cores | crash loop + `Storage=external` | list, stop the unit, vacuum, then debug one core |
| `gdb` shows `??` | no debuginfo | distro debuginfo package or debuginfod |
| Works from shell, not from systemd | different `LimitCORE` | `systemctl show -p LimitCORE`, `/proc/PID/limits` |
| Core of a setuid helper missing | `fs.suid_dumpable=0` | sysctl; do not enable blindly on shared hosts |
| SELinux denial on the pipe | policy blocked `systemd-coredump` | `ausearch -m avc -ts recent` |

## Investigation Tips

- `coredumpctl info` is the page-one artifact: exe, signal, uid, timestamp, cwd. Attach that to the ticket even if you cannot symbolise yet.
- Match the dump time to `journalctl -u` and to the deploy. A crash 30 seconds after restart is often the new binary, not “memory pressure”.
- SIGABRT is often an assert or a runtime abort (Go, glibc `abort()`), not a random segfault. SIGSEGV is the wild pointer. The signal changes who you call.
- Do not `coredumpctl gdb` a multi-gigabyte database core on the production box if disk and CPU are already hot. `dump -o` to somewhere with space, or copy off.
- Treat the file as secret. Mode `0600` is the default for a reason. Do not paste `strings core` into chat.
- `systemd-coredump` rate-limits repeated crashes. A tight `Restart=` loop can lose later dumps. Keep the first core; it is usually the same bug.
- After you have the backtrace, clean up. `coredumpctl` does not replace `journalctl --vacuum-size` and a delete of `/var/lib/systemd/coredump` once the files are copied.

## Related Notes

- [[journalctl Deep Dive]]
- [[journald and Persistent Storage]]
- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[Processes and Threads]]
- [[strace Deep Dive]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Java service “kept restarting” with an empty `coredumpctl` because the unit set `LimitCORE=0` and the JVM was also writing its own `hs_err_pid` log. I looked for cores and missed the hs_err file beside the jar. Check both.
- Raising `ProcessSizeMax` without a disk budget filled `/var` during a segfault loop and took journald with it. Cap `MaxUse=`, and stop the unit before you collect the third identical core.
- The useful backtrace was in the first dump. Later ones were the same frame after `Restart=always`. I only needed one.
