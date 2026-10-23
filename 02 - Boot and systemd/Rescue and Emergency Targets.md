# Rescue and Emergency Targets

## Concept

systemd provides special targets for when the normal boot cannot complete:

- **rescue.target** — single-user-like. Root filesystem is mounted, basic services, root password required. Networking and most multi-user services are not started.
- **emergency.target** — even smaller. Root may be read-only, no password if you reached it via the kernel command line, almost nothing running.

Both exist so you can repair a system that will not reach `multi-user.target` or `graphical.target`.

## Why it matters

- A bad fstab entry, a failed mount, or a broken unit with `RequiredBy=multi-user.target` can drop you into emergency. Knowing the difference between rescue and emergency tells you how much of the system is actually up.
- Cloud and VM consoles often land you in emergency when the network unit fails or cloud-init cannot finish. The interface may be down; you still have a shell.
- Changing the default target or masking a critical unit without a recovery plan is how you lock yourself out of a remote box.
- `systemctl isolate` to rescue is also how you deliberately take a box to single-user for maintenance when you still have a working multi-user session.

If the machine boots to a maintenance shell, identify which target you are in before you start editing files.

## Mental Model

```
kernel + initramfs
    → switch_root to real root
    → default.target (usually multi-user or graphical)
         ↔
    failures in sysinit / local-fs / basic services
         → emergency.target or rescue.target

rescue.target   ≈ single-user, root rw, sulogin
emergency.target ≈ sulogin on a possibly ro root, minimal mounts
```

`systemctl get-default` shows what a normal boot wants. `systemctl status` and `systemctl list-jobs` show why you did not get there.

## Key Commands

```bash
# Where am I?
systemctl get-default
systemctl status
systemctl list-jobs
findmnt /

# From a working system, go to rescue on purpose
systemctl isolate rescue.target
# or
systemctl rescue

# Kernel command line (GRUB) to force it
# systemd.unit=rescue.target
# systemd.unit=emergency.target
# or the older single / emergency

# Once inside, common repairs
mount -o remount,rw /
journalctl -xb          # this boot
systemctl --failed
vim /etc/fstab
# after fix
systemctl daemon-reload
systemctl default       # try to continue to the real target
```

To make rescue the temporary default (rare, and easy to forget):

```bash
systemctl set-default rescue.target
# later
systemctl set-default multi-user.target
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Boots to sulogin, root ro | emergency.target, failed local-fs | `findmnt /`, `journalctl -xb`, fstab |
| Asks for root password, some services up | rescue.target | `systemctl status`, which units failed |
| Emergency on every boot after edit | bad fstab, missing fsck, Required= failed | `/etc/fstab`, `systemctl --failed` |
| Cloud VM console shows emergency, no network | cloud-init or network unit failed | `journalctl -u cloud-init`, interface state |
| `systemctl isolate rescue` then lost SSH | expected — rescue does not start sshd by default | use console or start sshd manually |
| Cannot remount rw | underlying device error or ro flag from initramfs | `dmesg`, `findmnt -o OPTIONS` |

## Investigation Tips

- `journalctl -xb` is the fastest way to see why the boot stopped. Look for failed mounts and units that pulled in emergency.
- In emergency the root filesystem is often read-only. `mount -o remount,rw /` is the first command if you need to edit.
- A failed `Requires=` or `Requisite=` on a unit that multi-user needs will drop you to emergency. `systemctl --failed` and the unit’s `Requires=` lines tell you which one.
- On a remote machine, prefer the hypervisor console or IPMI over relying on SSH once you isolate to rescue. Start `sshd` manually if you must.
- After fixing fstab or a unit, `systemctl daemon-reload` then `systemctl default` attempts to continue. If it fails again, you are still in the maintenance shell with the new journal lines.
- `rd.break` and initramfs shells are earlier than systemd targets. If you are at a `dracut` prompt you have not reached rescue/emergency yet.

## Related Notes

- [[systemctl Deep Dive]]
- [[systemd Units]]
- [[Linux Boot Process]]
- [[journalctl Deep Dive]]
- [[Filesystems and Mounts]]
- [[GRUB and Kernel Parameters]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A cloud image with a typo in fstab for a data volume dropped every boot into emergency. The console showed sulogin; `journalctl -xb` named the exact mount unit. Fixing the UUID and `systemctl default` brought it up without a rebuild.
- I isolated a box to rescue over SSH to "quickly" fix a disk. The session died and the console was the only way back in. Now I confirm console access before `isolate rescue` on anything remote.
- An emergency shell with a read-only root and a failed remount was a dying disk, not a bad fstab. `dmesg` showed the I/O errors; the target was just the symptom.
