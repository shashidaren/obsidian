# Linux Boot Process

## Concept

From power-on to a usable system the machine passes through distinct stages: firmware (BIOS or UEFI), bootloader (usually GRUB), kernel, initramfs, then systemd (PID 1) which reaches a target. Each stage has its own failure modes and recovery tools. Knowing which stage failed tells you which tool to reach for.

## Why it matters

- A host that does not boot is an incident until it does. Guessing at the wrong stage wastes the outage window.
- UEFI vs legacy, Secure Boot, and the location of the EFI binary are the first things to check when the firmware will not hand off.
- Most “kernel update broke boot” cases are actually an incomplete initramfs or a wrong `root=` UUID, not the kernel binary itself.
- systemd only starts after the real root is mounted. Problems before that are still in the initramfs.

## Mental Model

```
Firmware (UEFI/BIOS)
    → bootloader (GRUB / systemd-boot)
        → kernel + initramfs loaded into RAM
            → kernel unpacks initramfs, runs /init
                → initramfs finds and mounts real root
                    → switch_root → systemd (PID 1)
                        → default.target (multi-user or graphical)
```

UEFI reads a `.efi` binary from the ESP (`/boot/efi`). Legacy BIOS reads the MBR. The kernel command line (`/proc/cmdline`) is the contract between the bootloader and everything after it.

## Key Commands

```bash
# Which firmware path?
[ -d /sys/firmware/efi ] && echo UEFI || echo BIOS

# What is actually running
cat /proc/cmdline
systemctl get-default
systemd-analyze
systemd-analyze blame
systemd-analyze critical-chain

# Early messages
dmesg -T | less
journalctl -k -b
journalctl -b -p err

# Bootloader view
efibootmgr -v                 # UEFI
grubby --info=ALL             # RHEL-style
ls /boot/loader/entries/      # BLS

# Initramfs contents (is the driver even packed?)
lsinitrd /boot/initramfs-$(uname -r).img | grep -E 'lvm|crypt|nvme|virtio|xfs'
```

One-shot recovery from the GRUB menu (edit the linux line):

- `systemd.unit=rescue.target`
- `systemd.unit=emergency.target`
- `rd.break`
- `init=/bin/bash`

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Firmware will not boot anything | EFI entry missing, Secure Boot, wrong disk | `efibootmgr`, live USB |
| GRUB error about UUID or file | Wrong root= or /boot moved | `blkid`, regenerate grub.cfg |
| Drops to dracut/emergency shell | Missing module, LUKS, LVM, or UUID | `lsinitrd`, cmdline, `rd.break` |
| Kernel panic early | Bad initramfs or missing root driver | Compare initramfs of working vs broken kernel |
| Reaches systemd but hangs | Failing unit, remote mount, or network-online | `journalctl -b`, `systemd-analyze blame` |
| Boots but no network | Network unit or cloud-init failed | `journalctl -u NetworkManager -b` |
| Slow boot | One unit blocking | `systemd-analyze critical-chain` |

## Investigation Tips

- Photograph or serial-capture the exact error before the next reboot. The text usually names the missing UUID or unit.
- `systemd-analyze` and `critical-chain` only work once the system has reached userspace. Before that you are still in firmware, GRUB, or initramfs.
- `rd.break` drops you with the real root on `/sysroot`. Remount it rw, fix the problem, then exit to continue. It is the least destructive recovery when the disk is healthy.
- Keep at least one known-good kernel + initramfs pair in the bootloader menu until the new pair has survived a reboot.
- On cloud images the bootloader is often configured not to show a menu. You may need the hypervisor console or a one-time metadata change to get a recovery shell.
- After any change to `/etc/default/grub` or a kernel install, verify the generated config actually contains the new arguments before you reboot.

## Related Notes

- [[GRUB and Kernel Parameters]]
- [[initramfs]]
- [[systemctl Deep Dive]]
- [[systemd-analyze]]
- [[journalctl Deep Dive]]
- [[Rescue and Emergency Targets]]
- [[udev and Kernel Modules]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first thing I do on an unreachable host is confirm whether the firmware even started GRUB. A missing EFI entry looks identical to a dead disk until you look at `efibootmgr` from a live image.
- Most “kernel update broke the box” tickets I have closed were an initramfs that never included the virtio or nvme module. `lsinitrd` on the new image would have caught it before the reboot.
- `systemd-analyze blame` has ended more “slow boot” arguments than any amount of speculation about the initramfs. The blocking unit is usually a network mount or a service waiting for something that never comes.
