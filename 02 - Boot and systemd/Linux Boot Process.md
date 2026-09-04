# Linux Boot Process

## Concept

A Linux boot is a staged hand-off: firmware finds a bootloader, the bootloader loads a kernel and initramfs, the kernel initialises hardware and runs early userspace from the initramfs, that userspace finds and mounts the real root, then pivots into systemd (or another init) which brings the machine to a target.

Knowing *which stage stopped* is most of the diagnosis.

## Why it matters

- “Won’t boot” is not one problem. A GRUB error, a missing root UUID, a failed cryptsetup, and a broken multi-user.target need different tools and different recovery media.
- Cloud images, encrypted root, LVM, and multipath all insert extra steps between kernel and real root.
- After kernel or initramfs changes, the failure mode is often “works until reboot” — which is when you discover the golden AMI never rebuilt the initramfs.

If you can name the last successful stage, you already know which note to open next.

## Mental Model

```
1. Firmware (UEFI / BIOS)
      → finds ESP / MBR, runs bootloader
2. Bootloader (GRUB)
      → loads vmlinuz + initramfs, passes cmdline
3. Kernel
      → hardware init, mounts initramfs as root
4. initramfs (dracut / initramfs-tools)
      → modules, LVM, md, cryptsetup, network if needed
      → mounts real root on /sysroot
      → switch_root / pivot_root
5. systemd on real root
      → default.target → multi-user / graphical
      → local-fs, network, services
```

Emergency paths:
- GRUB menu → edit cmdline (`rd.break`, `systemd.unit=rescue.target`, `init=/bin/bash`)
- initramfs emergency shell (root not found / timeout)
- systemd rescue / emergency targets once real root is mounted

## Key Commands

```bash
# From a running system — what did the last boots look like?
journalctl --list-boots
journalctl -b -1 -p err --no-pager
systemd-analyze
systemd-analyze blame
systemd-analyze critical-chain

# Kernel cmdline currently active
cat /proc/cmdline

# What GRUB will boot next (distro-specific paths)
grub2-editenv list 2>/dev/null || true
ls /boot /boot/grub2 /boot/efi/EFI 2>/dev/null

# Initramfs contents (do not guess — list)
lsinitrd /boot/initramfs-$(uname -r).img 2>/dev/null | head
lsinitrd /boot/initrd.img-$(uname -r) 2>/dev/null | head

# After recovery: rebuild initramfs and refresh bootloader
# RHEL-like:
dracut -f -v
grub2-mkconfig -o /boot/grub2/grub.cfg
# Debian-like:
update-initramfs -u -k all
update-grub

# Identify root by UUID (what cmdline and fstab must agree on)
findmnt -T /
blkid
cat /etc/fstab
```

Rescue workflow (conceptual): boot live/rescue media → mount root (+ /boot, + EFI) → `chroot` → fix fstab/cmdline/initramfs/GRUB → unmount → reboot.

## Common Failure Modes & Symptoms

| Where it dies | What you see | First checks |
|---------------|--------------|--------------|
| Firmware | No boot device / PXE loop | Disk order, Secure Boot, ESP present |
| GRUB | `error: no such device`, menu missing | `/boot` UUID, `grub.cfg`, EFI entry (`efibootmgr`) |
| Kernel load | Blank or early panic | Bad image, wrong root=, missing initrd |
| initramfs | `timeout waiting for device`, dracut emergency | UUID in cmdline vs `blkid`, LVM/md activation, crypt passphrase |
| switch_root | Hang after “OK” on volumes | `/sbin/init` missing, wrong root FS type |
| systemd | Rescue/emergency target, dependency fail | `systemctl --failed`, fstab without `nofail`/`_netdev` |
| Late boot | Login never appears | Display manager, getty, network-online blocking |

## Investigation Tips

- Capture the *last on-screen line* before the hang. “Reached target Basic System” is a different world from “Waiting for device dev-disk-by\x2duuid-…".
- On UEFI systems check `efibootmgr -v` before reinstalling GRUB; the NVRAM entry is often the only broken piece.
- Cloud serial console is the serial cable. Enable it before the incident if you can; use it first during one.
- Temporary cmdline fixes (`systemd.unit=rescue.target`, `rd.break`) prove the theory without rewriting disk yet. Make permanent changes only after the box is up.
- `rd.break` drops you *before* switch_root with the real root mounted read-only on `/sysroot`. Remount `rw`, fix, `touch /.autorelabel` if SELinux, then continue.
- After any change to modules needed for root (storage drivers, multipath, LUKS), rebuild the initramfs *and* test a reboot before you leave the change window.
- Compare `cat /proc/cmdline` (running) with what GRUB actually writes in `grub.cfg` / BLS entries. They drift.

## Related Notes

- [[GRUB and Kernel Parameters]]
- [[initramfs]]
- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[Filesystems and Mounts]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Most “kernel update broke the server” tickets were initramfs that never included the SAN or virtio_blk module for that host’s storage. `lsinitrd \| grep -i virtio` before the reboot would have saved the outage.
- A single bad line in `/etc/fstab` without `nofail` is enough to land a production host in emergency.target after an otherwise clean kernel upgrade. I now treat fstab edits like firewall edits: require a tested reboot or a documented `nofail`.
- Serial console + photographed GRUB error has beaten remote “guess and reinstall” every time I bothered to enable it.
