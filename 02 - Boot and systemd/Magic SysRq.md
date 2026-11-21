# Magic SysRq

## Concept

Magic SysRq is a kernel feature that lets you send commands directly to the kernel even when userspace is completely wedged. It is triggered by a special key sequence (or by writing to `/proc/sysrq-trigger`) and runs in interrupt context.

The classic mnemonic is REISUB: sync, remount read-only, kill, sync again, unmount, reboot. It is the last resort before you pull power.

## Why it matters

- A hung NFS mount, a stuck D-state process, or a runaway userspace can leave you unable to `sync` or `reboot` cleanly.
- On a remote machine with a serial console or IPMI SOL, SysRq is often the only way to force a clean-ish reboot without risking filesystem corruption.
- It does not require systemd, sshd, or even a working shell. If the keyboard interrupt or the serial line still reaches the kernel, it works.
- Cloud consoles and some hypervisors expose a SysRq button; knowing what it does prevents accidental data loss.

Use it when `reboot` and `systemctl reboot` no longer respond and you still have a console.

## Mental Model

```
Keyboard / serial / /proc/sysrq-trigger
    → kernel sysrq handler (if enabled)
    → immediate action (sync, remount, kill, reboot, …)

Bitmask in kernel.sysrq controls which commands are allowed.
Default on many distros is 176 (sync, remount, reboot, etc.).
```

The sequence is deliberately ordered so you flush data before you reboot. Skipping steps is how you get journal replay or worse.

## Key Commands

```bash
# Is it enabled?
cat /proc/sys/kernel/sysrq
# 0 = off, 1 = all, other = bitmask

# Enable everything (until reboot, or set in sysctl)
echo 1 > /proc/sys/kernel/sysrq

# Trigger from a shell (when you still have one)
echo s > /proc/sysrq-trigger   # sync
echo u > /proc/sysrq-trigger   # remount ro
echo b > /proc/sysrq-trigger   # immediate reboot

# Classic keyboard sequence (when enabled)
# Alt + SysRq + r   (raw keyboard)
# Alt + SysRq + e   (SIGTERM everything)
# Alt + SysRq + i   (SIGKILL everything)
# Alt + SysRq + s   (sync)
# Alt + SysRq + u   (remount ro)
# Alt + SysRq + b   (reboot)
```

Common single letters:

- `s` sync
- `u` remount all read-only
- `b` reboot immediately
- `o` power off
- `t` dump tasks
- `m` dump memory info
- `w` dump blocked tasks

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| SysRq key does nothing | `kernel.sysrq=0` or keyboard in raw mode | `cat /proc/sys/kernel/sysrq`, try `/proc` |
| `/proc/sysrq-trigger` permission denied | not root or restricted | sudo, or console |
| Sync appears to hang | underlying device wedged | still try `u` then `b`; dmesg later |
| Reboot via SysRq leaves dirty fs | skipped `s` and `u` | always sync + remount first |
| Works on console, not over SSH | expected — SSH needs userspace | use IPMI/serial |
| Cloud “send SysRq” button greyed out | hypervisor setting or guest agent | provider docs, serial console |

## Investigation Tips

- Enable it before you need it. A one-line sysctl or a GRUB `sysrq_always_enabled=1` on machines that have serial/IPMI is cheap insurance.
- On a serial console the sequence is usually `Break` then the letter, or a provider-specific escape. Test it once on a non-production box.
- `echo t > /proc/sysrq-trigger` and `echo w` dump useful state to the console/dmesg even when `ps` is dead. Capture the console output.
- After a SysRq reboot, check the filesystem journal and `dmesg` from the previous boot (`journalctl -b -1`) to see how bad the hang was.
- Do not use `b` as the first command if you can avoid it. The REISUB order exists for a reason.
- In a VM, the hypervisor may intercept SysRq. Some require an extra flag (`-kernel` or a serial device) before the guest sees it.

## Related Notes

- [[Rescue and Emergency Targets]]
- [[Linux Boot Process]]
- [[dmesg Deep Dive]]
- [[journalctl Deep Dive]]
- [[Out of Band and IPMI]]
- [[Signals and Process Control]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A box with a stuck NFS mount would not `reboot` or even `sync`. Serial console + SysRq `s` `u` `b` brought it back with a clean journal. The NFS server had been dead for an hour; the client was the only one still waiting.
- I once hit `b` first out of habit. The subsequent fsck took longer than the original outage. Now the muscle memory is `s` then `u` then `b`.
- On a cloud instance the “NMI / SysRq” button in the console was disabled by the image. Adding `kernel.sysrq=1` and confirming the serial console worked turned a “must rebuild” incident into a five-minute recovery.
