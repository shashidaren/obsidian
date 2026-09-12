# Image and Layer Concepts

## Concept

A container **image** is a content-addressed filesystem snapshot plus metadata (entrypoint, env, user, ports, architecture). It is built from **layers**: each typically corresponds to a Dockerfile instruction or a copy of a parent image. Layers are tarballs identified by digest. They are *immutable* and *shared*.

A running container is those read-only layers plus a thin **writable layer** (the container’s overlay upperdir). Anything written there dies with the container unless it was bind-mounted or a volume.

## Why it matters

- ImagePullBackOff is one of the most common reasons a Pod never starts. The cause is almost never “Kubernetes is broken” — it is name, tag, digest, auth, or registry path.
- Layer sharing is why the first pull is slow and the fifth is fast — and why a corrupted layer on one node produces a unique snowflake failure.
- Writing application state into the writable layer is the number-one way to lose data on restart and to balloon node disk usage.
- Image *size* is deploy time, registry cost, attack surface, and cold-start latency.

## Mental Model

```
Registry  --pull-->  node content store (layers by digest)
                         |
                         +-- Image manifest (what layers + config)
                         |
Container start:  overlay mount
                  lower = image layers (RO)
                  upper = writable layer (ephemeral)
                  work  = overlay workdir

Volumes / PVCs / bind mounts punch through the overlay.
```

Tags (`:latest`, `:v1.2`) are mutable pointers. **Digests** (`@sha256:…`) are the thing you actually ran. Production deploys that pin only a tag will drift across nodes over time.

Copy-on-write means a huge file in an early layer still costs space even if a later layer “deletes” it. Deleting in a child layer hides the file; it does not remove the bytes.

## Key Commands

```bash
# Local image inventory (Docker)
docker images --digests
docker history --no-trunc <image>
docker inspect <image> --format '{{.Id}} {{.RootFS.Layers}}'
docker system df -v

# Podman equivalents
podman images --digests
podman history <image>
podman image tree <image>

# What a cluster is actually asking for
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{range .spec.containers[*]}{.image}{" "}{end}{"\n"}{end}'
kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'

# Pull by digest when you need reproducibility
crane digest example.com/app:1.4 || skopeo inspect docker://example.com/app:1.4

# Node disk eaten by images
crictl images
crictl inspecti <image-id>
# containerd:  ctr -n k8s.io images ls
```

`imagePullPolicy`:

| Policy | Behaviour |
|--------|-----------|
| `IfNotPresent` | Use node cache if the tag exists locally (dangerous with mutable tags) |
| `Always` | Query registry every start; still uses layers already present |
| `Never` | Node-local images only (air-gap / pre-loaded) |

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| ImagePullBackOff / ErrImagePull | Wrong name/tag, 401, TLS, DNS to registry | Pod Events, `crictl pull` on the node |
| ImagePullBackOff only on some nodes | Mirror, credentials, disk full, stale layer | Compare `crictl images` across nodes |
| Pod runs old code after “redeploy” | Mutated `:latest` + `IfNotPresent` | Pin digest; check image ID on node |
| Node disk full, few PVCs | Image + layer + container log accumulation | `docker system df` / containerd snapshot usage |
| Data gone after restart | Wrote to overlay upperdir | `mount` inside container; volume section of spec |
| Slow builds, huge images | No `.dockerignore`, apt lists left in layer, single-stage build | `docker history`, dive |
| Arch mismatch | Built `amd64`, scheduled on `arm64` | `uname -m`, image index |

## Investigation Tips

- Read the *Event* on the Pod before you SSH anywhere. It names the registry error more honestly than the Deployment status.
- Reproduce the pull on the *same node* with the *same* runtime (`crictl pull` / `podman pull`), not from your laptop.
- For private registries, confirm the imagePullSecret is in the *Pod’s* namespace and referenced by the ServiceAccount or spec.
- Multi-stage builds: compile in stage 1, copy the binary into a slim stage 2. Do not ship compilers, `.git`, or test fixtures.
- Prefer digest pins in production manifests or a mutating policy that rewrites tags to digests at deploy time.
- After a bad pull, a node can keep a half-unpacked snapshot. Deleting the Pod is not enough; garbage-collect images on that node.
- Overlay whiteouts make `docker history` look like a file vanished. The parent layer still occupies bytes. Rebuild from a cleaner base if size matters.

## Related Notes

- [[Docker Operations]]
- [[Podman Operations]]
- [[Container Internals]]
- [[Pod Troubleshooting]]
- [[Persistent Storage]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We once “deployed v2” by retagging and leaving `imagePullPolicy: IfNotPresent`. Three nodes ran v2; the rest ran v1 for a week. Tags are nicknames.
- A 1.8 GiB image was 90% leftover `apt` caches and a copied `node_modules` from the build stage. `docker history` made the guilty layer obvious in thirty seconds.
- The writable layer filled a node because a developer logged to `/var/log/app.log` inside the container. The PVC was mounted at `/data`. Logs were not data.
