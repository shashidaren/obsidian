# GRUB and Kernel Parameters

## Concept

GRUB (GRand Unified Bootloader) selects a kernel and initramfs pair and passes a command line into the kernel. Those parameters control early behaviour: where root is, whether to break into the initramfs, console devices, cgroup defaults, and a long list of subsystem toggles.

Permanent config lives in distro-managed files; the *effective* line is whatever the running kernel reports in `/proc/cmdline`.

## Why it matters

- Recovery often starts by editing the cmdline *once* in the GRUB menu (rd.break, rescue.target, enforcing=0)
- Permanent mistakes (`root=` wrong UUID, missing `console=`, bad `crashkernel=`) only show up after reboot
- UEFI + Secure Boot + wrong EFI path is a “disk is fine, firmware will not chainload” problem
- Vendor kernels and cloud images sometimes inject parameters via GRUB snippets you did not know existed

Treat cmdline changes like firewall changes: temporary test first, then persist.

## Mental Model

```
UEFI NVRAM / BIOS order
    → EFI binary or MBR stage
        → grub.cfg (or BLS entries)
            → menu entry: linux /vmlinuz… <cmdline>
                          initrd /initramfs…
                → kernel sees /proc/cmdline
```

Editing sources of truth:
- RHEL-like: `/etc/default/grub` + `/etc/grub.d/*` → `grub2-mkconfig`
- Debian-like: `/etc/default/grub` + `/etc/default/grub.d/*` → `update-grub`
- Some cloud images: `grubby` or BLS (`/boot/loader/entries/*.conf`) instead of classic grub.cfg

Runtime view is always `cat /proc/cmdline`. Config files can lie until the next `mkconfig` + reboot.

## Key Commands

```bash
# What is actually running?
cat /proc/cmdline

# EFI boot order (UEFI systems)
efibootmgr -v

# Generate config after /etc/default/grub changes
# RHEL-like:
grub2-mkconfig -o /boot/grub2/grub.cfg
# or EFI:
grub2-mkconfig -o /boot/efi/EFI/<vendor>/grub.cfg
# Debian-like:
update-grub

# grubby (RHEL convenience)
grubby --info=ALL
grubby --update-kernel=ALL --args="systemd.unit=multi-user.target"
grubby --update-kernel=ALL --remove-args="quiet"

# Temporary recovery from GRUB menu
# e to edit, change linux/linuxefi line, Ctrl-x or F10 to boot
# Useful one-shot args:
#   systemd.unit=rescue.target
#   systemd.unit=emergency.target
#   rd.break
#   enforcing=0
#   init=/bin/bash
#   console=ttyS0,115200n8

# Inspect generated entries
grep -n 'linux\|linuxefi\|options' /boot/grub2/grub.cfg 2>/dev/null | head
ls /boot/loader/entries/ 2>/dev/null
```

Common parameters worth knowing:

| Parameter | Role |
|-----------|------|
| `root=UUID=…` | Real root device for initramfs |
| `ro` / `rw` | Initial mount of root |
| `rd.break` / `rd.shell` | Initramfs debug shells |
| `systemd.unit=` | Override default target |
| `console=` | Serial / graphical console |
| `quiet` `splash` | Hide early messages (remove when debugging) |
| `enforcing=0` | SELinux permissive for this boot |
| `nouveau.modeset=0` / `nomodeset` | Broken GPU bring-up |
| `crashkernel=` | Reserved memory for kdump |

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| GRUB: no such device / UUID | `/boot` moved, wrong UUID in cfg | `blkid`, regenerate cfg from chroot |
| Firmware boots wrong disk | EFI order or leftover entry | `efibootmgr -v`, delete stale |
| Kernel boots, no messages | `quiet` + wrong/missing `console=` | Remove quiet; set serial console |
| Changes in `/etc/default/grub` ignored | Forgot `grub2-mkconfig` / `update-grub` | Diff cfg mtime vs default file |
| Only old kernel listed | New kernel package did not update cfg | Reinstall kernel package, mkconfig |
| Secure Boot rejection | Unsigned/shim path wrong | MOK, vendor EFI binary, SB state |
| `root=` points at vanished name | Used `/dev/sdX` instead of UUID | Fix to UUID/LABEL |
| Temporary edit “did nothing” | Edited wrong menu entry (rescue vs default) | Confirm the line you boot |

## Investigation Tips

- Photograph or serial-capture the GRUB error before you reboot again. The text names the missing UUID or file.
- For one-off recovery, prefer GRUB menu edit over rewriting disk from a live image when the filesystem is healthy.
- After editing `/etc/default/grub`, regenerate *and* verify the output file contains your args (`grep` the cfg).
- On dual-boot or multipath hosts, GRUB may have been installed to the wrong disk. `efibootmgr` and the cloud/firmware boot order matter more than `/boot/grub2` existing.
- `grubby --update-kernel=ALL` is safer than hand-editing cfg on RHEL when you only need to add/remove args.
- Keep `console=tty0 console=ttyS0,115200n8` (order matters) on machines you will only ever reach via serial or cloud console.
- Document permanent cmdline policy (audit, hugepages, cgroup) in the same place you document fstab — it is part of the host contract.

## Related Notes

- [[Linux Boot Process]]
- [[initramfs]]
- [[systemctl Deep Dive]]
- [[SELinux Deep Dive]]
- [[Block Devices and Partitions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Removing `quiet splash` for one boot has answered more “black screen after upgrade” tickets than any package reinstall. Early kernel messages were there the whole time.
- I treat `grubby --info=ALL` as the source of truth on RHEL before arguing about what `/etc/default/grub` says. They diverge after manual cfg edits.
- Serial console parameters belong in the golden image, not in the runbook written after the first unreachable production reboot.
