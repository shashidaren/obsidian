# initramfs

## Concept

The initramfs (initial RAM filesystem) is a compressed cpio archive the bootloader loads next to the kernel. The kernel unpacks it as the first root filesystem and runs `/init` from it. That early userspace has one job: assemble whatever is required to mount the *real* root (modules, device-mapper, LVM, MD RAID, LUKS, optional network), then `switch_root` into it.

If the real root cannot be found or unlocked, you live or die inside the initramfs.

## Why it matters

- Root on LVM, LUKS, iSCSI, multipath, or a non-built-in block driver *requires* the right bits in the image
- Kernel upgrades that do not rebuild initramfs are a classic “reboots into emergency shell” failure
- Host-only customisations (extra modules, rd.lvm, network for remote root) are invisible until reboot
- Dracut emergency shell is a recovery environment, not a finished boot — treat it as such

The running system’s `/lib/modules/$(uname -r)` is irrelevant if that version’s initramfs never packed the module.

## Mental Model

```
/boot/vmlinuz-<ver>
/boot/initramfs-<ver>.img   (or initrd.img-<ver>)
        │
        ▼
kernel mounts initramfs → runs /init (dracut or initramfs-tools)
        │
        ├─ load modules (storage, filesystem, virtio, …)
        ├─ activate MD / multipath / LVM
        ├─ open LUKS if rd.luks
        ├─ optionally configure network (nfs, iscsi root)
        ├─ mount real root on /sysroot (from root=UUID=…)
        └─ switch_root /sysroot /sbin/init
```

Builders:
- **dracut** (RHEL, Fedora, SUSE, many others) — host-centric, regenerates from the live system
- **initramfs-tools** (Debian/Ubuntu) — `update-initramfs`, hook scripts under `/etc/initramfs-tools`

`root=` on the kernel cmdline is consumed *here*, not by GRUB itself.

## Key Commands

```bash
# What image boots with this kernel?
ls -l /boot/initramfs-$(uname -r).img /boot/initrd.img-$(uname -r) 2>/dev/null

# List contents (modules, cryptsetup, lvm present?)
lsinitrd /boot/initramfs-$(uname -r).img 2>/dev/null | less
lsinitrd /boot/initrd.img-$(uname -r) 2>/dev/null | less
lsinitrd ... | grep -E 'virtio|nvme|lvm|crypt|multipath|xfs|ext4'

# Rebuild for running kernel (RHEL-like)
dracut -f -v
dracut -f -v /boot/initramfs-$(uname -r).img $(uname -r)

# Rebuild (Debian-like)
update-initramfs -u -k $(uname -r)
update-initramfs -u -k all

# Force inclusion of modules (dracut)
echo 'add_drivers+=" virtio_blk virtio_pci "' > /etc/dracut.conf.d/virtio.conf
dracut -f -v

# Inspect cmdline the initramfs will see
cat /proc/cmdline
# useful rd.* flags: rd.break, rd.shell, rd.lvm.lv=, rd.luks.uuid=, rd.retry=

# Inside dracut emergency shell (examples)
lvm vgscan; lvm vgchange -ay
ls /dev/disk/by-uuid
mount -o remount,rw /sysroot
journalctl          # limited; dmesg is often more useful early
```

After rebuild, update the bootloader config if your platform does not auto-discover the new image (`grub2-mkconfig`, `update-grub`, or BLS entry).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Dracut timeout for root device | UUID mismatch, LVM not activated, missing module | cmdline `root=`, `blkid`, `lsinitrd \| grep` |
| Works on old kernel only | New kernel’s initramfs never built / incomplete | Compare `lsinitrd` for both versions |
| LUKS prompt never appears / fails | Missing crypt module or wrong `rd.luks.uuid` | `lsinitrd \| grep crypt`, cmdline |
| Multipath root fails | multipath not in image or not started early | dracut multipath module, `/etc/multipath.conf` |
| Emergency shell, root is there | switch_root / init missing or broken | `ls /sysroot/sbin/init`, mount options |
| Huge or slow initramfs | Host-only mode pulled the world | dracut `--hostonly` vs omit; compress |
| SELinux denials right after pivot | Needs autorelabel | `touch /sysroot/.autorelabel` before continue |

## Investigation Tips

- Always `lsinitrd` before blaming the disk. “Module not found” at boot is often “module never packed”.
- Prefer UUID/LABEL in `root=` and fstab. `/dev/sdX` in the cmdline is how clones and cable swaps brick boots.
- `rd.break` drops you after devices are set up, with real root on `/sysroot` (often ro). Remount rw, fix, `exit` to continue.
- `rd.shell` / `rd.break=pre-mount` are earlier. Use the earliest break that still has the tools you need.
- On Debian/Ubuntu, package installs that call `update-initramfs` can fail silently in chroot or low-space `/boot`. Check exit status and `/boot` free space.
- Host-only initramfs (dracut default on many servers) is smaller and faster but will not boot hardware the build host did not see. Golden images for mixed hardware need a broader config.
- Keep at least one known-good kernel + initramfs pair in `/boot` and in the bootloader menu until the new pair has survived a reboot under load.

## Related Notes

- [[Linux Boot Process]]
- [[GRUB and Kernel Parameters]]
- [[LVM Deep Dive]]
- [[Block Devices and Partitions]]
- [[Filesystems and Mounts]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I stopped trusting “kernel package installed” as “bootable”. The post-transaction check is `lsinitrd` for the new version and a free slot in the GRUB menu.
- Cloud marketplace images that mount root by `/dev/vda1` break the moment the hypervisor enumerates disks differently. UUID in cmdline + fstab is non-negotiable for anything you will snapshot or resize.
- The fix for a missing virtio module is a one-line dracut config and `dracut -f`. The outage is waiting for console access because nobody tested reboot after the first kernel update on that AMI.
