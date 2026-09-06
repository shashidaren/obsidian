# systemctl Deep Dive

## Concept

`systemctl` is the control plane for systemd: inspect units, change runtime state, enable boot behaviour, and read the *effective* unit text after drop-ins.

It is not the logger (`journalctl`), and it is not the unit authoring tool (`systemd-analyze`, an editor). Most incidents need `status` + `cat` + `journalctl -u` in that order.

A unit can be: loaded or not, active or not, enabled or not. Those three axes are independent. “Enabled” does not mean “running”. “Running” does not mean it will survive a reboot.

## Why it matters

- Almost every service you touch on a modern distro is a unit
- Failed units after patching are the difference between a quiet reboot and a two-hour incident
- Drop-in files silently override vendor units; if you only read `/usr/lib/systemd/system/foo.service` you are reading fiction
- `restart` is not diagnosis. It clears evidence and often masks a crash loop for one more interval

## Mental Model

```
vendor unit     /usr/lib/systemd/system/foo.service
admin unit      /etc/systemd/system/foo.service          ← replaces vendor
drop-ins        /etc/systemd/system/foo.service.d/*.conf ← merge on top
runtime         /run/systemd/system/                     ← tmp, gone on reboot

systemctl cat foo          ← what systemd actually uses
systemctl show foo         ← flattened properties
systemctl status foo       ← state + last log lines
```

States worth memorising:

| ActiveState | Typical meaning |
|-------------|-----------------|
| `active (running)` | Main PID alive |
| `active (exited)` | Type=oneshot finished; often normal |
| `active (waiting)` | Idle, waiting on a job |
| `inactive` | Stopped |
| `failed` | Entered failed (exit code, timeout, watchdog) |
| `activating` / `deactivating` | Transition; if stuck, look at `Type=` and ExecStart |

`enabled` vs `disabled` vs `static` vs `masked` is boot policy, not current health. `masked` is “cannot start, even by hand” — a symlink to `/dev/null`.

## Key Commands

```bash
# Failed units this boot — first command on a sick box
systemctl --failed
systemctl list-units --state=failed

# The working set
systemctl status foo.service
systemctl cat foo.service
systemctl show foo.service -p Id,LoadState,ActiveState,SubState,MainPID,NRestarts,FragmentPath,DropInPaths,Result,ExecMainStatus

# Logs (do this before another restart)
journalctl -u foo.service -b --no-pager
journalctl -u foo.service -e -o short-iso

# Dependencies and what pulled it in
systemctl list-dependencies foo.service
systemctl list-dependencies --reverse foo.service
systemctl show foo.service -p WantedBy,RequiredBy,After,Before

# Boot vs now
systemctl is-enabled foo.service
systemctl is-active foo.service
systemctl is-failed foo.service

# Change runtime / boot
systemctl daemon-reload                 # after any unit file or drop-in edit
systemctl restart foo.service
systemctl reload foo.service            # only if ExecReload= exists
systemctl try-restart foo.service       # no-op if not running
systemctl enable --now foo.service
systemctl disable --now foo.service
systemctl mask foo.service              # nuclear; remember to unmask

# Drop-in without fighting the package manager
systemctl edit foo.service              # creates /etc/systemd/system/foo.service.d/override.conf
systemctl revert foo.service            # remove drop-ins systemctl edit created

# Inventory
systemctl list-unit-files --type=service
systemctl list-units --type=service --state=running
systemctl list-timers --all
systemctl list-sockets --all
```

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks |
|---------|---------------|--------------|
| `Unit not found` | Wrong name, not installed, or alias | `list-unit-files \| grep -i foo` |
| Starts then `failed` | ExecStart exits non-zero, missing file, bad user | `status`, journal, `echo $?` from a manual run |
| `start-limit-hit` | Crash loop; systemd stopped retrying | `show -p NRestarts,StartLimit*` |
| Config change ignored | No `daemon-reload`, or edited the vendor copy | `cat`, `DropInPaths` |
| `inactive (dead)` after enable | Enabled for next boot, never started | `enable --now` |
| `active (exited)` and “not running” | oneshot; looking at the wrong unit | `Type=` in `cat` |
| Timeout on start | `Type=notify` but app never notifies; or slow disk | `TimeoutStartUSec`, Type |
| Masked and you forgot | Earlier incident containment | `is-enabled`, `ls -l /etc/systemd/system/foo.service` |
| Works until reboot | Runtime change under `/run`, or no enable | `is-enabled` |

## Investigation Tips

- After editing anything under `/etc/systemd`, `daemon-reload` is not optional. Forgetting it is the number one “I changed the file and nothing happened” cause.
- Read `systemctl cat`, not the file you think is loaded. Packages ship drop-ins too.
- `Result=` and `ExecMainStatus=` from `show` beat guessing. Status 203 often means the binary path is wrong or `NoNewPrivileges`/`User=` cannot exec.
- `systemctl restart` on a crash-looping unit resets the start counter and burns the previous logs out of your short-term memory. Snapshot the journal first.
- Prefer `systemctl edit` over copying the vendor unit into `/etc/systemd/system/`. A full override will not pick up package fixes.
- `systemctl reset-failed` clears the red state without fixing anything. Use it after you understand the failure, not instead of understanding it.
- For “who started this?” use `--reverse` dependencies and `systemd-analyze critical-chain`.

## Related Notes

- [[systemd Units]]
- [[systemd Timers]]
- [[journalctl Deep Dive]]
- [[systemctl Command Reference]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A nginx “restart did nothing” was an override setting `ExecStart=` without clearing the old `ExecStart` first. Drop-ins *add* Exec lines unless you put `ExecStart=` empty above the new one. `systemctl cat` showed two ExecStart lines immediately.
- `active (exited)` on a oneshot “app service” wasted half an hour. The long-running process was a different unit pulled in by a target.
- Masking `unattended-upgrades` during an incident and forgetting to unmask produced a quiet security hole for a month. Mask is sticky. Ticket it.
