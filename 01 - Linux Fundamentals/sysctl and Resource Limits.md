# sysctl and Resource Limits

## Concept

Two different knobs get called “limits”:

- **sysctl** — kernel parameters in `/proc/sys`, persisted in `/etc/sysctl.conf` or `/etc/sysctl.d/*.conf`. They apply to the kernel (queues, VM behaviour, system-wide file table), not to one service.
- **rlimits** — per-process ceilings (`RLIMIT_NOFILE`, `RLIMIT_NPROC`, core, memlock, …). Inherited at exec. For a daemon the setter is systemd (`LimitNOFILE=`, `LimitNPROC=`), not your shell and not `limits.conf`.

`/etc/security/limits.conf` is read by PAM (`pam_limits`) at login. A unit started by systemd never goes through PAM. Editing `limits.conf` and restarting the unit changes nothing.

## Why it matters

- “Too many open files” after a deploy is usually the unit’s `LimitNOFILE`, not `fs.file-max`.
- A listen backlog of 128 (`somaxconn` default on older kernels, or the app’s own `listen()` backlog) drops SYNs under a burst while CPU looks idle.
- `vm.swappiness` does not turn swap off. It biases reclaim. Setting it to 0 and expecting no swap is how people get an OOM instead of a slowdown.
- `tcp_tw_reuse` is a narrow knob for outbound clients that exhaust ephemeral ports. It is not a fix for `CLOSE-WAIT`, and it is unsafe to cargo-cult onto a server that does not need it.
- Containers add a third layer: the cgroup and the runtime’s ulimit can be tighter than both sysctl and the unit file.

## Mental Model

```
kernel sysctl                 /proc/sys/fs/file-max, net.core.somaxconn, vm.swappiness
        ↓
process rlimit                /proc/PID/limits   ← the number that actually fires
        ↑
set by whoever exec'd it
  ssh/sudo/login  → PAM → limits.conf
  systemd unit    → LimitNOFILE / LimitNPROC in the unit or drop-in
  container       → runtime ulimit, often DefaultLimitNOFILE
  shell you typed → ulimit -n   (does not affect the service)
```

`fs.file-max` is the system-wide file table. `fs.nr_open` caps how high a single process may raise `RLIMIT_NOFILE`. Soft limit is what `open()` hits (`EMFILE`). Hard limit is what an unprivileged process can raise itself to.

`somaxconn` caps the accept queue passed to `listen()`. The application’s backlog argument is the other cap. The effective queue is the minimum of the two.

## Key Commands

```bash
# What this process is actually allowed — start here
cat /proc/<PID>/limits
ls /proc/<PID>/fd | wc -l
systemctl show <unit> -p LimitNOFILE -p LimitNPROC -p LimitCORE

# Shell limits (usually irrelevant to the daemon)
ulimit -n
ulimit -Hu

# System-wide file table
cat /proc/sys/fs/file-nr     # allocated, unused, max
cat /proc/sys/fs/file-max
cat /proc/sys/fs/nr_open

# Sysctl live vs configured
sysctl net.core.somaxconn vm.swappiness net.ipv4.tcp_tw_reuse fs.file-max
sysctl --system              # apply /etc/sysctl.d (careful on a live box)
sysctl -w net.core.somaxconn=4096

# Where the value came from
grep -R somaxconn /etc/sysctl.d /etc/sysctl.conf 2>/dev/null
systemctl cat <unit> | grep -i Limit
grep -R nofile /etc/security/limits.conf /etc/security/limits.d 2>/dev/null

# Listen overflow (backlog too small or app not accepting)
nstat -az | grep -E 'ListenOverflows|ListenDrops'
ss -lnt
```

Unit drop-in that actually changes the daemon:

```ini
# /etc/systemd/system/myapp.service.d/limits.conf
[Service]
LimitNOFILE=65535
LimitNPROC=4096
```

Then `systemctl daemon-reload` and restart the unit. Confirm with `/proc/<new-pid>/limits`, not with `ulimit`.

`vm.swappiness=10` (or 1) is a reasonable bias on a database host that should prefer dropping cache over anonymous swap. It is not a memory fix. `swappiness=0` still swaps to avoid OOM on modern kernels.

`net.ipv4.tcp_tw_reuse=1` only helps a client that is burning ephemeral ports (`ss -s` TIME-WAIT huge, connect() `EADDRNOTAVAIL`). It does not reap `CLOSE-WAIT`. Those are the application’s sockets.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Too many open files` right after unit restart | systemd ignored `limits.conf` | `/proc/PID/limits` vs `systemctl show -p LimitNOFILE` |
| Interactive user is fine, service is not | PAM vs unit | `ulimit -n` in ssh vs the service PID |
| `EMFILE` vs `ENFILE` | process rlimit vs `fs.file-max` | `limits` vs `file-nr` |
| SYNs dropped, CPU idle | accept queue | `ListenOverflows`, `somaxconn`, app backlog |
| Raised sysctl, process still capped | rlimit still low, or app cached the value at start | restart after the knob; re-read `/proc/PID/limits` |
| `tcp_tw_reuse` “did nothing” | problem was `CLOSE-WAIT` or a leak | `ss -antp` state counts |
| Box swaps, swappiness already 0 | anonymous pressure, not the sysctl | MemAvailable, RSS, si/so |
| Container dies, host limits look fine | runtime ulimit / cgroup | `/proc/1/limits` *inside* the container |
| Change vanished after reboot | `sysctl -w` only, no file in `sysctl.d` | `sysctl --system` dry-run contents |
| `nr_open` rejects a huge LimitNOFILE | hard cap below the unit value | `fs.nr_open` |

## Investigation Tips

- Read `/proc/<PID>/limits` for the PID that logged the error. Parent and child can differ if a process called `setrlimit` or if a thread was forked before the drop-in.
- systemd default `LimitNOFILE` changed across versions (1024, 4096, or a very high default). Do not assume the distro default matches the wiki you read.
- `limits.conf` still matters for SSH-started workers, cron on some setups, and `sudo -i`. It does not matter for `Type=simple` units. Check both if you are unsure how the process was started: `tr '\0' '\n' < /proc/PID/environ` and the parent PID.
- Apply sysctl in `/etc/sysctl.d/99-local.conf` with a comment that names the incident. `sysctl -w` alone will not survive reboot.
- `somaxconn` only takes effect for `listen()` calls made *after* the change. Restart the listener.
- Do not set `tcp_tw_reuse` on a public-facing server to “clean TIME-WAIT”. TIME-WAIT on the server is normal and protects against old segments. Fix client port exhaustion where it actually is.
- `fs.file-max` defaults are already huge. If you are raising it, you are probably looking at the wrong ceiling.

## Related Notes

- [[File Descriptors]]
- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[Memory Management]]
- [[Swap and OOM Killer]]
- [[PAM]]
- [[ss Deep Dive]]
- [[lsof Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Nginx “ignored” a `nofile` line in `limits.conf` for a year. The unit had no `LimitNOFILE`. `/proc/$(pidof nginx)/limits` showed 1024. A drop-in fixed it; the limits.conf line is still there, still useless for that service.
- I raised `somaxconn` and the overflows continued until the app was restarted. It had called `listen(fd, 128)` at start and never looked at the sysctl again.
- `tcp_tw_reuse=1` was on a fleet image as folklore. The actual failure was `CLOSE-WAIT` from an app that never closed. The sysctl was a distraction in the ticket.
