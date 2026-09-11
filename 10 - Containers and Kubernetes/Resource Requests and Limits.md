# Resource Requests and Limits

## Concept

In Kubernetes each container can declare:

- **Requests** — what the scheduler reserves when placing the Pod (and what the kubelet uses for eviction ranking in some cases)
- **Limits** — the hard ceiling enforced by the container runtime via cgroups

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

CPU is **compressible** (throttled). Memory is **not** (OOM killed when over limit).

## Why it matters

- Requests too high → Pods Pending while nodes still look "empty" by eye
- Memory limit too low → OOMKilled in a loop that looks like an app bug
- CPU limit too low → throttling, high latency, mysterious timeouts under load
- No requests → scheduler packs by luck; noisy neighbours and surprise eviction
- Limits without requests → overcommit behaviour that surprises you at the worst time

Requests and limits are the contract between the app, the scheduler, and the node.

## Mental Model

```
Request  = "Reserve this so I can be scheduled and have a baseline"
Limit    = "Kill or throttle me if I exceed this at runtime"

Node allocatable
  └── sum of Pod requests must fit
        └── each container may burst up to its limit (if CPU/memory available)
```

Quality of Service class (simplified):

| Class | When | Eviction preference |
|-------|------|---------------------|
| Guaranteed | requests == limits for all containers | Last to evict |
| Burstable | requests set, below limits | Middle |
| BestEffort | no requests/limits | First to evict under pressure |

`kubectl top` shows **usage**. `describe` shows **requests/limits**. You need both.

## Key Commands

```bash
# Declared resources
kubectl describe pod <pod> -n <ns> | grep -A12 -E 'Limits|Requests'
kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.containers[*].resources}'

# Actual usage (metrics-server)
kubectl top pod <pod> -n <ns> --containers
kubectl top nodes

# Node capacity vs allocatable vs allocated
kubectl describe node <node> | grep -A20 -E 'Allocatable|Allocated resources'

# Events that mention failed scheduling or OOM
kubectl describe pod <pod> -n <ns> | tail -30
kubectl get events -n <ns> --field-selector reason=FailedScheduling

# Inside the container / via cgroup (when you need proof)
cat /sys/fs/cgroup/memory.max          # v2 examples vary by path
cat /sys/fs/cgroup/cpu.max
```

Namespace governance:

```bash
kubectl get limitrange -A
kubectl get resourcequota -A
kubectl describe resourcequota -n <ns>
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Pending / FailedScheduling | Sum of requests > free allocatable | Events; node Allocated resources |
| OOMKilled | Limit < working set, or leak | `kubectl describe` last state; limits vs `top` |
| High latency under load | CPU throttling (limit too low) | Usage vs limit; throttling metrics if available |
| Node DiskPressure / MemoryPressure | Evictions, overpack | Node conditions; BestEffort workloads |
| HPA not scaling as expected | Metrics on wrong resource, or limits mask need | HPA target; request vs actual |
| "Plenty of free memory" but Pending | Free memory ≠ unallocated by requests | Allocatable − requests, not `free -h` |
| Java/Node OOM with low usage in `top` | Heap + metaspace + overhead > limit | Runtime flags vs limit |

## Investigation Tips

- Always compare **three numbers**: request, limit, actual usage. Two of three is not enough.
- Pending is a scheduler math problem. Do not delete/recreate Pods hoping for a different node until you understand requests and allocatable.
- OOMKilled exit is often 137. Confirm `reason: OOMKilled` in container status before tuning the app.
- For JVM/.NET/Node, the process's own heap settings must fit **inside** the memory limit with headroom. Limit 512Mi + heap 512Mi is a trap.
- CPU throttling does not show as "CPU 100%" in the way people expect; latency rises while utilisation looks capped at the limit.
- Set requests from observed steady usage + margin; set memory limits from observed peak + margin. Guessing both as the same round number is how Guaranteed Pods still die.
- ResourceQuota can block creates with odd errors — check quotas when "the YAML is fine" but apply fails.

## Related Notes

- [[Pod Troubleshooting]]
- [[Kubernetes Architecture]]
- [[Container Internals]]
- [[Memory Management]]
- [[Memory Pressure Runbook]]
- [[Capacity Planning]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Nodes showed 50% memory free in the cloud console while Pods were Pending. The free memory was already reserved by requests of idle Pods. Trust Allocatable and Allocated, not the hypervisor graph alone.
- A Burstable Pod without a memory request got evicted first under node pressure and took a critical queue worker with it. Critical paths deserve Guaranteed or at least honest requests.
- We raised CPU limits to "fix throttling" without changing requests and destabilised packing density. Limits and requests solve different problems; do not slide them as a pair by habit.
- The Java service that OOMKilled at 1Gi had `-Xmx1024m`. The fix was not more of the same — it was heap 75% of limit and a higher limit only after measuring RSS.
