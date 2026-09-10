# Docker Operations

## Concept

Docker Engine is a daemon (`dockerd`) plus a CLI that talks to it over a Unix socket. An *image* is a stack of immutable layers plus a config. A *container* is a writable layer, namespaces, cgroups, and one or more processes. Volumes and bind mounts outlive the container; everything in the writable layer does not.

On modern Kubernetes nodes the runtime is usually containerd. `docker` on a laptop and `crictl`/`nerdctl` on a node are different sockets. Confirm which daemon you are talking to before you prune anything.

## Why it matters

- “The app is down” on a Docker host is usually: process exited, image pull failed, bind-mount permissions, published port clash, or the disk filled with layers
- `docker rm` / `prune` destroys the only logs you had
- Overlay disk usage grows until the node is read-only; `df` on `/` lies if you do not inspect Docker’s graph driver
- Resource flags on `docker run` are cgroup limits. They do not show up in an uninformed `top` the way you expect

## Mental Model

```
registry  → docker pull  → image (layers + config) in /var/lib/docker
                              ↓
                         docker run
                              ↓
              namespaces (pid, net, mnt, uts, ipc, user)
              cgroups (cpu, memory, pids)
              writable layer + optional volumes/binds
                              ↓
                         PID 1 inside the container
```

If PID 1 exits, the container is stopped. If PID 1 does not reap children, you collect zombies. `docker logs` is the container’s stdout/stderr, not syslog inside the image unless you configured it.

## Key Commands

```bash
# What is actually running (and what just died)
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker ps -a --filter status=exited

# Why it died
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}} {{.State.OOMKilled}} {{.State.FinishedAt}}' NAME
docker logs --tail 200 NAME
docker logs -f --since 10m NAME

# Exec vs attach: exec is a new process; attach is the original stdio
docker exec -it NAME sh
# distroless / no shell → debug image or nsenter from the host

# Resources right now
docker stats --no-stream
docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' NAME

# Images and disk
docker images
docker system df -v
docker image inspect REPO:TAG --format '{{.Id}} {{.RootFS.Layers}}'

# Publish / networks
docker port NAME
docker network ls
docker network inspect bridge

# Controlled cleanup (never start with -a --volumes on prod)
docker container prune
docker image prune
# docker system prune -a --volumes   # last resort; destroys unused volumes
```

Compose: `docker compose ps`, `docker compose logs -f svc`, `docker compose down` does not imply volumes gone unless `-v`.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Status `Exited (1)` immediately | PID 1 crashed or bad CMD/ENTRYPOINT | `logs`, `inspect` Path/Args, missing config file |
| `Exited (137)` / `OOMKilled true` | Memory limit or host OOM | `inspect` Memory, `dmesg` / journal OOM, app heap |
| `Image not found` / pull denied | Wrong name/tag, auth, rate limit, air-gap | `docker login`, registry from *this* host |
| `port is already allocated` | Another container or host process has it | `ss -tlnp`, `docker ps` |
| Permission denied on bind mount | UID in container ≠ owner on host; SELinux `:z`/`:Z` | `ls -l` host path; `id` in container |
| Disk full, `no space` on pull | Overlay + old images + build cache | `system df -v`, then prune *images*, not random files |
| Healthy on `ps`, app unreachable | Published port vs container port mix-up; listening on 127.0.0.1 only | `docker port`, `ss` inside and on host |
| `Cannot connect to Docker daemon` | Not in `docker` group, or dockerd down | `systemctl status docker`; `ls -l /var/run/docker.sock` |
| Works on laptop, not in CI | Different daemon, BuildKit cache, platform `amd64` vs `arm64` | `docker version`, `--platform` |

## Investigation Tips

- Inspect before you rm. ExitCode, OOMKilled, Mounts, and Config.Env are the ticket body.
- `docker logs` is empty if the app logged only to a file inside the writable layer. Then you need `exec` or a copy of that file before the container is removed.
- `docker top NAME` is `ps` in that PID namespace. Host `top` shows the same processes with different PIDs.
- Graph driver lives under `/var/lib/docker`. Filling that filesystem freezes every container. Alert on it separately from `/`.
- `--restart unless-stopped` hides crash loops until you look at `ps -a` and log timestamps.
- Do not `chmod 666` the docker socket. That is root-equivalent. Use `sudo` or a rootless setup deliberately.
- On Kubernetes nodes, prefer `crictl ps` / `crictl logs`. Talking to the wrong runtime is a common self-own.

## Related Notes

- [[Container Internals]]
- [[Image and Layer Concepts]]
- [[Pod Troubleshooting]]
- [[Namespaces and cgroups]]
- [[Disk Full Runbook]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “disk full” incident was 80 GiB of dangling `<none>` images from CI builds with unique tags. `docker system df -v` showed it immediately; `du -sh /var/lib/docker` without `-v` did not explain *what* to delete.
- We `docker rm` a crashing container to “clean up” and lost the only stack trace. Policy became: logs first, copy `inspect`, then remove.
- Bind-mounting `/var/run/docker.sock` into a “helper” container gave that app root on the host. Treat the socket as a credential.
- Exit 137 was blamed on the app until `OOMKilled` was true and the compose file had `mem_limit: 128m` on a JVM defaulting to a larger heap.
