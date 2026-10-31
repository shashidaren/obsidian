# Kernel Live Patching

## Concept

Kernel live patching (kpatch on RHEL, livepatch on Ubuntu, kGraft/kSplice variants) applies security or bugfix changes to a running kernel without a reboot. A loadable module redirects the patched functions; the old code remains until all tasks have left it.

Livepatch covers a subset of CVEs (usually those that touch a small number of functions and do not change data structures). It is a bridge, not a permanent substitute for running a supported, fully patched kernel.

## Why it matters

- Rebooting a large fleet for every kernel CVE is expensive and risky. Livepatch lets you close the exposure window while you schedule the real reboot.
- A livepatch that fails to apply, or that is unloaded, leaves the host on the vulnerable code with no obvious package-level signal.
- Some patches cannot be live-applied. Assuming “we have livepatch so we never reboot” creates a growing set of unpatched hosts.
- The patch module must match the exact running kernel build. A subsequent offline kernel update invalidates it.

## Mental Model

```
Running kernel (e.g. 5.14.0-362.el9)
  → livepatch module loaded
  → ftrace / klp redirects patched functions
  → new tasks use new code immediately
  → old tasks migrate when they hit a patched function or are forced

States:
  applied / enabled
  transition in progress
  failed / disabled

Limits:
  no data-structure layout changes
  no every CVE
  still need eventual reboot onto a new kernel package
```

`uname -r` does not change. The proof is the livepatch status, not the package list alone.

## Key Commands

```bash
# RHEL / kpatch
kpatch list
kpatch info
ls /sys/kernel/livepatch/
cat /sys/kernel/livepatch/*/enabled

# Ubuntu Livepatch
canonical-livepatch status
canonical-livepatch status --verbose

# Generic
lsmod | grep -E 'kpatch|livepatch'
dmesg | grep -i livepatch
journalctl -u kpatch -u canonical-livepatch --since "-1d"

# Is a reboot still required for other reasons?
needs-restarting -r 2>/dev/null || true
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| CVE still reported after “patch” | Livepatch not applied or wrong kernel | `kpatch list`, exact `uname -r` |
| Livepatch fails to load | ABI mismatch, unsupported change | dmesg, patch build vs running kernel |
| Host rebooted, patch gone | Expected; new kernel needs its own patch or is already fixed | post-reboot status |
| Transition stuck | Task pinned in old function (rare) | `/sys/kernel/livepatch/*/transition` |
| “We never reboot” estate | Accumulated non-livepatchable CVEs | advisory list vs livepatch coverage |
| Patch applied but module unloaded | Manual unload or failed dependency | `lsmod`, enabled file |
| Scanner and status disagree | Scanner looks at package, not runtime | both `rpm -q` and livepatch status |

## Investigation Tips

- Record both the kernel package version and the livepatch status in the change ticket. `rpm -q kernel` alone is insufficient.
- After any kernel package update, re-check livepatch. The new kernel may already contain the fix or may need a new livepatch module.
- Treat livepatch as tactical. Schedule the reboot onto the fully updated kernel inside your normal patching window.
- If a livepatch fails, fall back to the normal reboot path; do not leave the host in a half-applied state.
- Confirm the vendor’s coverage list for the specific CVE before you promise “no reboot required”.

## Related Notes

- [[Patching Strategy]]
- [[Linux Boot Process]]
- [[GRUB and Kernel Parameters]]
- [[kexec and Fast Reboots]]
- [[Change Management]]
- [[Incident Management]]

## Personal Lessons Learned

- A security scan flagged a kernel CVE weeks after we had “patched”. Livepatch had failed to apply on three hosts because the running kernel was one build behind the patch module. The package looked current; the runtime was not.
- We used livepatch to survive a zero-day weekend, then rebooted the fleet onto the proper kernel the following Tuesday. Treating livepatch as the final state would have left us exposed to the next non-livepatchable issue.
- `kpatch list` empty after a successful-looking transaction meant the module never loaded. Checking the sysfs `enabled` file became part of the verification step.
