# Container Internals

## Concept

A container is **not** a lightweight VM.  
It is a regular Linux process (or group of processes) isolated using kernel features:

- **Namespaces** – isolate what the process can see (PID, network, mount, UTS, IPC, user…)
- **cgroups** – limit and account for resources (CPU, memory, I/O…)
- **Union / overlay filesystems** – give the appearance of a private root filesystem

## Why it matters

Understanding the underlying mechanisms helps when:
- Debugging “why can this container see X?”
- Investigating resource limits and OOM kills
- Working with network or storage problems inside containers
- Moving between Docker, containerd, Podman, and Kubernetes

## Mental Model

```
Host Kernel
├── Namespaces (isolation of view)
├── cgroups (resource limits)
└── Process(es) with a private rootfs (overlay)
```

From the inside, a container looks like its own small system.  
From the host, it is just processes with special settings.

## Key Concepts

| Feature        | Purpose                                      |
|----------------|----------------------------------------------|
| PID namespace  | Isolated process tree                        |
| Network namespace | Isolated network stack (interfaces, routes) |
| Mount namespace | Private filesystem mount table               |
| User namespace  | Map container UIDs to different host UIDs    |
| cgroups        | CPU / memory / I/O limits and accounting     |
| OverlayFS      | Layered filesystem for images                |

## Useful Host Commands

```bash
# See namespaces of a process
lsns
ls -l /proc/<PID>/ns

# cgroup information
cat /proc/<PID>/cgroup

# What the container’s root looks like on the host (Docker example)
docker inspect <container> | grep -i upperdir

# Processes inside a container from the host
docker top <container>
# or
ps aux | grep <container-process>
```

## Common Failure Modes & Symptoms

| Symptom                              | Related internal concept           |
|--------------------------------------|------------------------------------|
| Process sees wrong network           | Network namespace                  |
| Cannot write to expected paths       | Mount namespace / volumes / permissions |
| OOMKilled                            | cgroup memory limit                |
| Permission denied on files           | User namespace + file ownership    |
| “No space left” inside container     | Overlay / writable layer full      |

## Investigation Tips

- When a container has network problems, check whether it is using the host network or its own network namespace.
- Resource limits defined in Kubernetes or Docker end up as cgroup settings on the host.
- Overlay filesystem issues can look like normal disk-full problems but are limited to the container’s writable layer.

## Related Notes

- [[Namespaces and cgroups]]
- [[Docker Operations]]
- [[Kubernetes Architecture]]
- [[Resource Requests and Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
