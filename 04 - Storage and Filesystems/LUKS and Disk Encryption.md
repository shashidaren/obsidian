# LUKS and Disk Encryption

## Concept

LUKS (Linux Unified Key Setup) is a header plus keyslots on a block device. `cryptsetup` unlocks a keyslot (passphrase, key file, or token) and creates a device-mapper target, usually `/dev/mapper/<name>`, which is what you mount or give to LVM. The ciphertext underneath is not a filesystem until that mapping exists.

The header is the keys. Lose the header and every keyslot, and the data is gone even if the disk is physically fine.

## Why it matters

- Root-on-LUKS that is missing from the initramfs, or whose `rd.luks.uuid` does not match, stops boot at an emergency shell or a passphrase prompt nobody is watching.
- `luksFormat` on the wrong device is immediate, intentional destruction. There is no recycle bin.
- Header damage (partial overwrite, failed resize of the partition that holds the header) looks like "disk failed" and is not fixed by fsck.
- Encrypted volumes add CPU and, if discard is mishandled, either leak free-space patterns or silently stop TRIM from working.

## Mental Model

```
Physical / partition / LV
    └── LUKS header (magic, keyslots, UUID) + ciphertext payload
            └── cryptsetup open
                    └── /dev/mapper/name    ← this is the block device apps see
                            └── filesystem or LVM PV

/etc/crypttab          unlock map for non-root (and some root setups)
initramfs + rd.luks    unlock root before switch_root
```

LUKS2 (default on modern cryptsetup) supports more keyslots, tokens, and online reencrypt. LUKS1 is still common on older hosts. `luksDump` tells you which you have. Do not convert during an incident.

Keyslots are independent. A backup passphrase in slot 1 is what saves you when the primary key file is lost. Empty slots are fine; zero slots that you can open are not.

## Key Commands

```bash
# Identify before you touch anything
lsblk -f
blkid | grep -i crypto
cryptsetup luksDump /dev/sda2          # header, version, UUID, keyslots
cryptsetup status cryptroot            # active mapping

# Open / close (name is local; UUID is stable)
cryptsetup open /dev/sda2 data
cryptsetup open --key-file /root/data.key /dev/sda2 data
cryptsetup close data

# Persistent non-root unlock
# /etc/crypttab:  name  UUID=…  /path/to/key  luks,discard
systemd-cryptsetup status

# Header backup — do this before resize, reencrypt, or disk move
cryptsetup luksHeaderBackup /dev/sda2 --header-backup-file /root/sda2.luksHeader
cryptsetup luksHeaderRestore /dev/sda2 --header-backup-file /root/sda2.luksHeader

# Add a recovery slot (test it before you need it)
cryptsetup luksAddKey /dev/sda2

# Initramfs must contain cryptsetup for root-on-LUKS
lsinitrd /boot/initramfs-$(uname -r).img | grep -E 'cryptsetup|dm-crypt'
cat /proc/cmdline | tr ' ' '\n' | grep luks
```

`luksFormat` creates a new header and destroys access to old data. It is not a repair command. Require the UUID from `luksDump` in the change ticket before anyone types it.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Boot drops to emergency, no passphrase prompt | cryptsetup or `rd.luks.uuid` missing from initramfs/cmdline | `lsinitrd`, `/proc/cmdline`, [[initramfs]] |
| "Device already exists" on open | Stale mapping or name clash | `cryptsetup status`, `ls /dev/mapper` |
| No key available / wrong passphrase | Slot mismatch, wrong key file, header damaged | `luksDump` slots; try the other slot |
| Mount fails, mapper node missing | Unlocked name does not match fstab/crypttab | `findmnt`, crypttab, `lsblk` |
| Works until reboot | crypttab or initramfs not updated | crypttab UUID, rebuild initramfs |
| Resize "succeeded", volume will not open | Partition or header overwritten | Stop. Header backup or you are restoring |
| TRIM never happens / discard ignored | `discard` not set, or SSD issue | crypttab option, `lsblk -D` |
| Performance cliff after enabling LUKS | AES without AES-NI, or double encryption | `lscpu` flags, `cryptsetup status` cipher |

## Investigation Tips

- `luksDump` and `lsblk -f` before any write. Confirm the LUKS UUID matches crypttab and the kernel cmdline.
- Header backup belongs with the passphrase escrow, not only on the encrypted disk. A backup stored only inside the volume is useless when the header is the thing that broke.
- Root unlock problems are initramfs problems. Rebuild and confirm `cryptsetup` is in the image before the maintenance window ends. See [[initramfs]].
- `nofail` on a data crypttab entry can boot the host with the application volume absent. That is sometimes what you want, and sometimes how you fill the root filesystem by writing to an empty mountpoint.
- Do not `luksFormat` to "fix" a mapping that will not open. That creates a new empty container.
- Reencrypt and `luksConvertKey` are planned changes with a header backup and a tested second slot, not incident tools.
- Cloud images that encrypt only the data volume still need the key available at boot (key file permissions, tang/clevis, or a person at the console). Document which.

## Related Notes

- [[initramfs]]
- [[Filesystems and Mounts]]
- [[Block Devices and Partitions]]
- [[LVM Deep Dive]]
- [[GRUB and Kernel Parameters]]
- [[Linux Boot Process]]
- [[Backup Strategy]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A partition grow moved the start sector and ate the LUKS header. The payload was intact and useless. Header backup is now a precondition for any resize of an encrypted disk, same as a snapshot is for an LV.
- The passphrase prompt was fine in the lab and invisible on a serial-less cloud VM. Root-on-LUKS without a reachable console or a key file in initramfs is a lockout plan.
- I have seen `luksFormat` typed against the device that `lsblk` had just reordered. Serial and `luksDump` UUID in the ticket, or the command does not get run.
