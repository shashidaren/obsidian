# systemd Units

## Concept

A unit is systemd’s unit of work: a service, a socket, a timer, a mount, a path, a slice, a scope, or a target. Units are described by unit files (and drop-ins) and are started, stopped, and ordered by the job engine.

Transient units created with `systemd-run` are units too; they just live in `/run` and disappear on reboot. See [[systemd-run and Transient Units]].

## Why it matters

- Almost every daemon, mount, and scheduled job on a modern system is a unit
- Ordering and dependency bugs (`After=`, `Requires=`, `Wants=`) are a common source of “it works on boot but not on restart”
- Resource controls (`LimitNOFILE=`, `MemoryMax=`, `CPUQuota=`) only apply if the process is actually in the unit’s cgroup
- Drop-ins in `/etc/systemd/system/<unit>.d/` override packaged files without editing them
- A failed unit can block a target and leave the system in a partial state

## Mental Model

```
unit file + drop-ins
    → loaded into the manager
    → job (start/stop/reload)
    → cgroup + process tree
    → state (active/inactive/failed/activating)
```

`systemctl cat <unit>` shows the merged result. `systemctl show <unit>` shows the runtime properties. The file on disk is not always what is running.

## Key Commands

```bash
systemctl status <unit>
systemctl cat <unit>
systemctl show <unit> -p FragmentPath -p DropInPaths -p ActiveState
systemctl list-dependencies <unit>
systemctl list-unit-files --state=enabled
systemctl daemon-reload
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Change to unit file ignored | No daemon-reload | `systemctl daemon-reload` |
| Drop-in not applied | Wrong directory or filename | `systemctl cat` |
| Unit fails on boot only | Ordering / dependency | `systemctl list-dependencies`, journal |
| Resource limit not hit | Process not in the unit cgroup | `/proc/PID/cgroup`, `systemctl status` |
| Transient unit missing after reboot | By design | recreate with `systemd-run` |

## Investigation Tips

- Always `systemctl cat` before you edit. The effective config may already contain a drop-in you did not know about.
- `journalctl -u <unit> -b` is the first place to look for start failures.
- For resource questions, confirm the PID is inside the unit’s cgroup before you blame `LimitNOFILE`.

## Related Notes

- [[systemctl Deep Dive]]
- [[systemd-run and Transient Units]]
- [[sysctl and Resource Limits]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “LimitNOFILE did nothing” ticket was a process started by a script that then daemonized out of the cgroup. The unit’s cgroup was empty. `systemd-run --scope` or a proper Type=forking/notify unit fixed the accounting.
