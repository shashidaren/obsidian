# journalctl Deep Dive

## Concept

`journalctl` is the query tool for the systemd journal: a structured, indexed log store keyed by boot, unit, priority, PID, and custom fields. It is how you pull a *window* of evidence, not how you grep a text file.

Storage, vacuuming, and persistence live in [[journald and Persistent Storage]]. Flag syntax lives in [[journalctl Command Reference]]. This note is how to *use* the journal during an incident.

## Why it matters

- `systemctl status` only shows a tail. The failure reason is often 200 lines earlier.
- Time-bounded queries beat `grep -R /var/log` on a host that also ships to a SIEM
- Previous-boot logs (`-b -1`) are the difference between “it rebooted” and “OOM → panic → reboot”
- Priority and unit filters hide the noise that makes people give up and restart the box

If you cannot reconstruct the five minutes before an outage from the journal, either persistence is off or you queried the wrong window.

## Mental Model

```
journald  → binary journal (runtime and/or persistent)
journalctl applies filters (AND together):
  boot      -b / -b -1 / --list-boots
  time      --since / --until
  unit      -u nginx.service
  priority  -p err          (this level and worse)
  field     _PID= _UID= SYSLOG_IDENTIFIER= CODE_LINE=
  executable  journalctl /usr/sbin/sshd

Output modes:
  short / short-iso / verbose / json-pretty / cat
```

Default walk is oldest → newest for the current boot. Incidents want `-S "20 min ago"` or `-b -p err`, not the entire boot.

A line is a set of fields, not just a message. `-o verbose` shows them. That is how you jump from a PID in `ss` to every log line that PID emitted.

## Key Commands

```bash
# First pass on a sick host
journalctl --list-boots
journalctl -b -p err --no-pager
systemctl --failed

# One unit, current boot, no pager (tickets / paste)
journalctl -u nginx.service -b --no-pager

# Follow during a reproduce
journalctl -u myapp.service -f -o short-iso

# Incident window (always pin this)
journalctl -S "2026-09-04 08:10:00" -U "2026-09-04 08:25:00" --no-pager
journalctl -S "15 min ago" -u sshd.service

# Previous boot vs this boot
journalctl -b -1 -p warning --no-pager
journalctl -b -1 -u myapp.service

# Kernel / early boot
journalctl -k -b
journalctl -b -1 -k          # last boot’s dmesg equivalent

# Fields
journalctl _PID=1842 --since "10 min ago"
journalctl _UID=0 -p err -b
journalctl SYSLOG_IDENTIFIER=sudo -n 50
journalctl /usr/sbin/sshd -S today

# Newest first, limited
journalctl -u myapp -r -n 80 --no-pager

# Readable timestamps for correlation with metrics
journalctl -u myapp -o short-iso -S "30 min ago"

# Why did this invocation fail? (systemd result + logs)
systemctl status myapp.service -l --no-pager
journalctl -u myapp.service -b -o short-iso --no-pager

# Quiet scripts
journalctl -u myapp -p err -S "1 hour ago" -o cat --no-pager
```

Priority names: `emerg alert crit err warning notice info debug` (0–7). `-p err` means 0–3, not “only err”.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| “No entries” for last boot | Volatile journal | `--list-boots`, [[journald and Persistent Storage]] |
| Unit looks fine, app still broken | Logs went to a file, not the journal | `StandardOutput=` in the unit; app log path |
| Status shows failure, journal empty | Different unit name / `@` instance | `systemctl status`, `systemctl cat` |
| Flood of identical lines | Rate limit or a tight retry loop | “suppressed N messages”; app restart policy |
| Times do not match Grafana | TZ / UTC mix; use `short-iso` | `timedatectl`; `-o short-iso` |
| Cursor jumps, lines missing | Vacuum, rotation, or disk-full | `--disk-usage`, vacuum settings |
| `pager` ate the terminal | Forgot `--no-pager` in a ticket paste | alias `j='journalctl --no-pager'` |
| Only kernel lines after reboot | Boot never reached userspace | `-b -1 -p err`, [[Linux Boot Process]] |

## Investigation Tips

- Start with `--failed` + `-b -p err`, then shrink to `-u` + `--since`. Do not open the full boot log first.
- Correlate with metrics using `-o short-iso`. Human “Mar 03 08:12” without a year or timezone wastes minutes.
- `systemctl status` already embeds a few journal lines. If those lines are “Started …” only, the crash is later — keep reading with `-u -S`.
- Instance units (`user@1000.service`, `getty@tty1`) need the exact instance name. `systemctl list-units '*foo*'` first.
- `-o verbose` once per incident. `_CMDLINE=`, `CODE_FUNC=`, and `PRIORITY=` often beat the MESSAGE text.
- If the host ships logs centrally, still query local journal first. Collectors drop, delay, and sample; the box has the raw stream.
- Do not vacuum during an incident. Snapshot `--disk-usage` and copy out the window with `journalctl … > /root/incident.log`.
- For flapping units: `journalctl -u foo --since "1 hour ago" | grep -E 'Started|Stopping|Failed'` tells you the restart cadence before you touch `Restart=`.

## Related Notes

- [[journalctl Command Reference]]
- [[journald and Persistent Storage]]
- [[systemctl Deep Dive]]
- [[systemd Units]]
- [[Logging Architecture]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `-b -1 -p err` after an unexplained reboot has closed more tickets than any userspace strace. OOM, ext4 remount-ro, and fencing all show up there.
- I keep `journalctl -o short-iso --no-pager` as the default in muscle memory. The built-in pager plus local time has caused me to paste the wrong hour into a bridge more than once.
- When an app “logs nothing”, the unit almost always has `StandardOutput=null` or the process is not the unit I thought. `systemctl show -p MainPID,Id,FragmentPath` before more `journalctl` flags.
