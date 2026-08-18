# Resource Requests and Limits

## Concept

In Kubernetes every container can declare:

- **Requests** – the amount of CPU/memory the scheduler uses when placing the Pod
- **Limits** – the maximum the container is allowed to use at runtime

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

## Why it matters

- Too high requests → Pods stay Pending (not enough free resources on nodes)
- Too low limits → CPU throttling or OOMKilled
- No requests/limits → noisy neighbour problems and poor scheduling

## Mental Model

```
Request  = “I need at least this much to be scheduled”
Limit    = “I must not use more than this at runtime”
```

- CPU is compressible (throttling)
- Memory is not (OOM Killer)

## Key Commands

```bash
# See requests and limits on a Pod
kubectl describe pod <pod> -n <ns> | grep -A10 -E 'Limits|Requests'

# Actual usage (requires metrics-server)
kubectl top pods -n <ns>
kubectl top nodes

# Node allocatable resources
kubectl describe node <node> | grep -A10 Allocatable
```

## Common Failure Modes & Symptoms

| Symptom                          | Likely cause                              | What to check                    |
|----------------------------------|-------------------------------------------|----------------------------------|
| Pod stuck Pending                | Insufficient free CPU/memory for requests | `describe pod` Events, node resources |
| OOMKilled                        | Memory limit too low or application leak  | Limits vs actual usage, logs     |
| High latency / throttling        | CPU limit too low                         | CPU usage vs limit               |
| Node pressure / eviction         | Too many Pods without proper requests     | Node conditions, eviction events |

## Investigation Tips

- Always compare **requests**, **limits**, and **actual usage** (`kubectl top`).
- A Pod can be scheduled based on requests but still be OOMKilled if it hits its memory limit.
- Setting only limits (without requests) can lead to overcommitment surprises.
- Use ResourceQuotas and LimitRanges in namespaces for governance.

## Related Notes

- [[Pod Troubleshooting]]
- [[Kubernetes Architecture]]
- [[Memory Management]]
- [[Memory Pressure Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
