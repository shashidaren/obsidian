# Podman Operations

## Concept

Podman is a daemonless OCI runtime wrapper: `podman` talks to a per-user or system service (`podman.socket` / `podman system service`) only when you ask it to, and otherwise forks `conmon` + runc/crun directly. There is no long-lived root daemon that owns every container.

CLI shape is deliberately Docker-like. Behaviour is not identical once you leave `run`/`ps`/`logs` — especially **rootless**, **pods**, **quadlets**, and **systemd** integration.

## Why it matters

- RHEL-family hosts and many hardened images ship Podman, not Docker. Muscle memory from Docker will get you 80% there and then fail on ports, volumes, and linger.
- Rootless is the default worth using. It changes UID mapping, storage paths, networking (slirp4netns/pasta), and which ports you may bind.
- Production-ish services on a host should be systemd units (quadlet or `podman generate systemd`), not a `tmux` session running `podman run`.
- Mixing Docker and Podman on one node with shared `/var/run/docker.sock` hacks is how you get two sources of truth and zero certainty.

## Mental Model

```
CLI  →  containers/storage  (images + overlay)
     →  containers/common   (policy, registries.conf)
     →  runtime (crun/runc) + conmon
     →  optional: pod (pause + shared net/ipc/uts ns)

Rootful  storage: /var/lib/containers/storage
Rootless storage: ~/.local/share/containers/storage

Rootless net: user namespace + pasta/slirp4netns (not a real bridge by default)
```

A Podman *pod* is a group of containers sharing namespaces — the closest local analogue to a Kubernetes Pod. The infra container holds the shared network namespace.

Linger: rootless containers die when the user session ends unless `loginctl enable-linger <user>` and a user systemd service keep them.

## Key Commands

```bash
# Identity of this installation
podman info
podman version
podman info --format '{{.Host.Security.Rootless}} {{.Host.NetworkBackend}}'

# Lifecycle
podman ps -a --format 'table {{.ID}} {{.Names}} {{.Status}} {{.Ports}}'
podman logs --tail 100 -f <name>
podman exec -it <name> /bin/sh
podman inspect <name> --format '{{.State.Status}} {{.HostConfig.Binds}}'

# Images and disk
podman images --digests
podman system df -v
podman image prune -a --filter until=240h

# Pods
podman pod ps
podman pod create --name web -p 8080:8080
podman run -d --pod web --name nginx docker.io/library/nginx:1.26

# systemd / quadlet (preferred for services)
podman generate systemd --new --name <container> --files
# Quadlet: drop a .container file in /etc/containers/systemd/ or ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user status <name>.service

# Rootless UID map and storage
cat /etc/subuid /etc/subgid
podman unshare cat /proc/self/uid_map
podman unshare ls -l

# Registries and policy
cat /etc/containers/registries.conf
cat /etc/containers/policy.json
```

`podman compose` exists; treat it as compatibility, not as the long-term service manager.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Permission denied on a bind mount | Rootless UID map vs host owner | `podman unshare ls -l <path>`; `:U` / `chown` in user ns |
| Cannot publish port 80 | Rootless cannot bind <1024 | Use 8080+ or rootful; or `sysctl net.ipv4.ip_unprivileged_port_start` |
| Container cannot reach internet | pasta/slirp DNS or outbound | `podman info` network backend; try `--network host` only as a test |
| Containers vanish after logout | No linger / no user systemd | `loginctl show-user`; enable linger |
| Image pull denied | registries.conf, policy.json, short-name alias | `podman pull docker.io/library/alpine` explicitly |
| Storage full under `$HOME` | Rootless graph driver growth | `podman system df`; prune; move storage |
| “Cannot connect to socket” after Docker muscle memory | Talking to docker.sock | `which podman`; unalias `docker` |
| Slow exec / stuck stop | conmon / runtime hang, volume NFS | `podman inspect` state; `crun`/`runc` events |
| Quadlet unit not found | File not in systemd container dir, no daemon-reload | path + `systemd-analyze --user` |

## Investigation Tips

- Start with `podman info`. Rootless vs rootful, storage driver, and network backend decide the rest of the debug path.
- For volume permission issues, `podman unshare` is the view that matches the container’s user namespace. Host `ls -l` lies by UID number.
- Prefer named volumes or fully qualified host paths. Relatives paths and `~` in unit files surprise you after reboot.
- Short image names (`nginx`) depend on `registries.conf` search lists and are being phased toward explicit names. Write `docker.io/library/nginx:1.26`.
- When a container should outlive SSH, write a quadlet. `podman generate systemd --new` is acceptable; hand-maintained `Restart=always` units are better than a screen session.
- Do not run rootless *and* rootful copies of the same workload and wonder why ports conflict. Pick one privilege model per service.
- `podman top`, `podman stats`, and `podman events` exist. Use them before `strace` on `conmon`.

## Related Notes

- [[Docker Operations]]
- [[Container Internals]]
- [[Image and Layer Concepts]]
- [[Namespaces and cgroups]]
- [[systemd Units]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first rootless service I shipped died every night at 00:00 when idle SSH sessions were reaped. Linger plus a user unit fixed it; `Restart=always` in a leftover shell did not.
- Bind-mounting `/opt/app` owned by `root:root` into a rootless container produced EACCES that looked like SELinux. It was the UID map. `podman unshare chown` ended the argument.
- Short-name `podman pull postgres` hit the wrong mirror after a registries.conf change. Fully qualified names belong in units the same way digests belong in Kubernetes.
