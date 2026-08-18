# Image and Layer Concepts

## Concept

A container **image** is a packaged filesystem + metadata.  
Images are built from **layers**. Each instruction in a Dockerfile typically creates a new layer.

When a container runs, the runtime adds a thin **writable layer** on top of the image layers.

## Why it matters

- Understanding layers helps with image size, caching, and build time
- Data written inside a container is ephemeral unless stored on a volume
- Image pull problems and layer corruption appear in Pod events and runtime logs

## Mental Model

```
Image
├── Layer 1 (base OS)
├── Layer 2 (packages)
├── Layer 3 (application code)
└── ...

Container = Image layers (read-only) + Writable layer (ephemeral)
```

Volumes / bind mounts sit outside this layered filesystem and are the correct place for persistent data.

## Key Commands

```bash
# Image information
docker images
docker history <image>
docker inspect <image>

# In Kubernetes
kubectl describe pod <pod> | grep -i image
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}'

# Disk usage related to images (Docker)
docker system df
docker system df -v
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| ImagePullBackOff                     | Wrong name/tag, auth, network to registry | Pod events, image name, secrets  |
| Very large images                    | Too many layers / unnecessary files       | `docker history`, .dockerignore  |
| Data lost after container restart    | Wrote into the writable layer instead of a volume | Volume mounts in Pod/container |
| Slow pulls                           | Large image or slow registry              | Image size, registry location    |

## Investigation Tips

- Prefer explicit tags over `latest` in production.
- Use multi-stage builds and .dockerignore to keep images small.
- In Kubernetes, image pull policy (`IfNotPresent`, `Always`, `Never`) affects behaviour on each node.
- Image layers are cached on nodes — a failed or partial pull can sometimes leave the node in a bad state until cleaned.

## Related Notes

- [[Docker Operations]]
- [[Container Internals]]
- [[Pod Troubleshooting]]
- [[Persistent Storage]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
