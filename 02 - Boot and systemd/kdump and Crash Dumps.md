# kdump and Crash Dumps

## Concept

kdump reserves memory for a second kernel that boots when the primary kernel panics. The second kernel captures a `vmcore` (full memory image) so you can debug a hard lockup, OOM-of-the-kernel, or driver bug that never produced a userspace coredump.

`kexec` loads the crash kernel early. On panic the running kernel jumps to it. The crash kernel writes the vmcore (usually via NFS, SSH, or local disk) then reboots.

## Why it matters

- A kernel panic with only a screenshot or a serial line is not root-causeable. vmcore is the artifact.
- `crash` / `gdb` on the vmcore shows the backtrace, locks, and memory state at the moment of death.
- Without reserved crashkernel memory the second kernel cannot start; you get a silent reboot.
- Database and storage hosts that panic under load often need the vmcore to distinguish a driver bug from an application-triggered OOM.

If the box rebooted and `last` shows a crash, check whether kdump actually wrote a vmcore before you declare it a one-off.

## Mental Model

```
boot
  → reserve crashkernel= (cmdline)
  → kexec -p loads second kernel + initrd into reserved region
panic / oops
  → jump to crash kernel
  → /proc/vmcore visible
  → makedumpfile (or cp) writes compressed vmcore
  → reboot to primary
```

The crash kernel is minimal. It must have network or disk configured if you want the vmcore off-box. Most distros use a small initramfs for this.

## Key Commands

```bash
# Is the crash kernel loaded?
kexec -p -l 2>/dev/null || echo "not loaded"
cat /sys/kernel/kexec_crash_loaded
systemctl status kdump --no-pager

# Config
grep -E 'crashkernel|KDUMP' /proc/cmdline
cat /etc/kdump.conf /etc/default/kdump-tools 2>/dev/null

# After a panic: where is the dump?
ls -lh /var/crash/ /var/lib/kdump/ 2>/dev/null
# or the NFS/SSH target from kdump.conf

# Analyze (on a machine with the matching vmlinux and debuginfo)
crash /usr/lib/debug/lib/modules/$(uname -r)/vmlinux /var/crash/vmcore
# or
gdb vmlinux vmcore
```

Typical `kdump.conf` lines:

```
path /var/crash
core_collector makedumpfile -l --message-level 1 -d 31
# or
net user@10.0.0.5
sshkey /root/.ssh/kdump_id_rsa
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Panic, no vmcore | crashkernel= missing or too small | cmdline, `kexec -p` | 
| kdump service failed at boot | not enough reserved memory | dmesg, crashkernel size | 
| vmcore written but unreadable | missing vmlinux / debuginfo | matching kernel debug package | 
| Dump to NFS fails | crash kernel has no network | kdump initrd, network config | 
| Host never comes back | crash kernel hung on dump | serial console, reduce dump level | 
| Works on bare metal, fails in VM | hypervisor does not support kexec crash | check hypervisor docs | 

## Investigation Tips

- Confirm `crashkernel=` is on the cmdline and that `kexec -p` succeeded before you need the dump. A missing reservation is discovered only during the next panic.
- Test the path: `kdumpctl test` or trigger a deliberate panic on a non-prod box (`echo c > /proc/sysrq-trigger`) and verify the vmcore appears.
- Keep the matching `vmlinux` and debuginfo for every kernel you run. A vmcore without symbols is a large binary blob.
- makedumpfile filters can shrink the dump dramatically. Start with the default filtering; only capture full if you need page tables or specific slabs.
- In cloud images kdump is often disabled or the crash kernel cannot reach the dump target. Know the limitation before you rely on it.
- After collecting the vmcore, reboot promptly. The crash kernel is not a place to linger.

## Related Notes

- [[coredumpctl]]
- [[Linux Boot Process]]
- [[GRUB and Kernel Parameters]]
- [[initramfs]]
- [[systemctl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A storage node panicked under load. No kdump reservation, so the only artifact was a one-line oops on the serial console. The next kernel image got `crashkernel=256M` and we actually captured the driver bug.
- The vmcore was written to an NFS share that the crash kernel could not mount because the kdump initrd lacked the NFS modules. Local disk (or a pre-configured SSH target) is more reliable.
- Analyzing a 64 GB vmcore on the production host filled `/var` again. Copy the file off first.
