# systemd Units

## Concept

A unit is the object systemd schedules and supervises. The on-disk file (plus drop-ins) declares *what* should run, *when* relative to other units, and *what success looks like*. `systemctl` is how you inspect the merged result and change runtime state.

Vendor units live under `/usr/lib/systemd/system/`. Local policy belongs in `/etc/systemd/system/` and in drop-ins (`*.d/*.conf`). If you edit the vendor file in place, the next package update will fight you.

## Why it matters

- “Service will not start” is usually Type mismatch, a missing `After=`, a failed dependency, a bad `EnvironmentFile`, or a drop-in you forgot existed.
- Ordering (`After=` / `Before=`) is not the same as requirement (`Requires=` / `Wants=`). Confusing them produces races that only fail on fast hardware or after a reboot.
- `daemon-reload` is required after unit file changes. Without it you are debugging the previous generation of the file.
- Socket and timer units start services you never invoked by hand. If you only look at the `.service`, you miss the activator.

## Mental Model

```
unit file + drop-ins     systemctl cat
        ↓
merged properties        systemctl show
        ↓
job engine + deps        After/Before/Requires/Wants/Conflicts
        ↓
runtime process          cgroup, MainPID, status
```

Common types:

| Type | Role |
|------|------|
| `.service` | Process you actually care about |
| `.socket` | Listen first; spawn service on connect |
| `.timer` | Calendar / monotonic activation |
| `.target` | Sync point (`multi-user.target`, `network-online.target`) |
| `.mount` / `.automount` | Filesystem units (often generated from fstab) |
| `.path` | Start something when a path changes |
| `.slice` | cgroup resource bucket |

Dependency verbs:

- `Wants=` — start the other unit if possible; failure does not fail you.
- `Requires=` — if the other unit dies or will not start, you fail too. Easy to overuse.
- `After=` / `Before=` — order only. Does **not** pull the other unit in.
- `BindsTo=` — stronger than Requires; stop me if the other disappears.
- `Conflicts=` — cannot be active together.

`Type=` decides when systemd considers the service *started*:

| Type | “Ready” means |
|------|----------------|
| `simple` (default) | `ExecStart` is still running |
| `exec` | `ExecStart` successfully exec’d |
| `forking` | parent exits after daemonizing; set `PIDFile=` |
| `oneshot` | `ExecStart` exits; often `RemainAfterExit=yes` |
| `notify` | process sent `READY=1` via sd_notify |
| `idle` | like simple, delayed until jobs are quiet |

Wrong `Type=` is why you see “started” then immediate restart, or a forking daemon tracked as the wrong PID.

## Key Commands

```bash
# What systemd actually uses
systemctl cat sshd.service
systemctl show sshd.service -p Type,Restart,FragmentPath,DropInPaths,Requires,Wants,After
systemctl list-dependencies sshd.service
systemctl list-dependencies --reverse sshd.service

# State
systemctl status sshd.service
systemctl list-units --type=service --state=failed
systemctl is-enabled sshd.service
systemctl is-active sshd.service

# Safe local change
systemctl edit sshd.service                 # /etc/systemd/system/sshd.service.d/override.conf
systemctl edit --full sshd.service          # full copy in /etc
systemctl revert sshd.service               # drop local overrides
systemctl daemon-reload
systemctl restart sshd.service

# Syntax / dump
systemd-analyze verify /etc/systemd/system/myapp.service
systemd-analyze cat-config systemd/system/sshd.service

# Boot timing when units are the suspect
systemd-analyze blame
systemd-analyze critical-chain
systemd-analyze plot > /tmp/boot.svg

# Generated unit from a running process (starting point only)
systemd-run --unit=scratch --shell
```

Drop-in snippet pattern:

```ini
# /etc/systemd/system/myapp.service.d/override.conf
[Service]
Environment=ENV=prod
LimitNOFILE=65535
Restart=on-failure
RestartSec=3
```

After any file change: `daemon-reload`, then `restart` (or `try-reload-or-restart`).

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| `code=exited, status=203/EXEC` | Binary or script path wrong; no `+x` | `systemctl cat`, `ls -l` the ExecStart |
| `status=1/FAILURE` loop | App crashed; Restart= fighting you | `journalctl -u` the first crash, not the 40th |
| Changes ignored | No `daemon-reload`, or edited the unused copy | `systemctl cat`, `FragmentPath`, `DropInPaths` |
| Started before DNS / NIC ready | Missing `After=network-online.target` and a `Wants=` | `systemctl list-dependencies`, boot logs |
| `dependency failed` | Required unit failed or is masked | `list-dependencies`, `systemctl status` on the dep |
| Forking service “dead” but process lives | Wrong Type= or missing PIDFile | `systemctl show -p Type,PIDFile,MainPID` |
| Environment empty in process | `EnvironmentFile=` missing; `systemctl show` vs shell assumptions | `systemctl show -p Environment`; `/proc/PID/environ` |
| Masked unit will not enable | `systemctl mask` symlink to `/dev/null` | `ls -l /etc/systemd/system/foo.service` |
| Two units fight over one port | Old sysv service *and* native unit | `ss -lntp`, `systemctl list-units \| grep name` |

## Investigation Tips

- `systemctl cat` is the source of truth. Reading only `/usr/lib/systemd/system/foo.service` misses drop-ins.
- Prefer `systemctl edit` over vim on the vendor file. Package updates become boring again.
- `Requires=network.target` does not mean the network is up. For anything that talks off-box at start, `After=network-online.target` plus `Wants=network-online.target`, and know what “online” means on that distro (`NetworkManager-wait-online` vs `systemd-networkd-wait-online`).
- `Type=oneshot` without `RemainAfterExit=yes` looks inactive the moment the script ends. That breaks `Requires=` chains.
- `Restart=always` on a unit whose config is invalid pages forever. Cap with `StartLimitBurst=` / `StartLimitIntervalSec=` and fix the config.
- `systemctl disable --now` is not `mask`. Disabled means “do not start on this target”. Masked means “refuse to start even as a dependency”.
- When a timer or socket starts the service, debug the activator unit too (`foo.timer`, `foo.socket`).
- `systemd-analyze verify` catches a surprising number of typos before production.

## Related Notes

- [[systemctl Deep Dive]]
- [[journalctl Deep Dive]]
- [[systemd Timers]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I spent an hour editing `/usr/lib/systemd/system/nginx.service` on a host that already had an `/etc` override setting a different `ExecStart`. `systemctl cat` would have shown both. Now I `cat` first, always.
- A batch unit with `Type=simple` and a script that daemonized left systemd tracking the wrong PID. It killed the wrapper and left the real workers orphaned. `Type=oneshot` + `RemainAfterExit` (or a proper `notify` service) fixed the supervision model.
- Adding `After=network.target` did not stop a service from starting before DNS worked. `network.target` is “stack is up”, not “packets work”. `network-online.target` plus an actual wait-online service did.
- `Restart=always` on a unit pointing at a missing `EnvironmentFile=` produced a tight crash loop that filled the journal and the disk. Limits on start bursts belong in the unit the first time you set Restart.
