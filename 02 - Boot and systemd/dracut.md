# dracut

## Concept

dracut is the initramfs generator used on RHEL, Fedora, SUSE, and many other distributions. It builds a host-specific (or generic) initramfs that includes the modules and tools needed to mount the real root.

Unlike the Debian initramfs-tools, configuration is in /etc/dracut.conf and /etc/dracut.conf.d/, and rebuilds are explicit with the `dracut` command.

## Why it matters

- Kernel updates do not always trigger a correct rebuild if hooks fail
- Missing modules for storage, network root, or encryption mean boot failure
- Host-only mode is efficient but brittle for golden images or hardware changes
- Emergency shell is your recovery path when the root cannot be found

## Mental Model

```
/etc/dracut.conf.d/*.conf
  → dracut collects modules (lvm, crypt, multipath, …)
    → packs into /boot/initramfs-<kver>.img
      → bootloader loads it
        → /init in initramfs runs the early setup
```

Modules are enabled by presence of tools or explicit config. Host-only scans the running system.

## Key Commands

```bash
dracut -f -v                  # rebuild for running kernel
dracut -f -v /boot/initramfs-$(uname -r).img $(uname -r)
lsinitrd /boot/initramfs-$(uname -r).img | grep -E 'lvm|crypt|multipath|nvme'
dracut --list-modules
cat /etc/dracut.conf
ls /etc/dracut.conf.d/
# Add drivers
echo 'add_drivers+=" nvme "' > /etc/dracut.conf.d/nvme.conf
dracut -f
# Generic (not host-only)
dracut -f --no-hostonly
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Boot drops to emergency | Missing module or wrong root= | lsinitrd, cmdline |
| New kernel won’t boot | initramfs not built | ls /boot, package logs |
| Works on one host, fails on clone | host-only image | rebuild --no-hostonly |
| Slow boot | too many modules | lsinitrd size |
| LUKS not prompting | crypt module omitted | grep crypt in lsinitrd |

## Investigation Tips

- Always verify the image with lsinitrd after rebuild.
- For cloud or mixed hardware, prefer a broader image or explicit drivers.
- Check /var/log or journal for dracut failures during kernel install.
- rd.break is your friend in the emergency shell.

## Related Notes

- [[initramfs]]
- [[Linux Boot Process]]
- [[LUKS and Disk Encryption]]
- [[udev and Kernel Modules]]
- [[GRUB and Kernel Parameters]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A golden image built on a virtio host failed to boot on a physical NVMe box because host-only omitted the nvme module. Explicit add_drivers fixed the fleet.
