# systemd-tmpfiles

## Concept

systemd-tmpfiles creates, deletes, and cleans files and directories according to declarative rules. It runs at boot (and on a timer) so that `/run`, `/tmp`, `/var/tmp`, and various volatile or aging paths exist with the right ownership and mode before services start.

Configuration lives in `/usr/lib/tmpfiles.d/`, `/etc/tmpfiles.d/`, and `/run/tmpfiles.d/`. A later file with the same name overrides an earlier one.

## Why it matters

- Services that expect a directory under `/run` or `/var/run` fail on a fresh boot if the tmpfiles snippet is missing or wrong. The unit starts, the process immediately exits with “No such file or directory”.
- Age-based cleanup (`e` and `E` type, or the `tmpfiles-clean` timer) removes files you thought were permanent. Logs, PID files, or application state under `/tmp` or `/var/tmp` disappear after the configured age.
- Permissions set by tmpfiles override what a package’s post-install or a manual `mkdir` did. A “it was 755 yesterday, 700 today” is often a tmpfiles rule.
- In containers and immutable images, tmpfiles is how you materialize the expected runtime layout without baking it into the image.

## Mental Model

```
Boot / timer
  → systemd-tmpfiles --create   (make missing paths, set owner/mode)
  → systemd-tmpfiles --clean    (age out old files)
  → systemd-tmpfiles --remove   (explicit remove types)

Rule line:
  Type Path Mode User Group Age Argument
  d    /run/myapp 0755 myapp myapp - -
  D    /run/myapp 0755 myapp myapp - -     # remove contents first
  e    /tmp 0755 root root 10d             # clean old files
  L    /var/run/foo - - - - /run/foo       # symlink
```

Types you will actually meet: `d`/`D` (directory), `f`/`F` (file), `L` (symlink), `e` (age-based clean), `x` (ignore), `X` (ignore path).

## Key Commands

```bash
# What would be done (dry-run)
systemd-tmpfiles --create --dry-run
systemd-tmpfiles --clean --dry-run

# Apply now
systemd-tmpfiles --create
systemd-tmpfiles --clean

# Which config files are in play
systemd-tmpfiles --cat-config
ls /usr/lib/tmpfiles.d /etc/tmpfiles.d /run/tmpfiles.d

# The timer that does periodic cleanup
systemctl status systemd-tmpfiles-clean.timer
systemctl list-timers systemd-tmpfiles-clean.timer

# Debug a specific path
grep -r /run/myapp /usr/lib/tmpfiles.d /etc/tmpfiles.d
```

Example drop-in `/etc/tmpfiles.d/myapp.conf`:

```
d /run/myapp 0755 myapp myapp -
d /var/lib/myapp 0750 myapp myapp -
e /var/tmp/myapp 0750 myapp myapp 7d
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service fails with “No such file or directory” on `/run/…` | Missing tmpfiles rule; directory never created | `ls /run/…`, `systemd-tmpfiles --create`, grep tmpfiles.d |
| Directory exists but wrong owner/mode | tmpfiles rule or later unit changes it | `systemd-tmpfiles --cat-config`, `ls -ld` |
| Files under `/tmp` or `/var/tmp` vanish | Age cleanup (`e` type or clean timer) | `systemctl status systemd-tmpfiles-clean.timer`, rule Age field |
| Manual `mkdir` overwritten on next boot | tmpfiles `D` or `d` resets it | grep the path in tmpfiles.d |
| Config change ignored | File in wrong directory or syntax error | `systemd-tmpfiles --create` output, journal |
| `/run` full | Something writing unbounded into a tmpfs | `df /run`, `du -x /run` |

## Investigation Tips

- When a service cannot find its runtime directory, check tmpfiles before you add an `ExecStartPre=/bin/mkdir`. The declarative rule is what survives the next image rebuild.
- `systemd-tmpfiles --create --dry-run` shows what would change without touching the system. Use it on a host that is already unhappy.
- The clean timer is easy to forget. If state disappears after N days, look at the Age column and the timer, not at the application.
- `/run` is tmpfs. It starts empty every boot. Anything that must exist there needs a tmpfiles rule or a unit that creates it.
- Prefer `/etc/tmpfiles.d/` for local policy so package updates do not clobber your rules.
- In a container, confirm the entrypoint or the base image actually runs systemd-tmpfiles (or an equivalent). Many minimal images do not.

## Related Notes

- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[Linux Boot Process]]
- [[journalctl Deep Dive]]
- [[File Descriptors]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A monitoring agent failed every boot with “cannot open /run/agent/agent.sock”. The unit had no RuntimeDirectory= and no tmpfiles snippet. Adding `RuntimeDirectory=agent` (which systemd turns into a tmpfiles rule) fixed it and made the dependency obvious.
- Application “temporary” files in `/var/tmp` were cleaned after 30 days by the default tmpfiles-clean timer. The app treated them as a cache that must persist. An explicit `e` rule with a longer age, or moving the cache under `/var/lib`, ended the mystery deletions.
- I created `/run/myapp` by hand during an incident, closed the ticket, and the next reboot failed again. The hand-created directory was gone. The tmpfiles rule is the permanent fix.
