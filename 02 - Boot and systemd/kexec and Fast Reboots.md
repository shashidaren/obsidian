# kexec and Fast Reboots

## Concept

kexec loads a new kernel (and initramfs) into memory and jumps to it, skipping firmware POST and the bootloader. It is a warm reboot used to shorten the downtime of a kernel upgrade on hardware whose firmware initialization is slow.

## Why it matters

- Large servers and some storage arrays spend 5–15 minutes in firmware before GRUB even appears. kexec removes that window.
- A failed kexec leaves the machine hung with no console unless you already have out-of-band access. It is not a substitute for a working rescue path.
- Devices that only initialize cleanly from a cold boot (certain HBAs, NICs with buggy firmware, GPUs) will misbehave or disappear after kexec.

## Mental Model

```
cold reboot:  userspace shutdown → firmware POST → bootloader → kernel → initramfs → systemd
kexec:        userspace shutdown → kexec loads vmlinuz+initrd into RAM → direct jump to new kernel
```

The new kernel must re-probe every device itself. State left by the previous kernel (or by firmware that was never re-run) can cause missing devices or panics.

## Key Commands

```bash
# Install
# RHEL-like: dnf install kexec-tools
# Debian-like: apt install kexec-tools

kexec -v

# Load for the next jump (reuse current cmdline)
kexec -l /boot/vmlinuz-$(uname -r) \
  --initrd=/boot/initramfs-$(uname -r).img \
  --reuse-cmdline

# Or an explicit new kernel after an upgrade
kexec -l /boot/vmlinuz-6.8.0-new \
  --initrd=/boot/initramfs-6.8.0-new.img \
  --command-line="$(cat /proc/cmdline)"

# Execute the jump (this reboots)
kexec -e

# Preferred: let systemd shut down cleanly first
systemctl kexec
# equivalent: systemctl reboot --kexec
```

Verify the files exist and match before you load them:

```bash
ls -lh /boot/vmlinuz-* /boot/initramfs-* /boot/initrd.img-*
file /boot/vmlinuz-$(uname -r)
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Hang with no output after kexec | Device failed to re-init, missing firmware, bad cmdline | OOB/serial console; cold power-cycle to recover |
| NIC, HBA or disk missing | Driver or firmware not in the new initramfs, or device needs cold boot | `lsinitrd`, `dmesg`, compare `lspci`/`lsblk` before/after |
| Early panic | vmlinuz/initrd mismatch or corrupt file | `file`, size, `lsinitrd` on the exact image you loaded |
| Different kernel cmdline | `--reuse-cmdline` vs explicit `--command-line` | `/proc/cmdline` before and after |
| kexec refused | Secure Boot lockdown, missing kexec_load permission | `/sys/kernel/security/lockdown`, dmesg \| grep -i kexec |
| Works once, fails on second consecutive kexec | Accumulated device/firmware state | Insert a cold boot periodically |

## Investigation Tips

- Have working IPMI/iLO/serial console *before* the first production kexec. A hung kexec requires a hard power cycle.
- Test on the exact hardware generation in a maintenance window. "It worked on the lab box" is not evidence.
- Prefer `systemctl kexec` so filesystems are unmounted and services stopped before the jump.
- After a successful kexec, immediately compare `lspci`, `lsblk`, `ip link` and `dmesg` to the pre-kexec state. Missing devices are the common silent failure.
- Confirm the initramfs for the *target* kernel exists and contains the storage/network modules this host needs. A missing initrd is the most frequent "kexec broke it" ticket.
- Secure Boot and kernel lockdown can block kexec. Check before you schedule the change.
- Do not use kexec to escape a wedged kernel. It often preserves the bad state or makes diagnosis harder. Cold reboot and capture the crash dump if you need one.

## Related Notes

- [[Linux Boot Process]]
- [[GRUB and Kernel Parameters]]
- [[initramfs]]
- [[udev and Kernel Modules]]
- [[Out of Band and IPMI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- On a blade chassis with a 12-minute POST I used kexec for kernel rollouts. It was reliable until the third consecutive kexec; the HBA stopped probing. A cold boot cleared it. I now force a cold boot after every second kexec on that hardware.
- The most common failure I have seen is loading a kernel whose initramfs was never built. The panic looks like a kexec bug. `ls -lh` and `lsinitrd` on the exact files you pass to `kexec -l` would have caught it.
