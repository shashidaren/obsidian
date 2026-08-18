# Docker Operations

## Concept

Docker is a platform for building, shipping, and running containers.  
Even in Kubernetes environments, understanding Docker (or the underlying runtime) is still valuable for image work, local debugging, and legacy systems.

## Why it matters

Common operational tasks:
- Inspecting running containers
- Viewing logs
- Debugging image and layer issues
- Cleaning up disk space used by images/containers/volumes
- Understanding resource usage

## Mental Model

```
Image (read-only layers)
    ↓ docker run / create
Container (writable layer + namespaces + cgroups)
    ↓
Process(es) running inside the container
```

## Key Commands

```bash
# Running containers
docker ps
docker ps -a                    # include stopped

# Logs
docker logs <container>
docker logs -f --tail 100 <container>

# Inspect
docker inspect <container>
docker inspect <image>

# Execute into a container
docker exec -it <container> /bin/sh

# Resource usage
docker stats

# Images
docker images
docker pull <image>
docker rmi <image>

# Cleanup (careful in production)
docker system df
docker system prune
docker system prune -a --volumes
```

## Common Failure Modes & Symptoms

| Symptom                          | First checks                              |
|----------------------------------|-------------------------------------------|
| Container exits immediately      | `docker logs`, `docker inspect` (ExitCode) |
| Cannot pull image                | Network, registry auth, image name        |
| Disk full on Docker host         | `docker system df`, prune, volumes        |
| Port already allocated           | `docker ps`, host port conflicts          |
| Permission / volume issues       | Mounts, user namespaces, SELinux/AppArmor |

## Investigation Tips

- Always look at logs before removing a failed container — evidence disappears when the container is removed.
- `docker system df` is the starting point for disk usage problems related to Docker.
- Prefer `docker inspect` over guessing configuration.
- On modern Kubernetes nodes the runtime is usually containerd; Docker commands may not be available or may talk to a different daemon.

## Related Notes

- [[Container Internals]]
- [[Image and Layer Concepts]]
- [[Pod Troubleshooting]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
