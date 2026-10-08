# udev and Kernel Modules

## Concept

`udev` is the userspace device manager. The kernel emits uevents when hardware or virtual devices appear; `systemd-udevd` matches rules and creates `/dev` nodes, names, permissions, and symlinks. Kernel modules are what make a device exist in the first place — built-in, loaded by `udev` on a modalias match, or demanded early from the initramfs.

A missing module means no device. A wrong rule means the device exists under a name your config does not use.

## Why it matters

- NIC names, disk by-id links, and multipath-friendly names are udev policy, not kernel law
- A rule that `NAME=`s a disk out from under LVM or mdraid looks like data loss until you undo it
- Modules needed for root must be in the initramfs. `modprobe` on the running system does not help the next boot
- Cloud images and cloned disks change enumeration order. `/dev/sdX` in fstab or applications is how that becomes an outage

If the device node is missing, stop editing the application and ask whether the module loaded and whether udev created the node.

## Mental Model

```
hardware / virtio / virtual
        │  modalias
        ▼
kernel driver (built-in or modules-load / udev modprobe)
        │  uevent (add/change/remove)
        ▼
systemd-udevd
   rules: /usr/lib/udev/rules.d  then  /etc/udev/rules.d  (same number: /etc wins)
        │
        ▼
/dev/sdX  /dev/disk/by-id  /dev/disk/by-uuid  /dev/net  (and custom)
```

Rule keys you actually use: `KERNEL`, `SUBSYSTEM`, `ATTRS{...}`, `ENV{ID_...}`, `SYMLINK+=`, `OWNER`, `GROUP`, `MODE`, `OPTIONS+="link_priority=..."`. Avoid `NAME=` on disks. `udevadm info -a` walks parent attributes; a match must use attributes from one device in that chain, not a mix, unless you know why.

Module config: `/etc/modules-load.d/*.conf` to load, `/etc/modprobe.d/*.conf` to alias, option, or blacklist. Blacklist stops *auto* load, not an explicit `modprobe`.

## Key Commands

```bash
# What is the node, and which rule claimed it?
ls -l /dev/disk/by-id /dev/disk/by-path /dev/disk/by-uuid
udevadm info /dev/sda
udevadm info -a -n /dev/sda | less      # attributes for rules

# Watch events while you reseat / rescan
udevadm monitor --udev --environment

# After editing rules (do not trigger the world blindly on a busy SAN host)
udevadm control --reload
udevadm trigger --subsystem-match=net --action=add
udevadm settle

# Modules
lsmod | head
modprobe -v <module>
modinfo <module>
cat /proc/modules | awk '$3==0 {print}'    # unused, not a removal order

# Persistent load / blacklist
ls /etc/modules-load.d /etc/modprobe.d
# echo 'blacklist nouveau' > /etc/modprobe.d/blacklist-nouveau.conf

# Rescan SCSI/virtio without reboot
echo '- - -' > /sys/class/scsi_host/host0/scan
lsblk -o NAME,TYPE,SIZE,TRAN,MODEL,SERIAL
```

Initramfs: if the module is required to mount root, add it via dracut `add_drivers` or initramfs-tools and rebuild. See [[initramfs]]. NIC rename rules that apply only after `switch_root` do not affect initramfs networking.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `/dev/sdX` letters swapped after reboot | Enumeration order, no by-id in config | `ls -l /dev/disk/by-id`, fstab, apps |
| Interface `eth0` missing | Predictable names (`ens3`, `enp1s0`) | `ip link`, udev net rules, cloud-init |
| Device in `dmesg`, no `/dev` node | udev failed or rule ignored it | `udevadm info`, `journalctl -u systemd-udevd` |
| Rule edit “did nothing” | Not reloaded, or lexical order lost | file in `/etc`, number prefix, `--reload` |
| Duplicate `/dev` names | Two rules `NAME=` the same node | `udevadm test /sys/...` |
| Module will not load | Blacklist, missing firmware, wrong kernel | `modprobe -v`, `dmesg`, `/lib/firmware` |
| Works until reboot | Module not in initramfs / modules-load | `lsinitrd`, `/etc/modules-load.d` |
| Permission denied on a device node | `MODE`/`GROUP` rule missing for that subsystem | `ls -l /dev/...`, rule in `/etc` |
| `udevadm trigger` storm | Triggered all subsystems on a multipath box | Match subsystem; check paths |

## Investigation Tips

- `dmesg` or `journalctl -k` first: driver attached or not. Then `udevadm info`. Then the rule file. Three different layers.
- Prefer `/dev/disk/by-id` or filesystem UUID in anything that must survive a reboot or a disk move. Never “fix” a letter swap by rewriting data onto the new `sdb`.
- `udevadm test /sys/class/block/sda` (path from `udevadm info`) prints which rules matched. Use it before installing a clever rule.
- Lexical order is the priority. `99-local.rules` runs late. A vendor `50-` rule can still win if yours never matches.
- `OPTIONS="last_rule"` and blind `NAME=` are how storage incidents start. Add a symlink; do not rename the kernel node.
- Firmware blobs missing after a kernel upgrade look like “module loads but device stays down”. `dmesg` will say `failed to load firmware`.
- On multipath, udev and `multipathd` both want the disk. Do not write a rule that claims `sd*` exclusively. See [[Device Mapper Multipath]].

## Related Notes

- [[Linux Boot Process]]
- [[initramfs]]
- [[GRUB and Kernel Parameters]]
- [[Block Devices and Partitions]]
- [[Device Mapper Multipath]]
- [[LVM Deep Dive]]
- [[systemd Units]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A cloned VM booted the wrong disk because an install script hardcoded `/dev/sdb`. by-id was already in `/dev/disk`. The outage was policy, not hardware.
- I blacklisted a module in `/etc/modprobe.d` and still saw it load from the initramfs, which had copied the old config. Rebuild the image or the blacklist is a lie until reboot.
- `udevadm trigger` without a subsystem match on a database host with dozens of LUNs caused a brief I/O stall I did not budget for. Settle and scope the trigger.
