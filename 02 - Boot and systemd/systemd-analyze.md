# systemd-analyze

## Concept

`systemd-analyze` reports how long the system took to reach various targets and which units contributed the most time. `blame` ranks units by time spent; `critical-chain` shows the longest path of dependencies that delayed the boot.

It is the fastest way to answer "why did this host take 4 minutes to come up after the reboot?"

## Why it matters

- A slow boot is often one unit waiting on a network mount, a timeout, or a serial console that never appears.
- After a kernel or package update, boot time can regress because a new unit or a changed dependency was introduced.
- Cloud instances with user-data or cloud-init can add tens of seconds; knowing which unit owns the time prevents blaming the wrong layer.
- Emergency and rescue targets are visible here when the default target never finishes.

## Mental Model

```
firmware + bootloader + kernel + initramfs
        ↓
systemd starts default.target
        ↓
units with After=/Wants=/Requires= form a graph
        ↓
critical-chain = longest path to the target
blame = individual unit activation time
```

A unit can appear high in `blame` without being on the critical chain if it runs in parallel.

## Key Commands

```bash
# Overall times
systemd-analyze
systemd-analyze time

# Which units took longest
systemd-analyze blame

# Dependency path that actually delayed the target
systemd-analyze critical-chain
systemd-analyze critical-chain multi-user.target

# Plot (SVG) for a visual
systemd-analyze plot > boot.svg

# Security and other audits (secondary)
systemd-analyze security <unit>
systemd-analyze verify /etc/systemd/system/*.service

# Compare boots
journalctl --list-boots
systemd-analyze blame   # on current vs previous if you captured it
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Boot > 2 min, most time in one unit | Network mount, cloud-init, or serial getty | `critical-chain`, that unit's journal |
| `network-online.target` high | DHCP or a unit that Requires=network-online | `systemctl status systemd-networkd` / NetworkManager |
| fstab entry without `_netdev` or `nofail` | Local-fs target blocked | `systemctl status local-fs.target` |
| Same unit slow every boot | Timeout waiting for something that never arrives | Unit logs, `TimeoutStartSec` |
| Fast on bare metal, slow in cloud | cloud-init, metadata service, or volume attach | `cloud-init status`, serial console |
| blame shows many small units | Normal parallel start; look at critical-chain instead | critical-chain |

## Investigation Tips

- Run `systemd-analyze` and `critical-chain` first. `blame` alone can mislead because parallel units are not on the critical path.
- Capture the output after every planned reboot in a change window. A regression is obvious when you have the previous numbers.
- A unit that is "active (exited)" but took 90s usually hit a timeout or a slow external dependency. Check its journal for that window.
- `rd.timeout` and initramfs delays appear before systemd-analyze numbers. If the total wall time is much larger than `systemd-analyze` reports, the delay was earlier.
- Temporary `systemd.unit=rescue.target` on the kernel cmdline gets you a shell when the default target never finishes.

## Related Notes

- [[Linux Boot Process]]
- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[journalctl Deep Dive]]
- [[cloud-init]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A host that "sometimes took 5 minutes" was waiting on a stale NFS mount in fstab that had no `nofail`. `critical-chain` named the exact mount unit. Adding `nofail` and a shorter timeout fixed it.
- After a cloud-init update, boot time jumped 40s. `systemd-analyze blame` showed `cloud-final.service`. The user-data script had a new `sleep` that nobody reviewed.
