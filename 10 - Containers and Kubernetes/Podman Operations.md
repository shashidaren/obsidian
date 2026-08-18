# Podman Operations

## Concept

Podman is a daemonless container engine. It can run containers as root or as a normal user (**rootless**).  
Command-line usage is deliberately similar to Docker in many cases.

## Why it matters

- Many modern Linux distributions favour Podman over Docker.
- Rootless mode changes networking, storage paths, and permission behaviour.
- Useful for local development and for environments that want to avoid a root daemon.

## Mental Model

```
Docker-style CLI
    ↓
Podman (no central daemon)
    ↓
containers / pods / images (per user or system)
```

Rootless containers run inside a user namespace, so UIDs/GIDs and some network features behave differently from rootful containers.

## Key Commands

```bash
# Basic lifecycle (very similar to Docker)
podman ps
podman ps -a
podman images
podman run -it --rm <image> /bin/sh
podman logs <container>
podman exec -it <container> /bin/sh
podman stop / start / rm <container>

# System / rootless info
podman info
podman system df

# Generate systemd units (useful for services)
podman generate systemd --name <container> --files
```

## Rootless vs Rootful differences

| Area            | Rootful                         | Rootless                              |
|-----------------|---------------------------------|---------------------------------------|
| Privilege       | Runs as root                    | Runs as normal user                   |
| Network         | Full host network capability    | Often uses slirp4netns / pasta        |
| Storage path    | System locations                | Under user’s home (`~/.local/share/containers`) |
| Port binding    | Any port                        | Ports ≥ 1024 without extra config     |
| Security        | Higher risk if compromised      | Better isolation by default           |

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Permission denied on volumes         | UID mapping in rootless mode              | `podman unshare cat /proc/self/uid_map` |
| Cannot bind low ports                | Rootless restriction                      | Use higher ports or rootful      |
| Networking from container fails      | Rootless network stack                    | `podman info`, try `--network host` for testing |
| Storage / disk issues                | User container storage full               | `podman system df`               |

## Investigation Tips

- `podman` and `docker` commands are often interchangeable for basic use, but behaviour diverges with rootless, pods, and systemd integration.
- For services that should survive logout, use `podman generate systemd` or quadlet.
- When debugging rootless problems, check the user namespace mappings and the storage location under the user’s home.

## Related Notes

- [[Docker Operations]]
- [[Container Internals]]
- [[Namespaces and cgroups]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
