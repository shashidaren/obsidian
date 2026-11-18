# podman Operations

## Concept

podman is a daemonless container engine that is CLI-compatible with Docker. Containers are processes; rootless mode uses user namespaces so the container root is not host root.

Pods group containers that share a network namespace and can share volumes, similar to a Kubernetes pod.

## Why it matters

- No central daemon means one less process to crash and no single point of failure for the runtime.
- Rootless is the default security posture for many images; it changes what the container can do with the host network and ports.
- `podman generate systemd` (or Quadlet) is how you turn a container into a proper systemd unit that survives reboot.
- Image and volume storage is per-user in rootless mode; filling a home directory looks like a full disk on the host.

## Mental Model

```
podman run
    → user namespace (rootless) or host namespace (rootful)
    → container process tree
    → cgroup, network namespace, mount namespace

podman pod
    → shared netns + optional shared volumes
    → multiple containers
```

Quadlet files in `~/.config/containers/systemd` or `/etc/containers/systemd` are the modern way to declare containers as systemd units.

## Key Commands

```bash
# Everyday
podman ps -a
podman images
podman logs <ctr>
podman inspect <ctr>

# Rootless vs rootful
podman info | grep -A2 rootless

# Generate a unit (legacy)
podman generate systemd --name myapp --files

# Quadlet (preferred)
# ~/.config/containers/systemd/myapp.container
systemctl --user daemon-reload
systemctl --user start myapp

# Cleanup
podman system df
podman system prune
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Port bind fails in rootless | Ports < 1024 or no `net.ipv4.ip_unprivileged_port_start` | `sysctl`, run as root or raise the sysctl |
| Container vanishes after logout | No lingering, user systemd not running | `loginctl enable-linger`, `systemctl --user` |
| Disk full in `/home` | Rootless storage under `~/.local/share/containers` | `podman system df`, prune |
| `permission denied` on volume | SELinux label or UID mapping | `:Z`, `podman unshare`, `ls -Z` |
| Works as root, fails rootless | Capability or device access | `podman info`, capabilities |

## Investigation Tips

- `podman info` first. It tells you rootless vs rootful, storage driver, and cgroup driver.
- For a container that must survive reboot, use Quadlet or a generated systemd unit plus lingering. A bare `podman run -d` dies with the user session.
- Rootless port publishing below 1024 needs the sysctl or a rootful container.
- SELinux: most volume problems are missing `:Z` or `:z`. Check `ausearch -m avc` before you disable SELinux.
- `podman logs` and `journalctl --user -u` are the two places a Quadlet failure appears.

## Related Notes

- [[systemd User Services and Linger]]
- [[SELinux Basics for Admins]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A rootless container bound to port 80 failed until I raised `net.ipv4.ip_unprivileged_port_start`. The error message only said "permission denied".
- I generated a systemd unit but forgot `loginctl enable-linger`. The container ran until the user logged out, then disappeared. Lingering is part of the unit now.
