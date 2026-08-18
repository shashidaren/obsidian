# systemd Units

## Concept

A **unit** is the basic object systemd manages. Common types include:

| Type       | Extension   | Purpose                              |
|------------|-------------|--------------------------------------|
| Service    | `.service`  | Long-running processes               |
| Socket     | `.socket`   | Socket activation                    |
| Timer      | `.timer`    | Time-based activation (cron replacement) |
| Target     | `.target`   | Grouping / synchronization points    |
| Mount      | `.mount`    | Filesystem mounts                    |
| Path       | `.path`     | Path-based activation                |

## Why it matters

Understanding unit types, dependencies, and ordering is key to diagnosing why a service fails to start or starts in the wrong order.

## Mental Model

```
Unit file (and drop-ins)
    ↓
systemd reads & activates
    ↓
Dependencies (Requires, Wants, After, Before)
    ↓
Service runs (or fails)
```

Drop-in files (`/etc/systemd/system/<unit>.d/*.conf`) let you override parts of a unit without editing the original file.

## Key Commands

```bash
# List unit files and their state
systemctl list-unit-files --type=service

# Show effective unit content (including drop-ins)
systemctl cat <unit>

# Show all properties
systemctl show <unit>

# Dependencies
systemctl list-dependencies <unit>
systemctl list-dependencies --reverse <unit>

# Edit a drop-in safely
systemctl edit <unit>                # creates override.conf
systemctl edit --full <unit>         # full copy

# After changing unit files
systemctl daemon-reload
```

## Important Directives (service units)

```
[Unit]
Description=
After= / Before=
Requires= / Wants=

[Service]
Type=simple|forking|oneshot|notify
ExecStart=
ExecReload=
Restart=on-failure|always
Environment=
EnvironmentFile=
LimitNOFILE=

[Install]
WantedBy=multi-user.target
```

## Common Failure Modes & Symptoms

| Symptom                          | What to look at                          |
|----------------------------------|------------------------------------------|
| Unit fails to start              | `systemctl status`, `journalctl -u`      |
| Changes have no effect           | Did you run `daemon-reload`? Drop-ins?   |
| Starts too early / too late      | `After=` / `Before=` dependencies        |
| Fails because of missing dependency | `Requires=` vs `Wants=`               |
| Environment variables missing    | `Environment=` / `EnvironmentFile=`      |

## Investigation Tips

- Always check `systemctl cat <unit>` to see the real effective configuration.
- Prefer drop-ins (`systemctl edit`) over modifying vendor unit files.
- `Type=notify` and `Type=forking` behave very differently from `Type=simple` — wrong type is a common cause of startup issues.
- Use `systemd-analyze blame` and `systemd-analyze critical-chain` when investigating slow boots.

## Related Notes

- [[systemctl Deep Dive]]
- [[journalctl Deep Dive]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
