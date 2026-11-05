# dmesg Deep Dive

## Concept

`dmesg` prints the kernel ring buffer: the messages the kernel itself emitted (drivers, filesystems, memory, devices). It is not a userspace log. On a systemd system the same messages also land in the journal as kernel facility lines; `journalctl -k` is often more useful because it has timestamps, boot IDs, and does not scroll off.

The ring buffer is fixed-size. Once it wraps, early boot messages are gone unless something persisted them.

## Why it matters

- Device enumeration, driver failures, I/O errors, OOM, and filesystem shutdowns appear here first.
- “The disk disappeared” or “the NIC went down” is usually a kernel message, not an application error.
- After a panic or an unexpected reboot, the previous boot’s ring buffer is the only place the reason may still exist — if it was captured.
- Hardware errors (EDAC, SMART via the kernel, PCIe AER, thermal) surface here long before a user notices latency.

If `journalctl -k -b -1` is empty and `dmesg` only shows the current boot, you lost the evidence of the last crash.

## Mental Model

```
kernel printk
    → ring buffer (fixed, wraps)
        → dmesg (reads the buffer)
        → journald (if running, stores as _TRANSPORT=kernel)

Timestamps:
  dmesg -T          human time (from the clock *now*; wrong if the clock was stepped)
  journalctl -k -o short-iso   better for correlation

Boot boundary:
  dmesg only has the current boot’s remaining buffer
  journalctl -b -1 -k has the previous boot if the journal was persistent
```

Early boot messages exist only until the buffer wraps or the machine reboots. That is why kdump, pstore, and a persistent journal matter more than “I’ll check dmesg later”.

## Key Commands

```bash
# Current kernel messages, human timestamps
dmesg -T
dmesg -T -l err,warn

# Same data from the journal (preferred when available)
journalctl -k -b --no-pager
journalctl -k -b -1 --no-pager          # previous boot
journalctl -k -S "30 min ago" -p err

# Follow live kernel messages
dmesg -w
journalctl -k -f

# Specific subsystems
dmesg -T | grep -iE 'oom|killed process|ext4|xfs|nvme|scsi|ata|mce|aer|edac'
journalctl -k | grep -i 'Call Trace'

# Buffer size / wrapping
dmesg | wc -l
cat /proc/sys/kernel/printk
# clear only if you have already captured it
# dmesg -c
```

`dmesg -T` converts the kernel’s monotonic time using the current wall clock. If the clock was wrong or stepped at boot, the converted times can be misleading. Prefer the journal’s own timestamps when they exist.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Early boot errors missing | Ring buffer wrapped or volatile journal | `journalctl --list-boots`, buffer size |
| `dmesg -T` times look wrong | Clock step after boot | Compare with `journalctl -k -o short-iso` |
| Disk I/O errors, then remount-ro | Hardware or path failure | `dmesg -T \| grep -iE 'I/O error|remount'` |
| OOM killer fired | Memory pressure | `dmesg -T \| grep -A 30 oom-killer` |
| NIC / bond flap | Link, driver, or firmware | `dmesg -T \| grep -iE 'link up\|link down\|bond'` |
| “No such device” after reboot | Driver missing from initramfs or udev | early `dmesg`, `lsmod`, [[initramfs]] |
| PCIe AER / MCE | Hardware fault | `dmesg -T \| grep -iE 'aer\|mce\|edac'` |
| Buffer empty after long uptime | Wrapped; only recent messages remain | journal persistence |

## Investigation Tips

- Prefer `journalctl -k` over raw `dmesg` once the system is up. You get boot selection, time filters, and persistence.
- Capture the ring buffer *before* you reboot a sick host: `dmesg -T > /root/dmesg.$(date +%s).txt` or rely on the journal.
- For “it rebooted itself”, `journalctl -b -1 -k -p err` is the first command. OOM, panic, watchdog, and filesystem shutdown all leave a signature.
- Hardware errors often repeat. Count them (`grep -c`) before you decide the disk or DIMM is dying versus a one-off.
- `dmesg -c` clears the buffer. Do not do it during an incident; you just destroyed the evidence.
- If the machine is wedged and you cannot log in, a serial console or IPMI SOL that captured the console is the only dmesg you will ever get. See [[Out of Band and IPMI]].
- Correlate kernel I/O errors with `iostat` / `smartctl` before you replace hardware. A full disk or a multipath path failure looks similar in dmesg.

## Related Notes

- [[journalctl Deep Dive]]
- [[Linux Boot Process]]
- [[kdump and Crash Dumps]]
- [[initramfs]]
- [[Out of Band and IPMI]]
- [[SMART and Disk Health]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A host that “randomly rebooted” had an OOM killer report in `journalctl -b -1 -k`. The current `dmesg` was clean. Without the previous boot’s journal the ticket would have stayed open.
- I trusted `dmesg -T` times during a clock-step incident and correlated the wrong minute with the application logs. The journal timestamps were correct; the converted dmesg times were not.
- A SAN path failure showed up as repeated “I/O error” and “end_request” lines for twenty minutes before the multipath daemon failed the path. dmesg was the earliest signal; waiting for the app to time out cost us the window.
