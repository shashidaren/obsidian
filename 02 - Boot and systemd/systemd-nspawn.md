# systemd-nspawn

## Concept

`systemd-nspawn` starts a lightweight container from a directory, image, or machine using the same systemd that runs the host. It is not Docker; it is a chroot-plus-namespaces tool that integrates with `machinectl` and the host’s journal, network, and cgroup hierarchy.

## Why it matters

- Useful for building or testing a full userspace (package builds, rescue environments, reproducible test hosts) without a VM.
- The container shares the host kernel, so a module, sysctl, or cgroup setting inside is often the host’s.
- Networking, bind mounts, and capability drops are easy to get wrong; the failure looks like “the service starts but cannot reach anything” or “permission denied on a device”.
- Because it is systemd-native, journal, coredumps, and resource accounting appear on the host under the machine name — convenient until you forget which namespace you are looking at.

## Mental Model

```
systemd-nspawn --directory=/var/lib/machines/foo
    → new mount, pid, uts, ipc, (optional net) namespaces
    → pivot_root into the tree
    → exec systemd (or the given command) as PID 1 inside

machinectl
    → talks to systemd-machined
    → start/stop/status/login of registered machines

Default network is often a veth pair or none; --network-veth, --network-bridge, or --network-macvlan change it.
```

The container’s `/proc`, `/sys`, and device nodes are filtered. A process inside cannot see host processes unless you explicitly share the namespace.

## Key Commands

```bash
# Start an interactive shell in a directory tree
sudo systemd-nspawn -D /var/lib/machines/test --machine=test

# Boot a full system (systemd as PID 1)
sudo systemd-nspawn -D /var/lib/machines/test -b

# With networking
sudo systemd-nspawn -D /var/lib/machines/test --network-veth -b

# Manage via machinectl
machinectl list
machinectl status test
machinectl login test
machinectl poweroff test

# Bind a host directory
sudo systemd-nspawn -D /var/lib/machines/test --bind=/data:/data
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Container starts but has no network | No `--network-*` or bridge/veth missing | `ip link` inside and on host, `machinectl status` |
| `Failed to create directory` or permission errors on devices | Missing device node, or ProtectSystem / capability drop | `ls -l /dev` inside, nspawn capability flags |
| Host journal mixed with container | Expected — both go to the host journal | `journalctl -M test` or `journalctl _MACHINE_ID=…` |
| High memory use attributed to host | Accounting is hierarchical; container is a cgroup | `systemd-cgtop`, `machinectl status` |
| Cannot see host processes / files | Namespace isolation working as designed | Do not share pid/mount unless you mean to |
| Image or directory will not boot | Missing `/sbin/init` or broken fstab inside | `systemd-nspawn -D …` (shell) and inspect |

## Investigation Tips

- Use `journalctl -M <machine>` (or `-u` if it is a service) so you are not reading the host’s noise.
- For network problems, check the veth pair on the host (`ip link show`) and the address inside. A missing bridge port is a common “no connectivity” cause.
- `--bind` and `--bind-ro` are the usual way to inject data. A read-only bind of `/etc` or `/usr` will make package installs fail in confusing ways.
- Resource limits applied with systemd on the host (or `machinectl set-limit`) affect the container. A container that OOMs may be hitting a host slice limit.
- nspawn is not a security boundary against a privileged process inside. Do not treat it as a substitute for a VM or a proper container runtime when isolation matters.
- After a crash, `machinectl status` and the host journal usually have the exit reason; coredumps land in the host’s `coredumpctl` under the machine.

## Related Notes

- [[Namespaces and cgroups]]
- [[systemd Units]]
- [[journalctl Deep Dive]]
- [[Network Namespaces]]
- [[Linux Capabilities]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A test environment “had no DNS” inside nspawn. The veth was up, but nothing had been added to the bridge. One `ip link set … master br0` on the host fixed it; the container config was fine.
- I bind-mounted a host directory read-write for a build, then the build cleaned it. The host data was gone. `--bind-ro` plus a separate writable work directory would have prevented it.
- `journalctl -M` saved time during a boot failure inside the container. The same messages were in the host journal, but buried; the machine filter made them obvious.
