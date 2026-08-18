# Pod Troubleshooting

**Purpose**: Systematic approach to diagnosing Pod problems in Kubernetes.

---

## 1. Quick Status

```bash
kubectl get pods -A -o wide
kubectl get pods -n <namespace>
kubectl describe pod <pod> -n <namespace>
```

Look at:
- STATUS column (Pending, Running, CrashLoopBackOff, ImagePullBackOff, Error, Completed…)
- READY column (e.g. 0/1, 1/2)
- Events at the bottom of `describe`

---

## 2. Common Pod States & What They Mean

| State                | Meaning                                      | First actions                          |
|----------------------|----------------------------------------------|----------------------------------------|
| Pending              | Not scheduled yet                            | `describe` → Events (resources, taints, affinity) |
| ContainerCreating    | Runtime is starting the container            | Usually transient; check if stuck      |
| Running              | Containers started                           | Check READY and application health     |
| CrashLoopBackOff     | Container keeps crashing                     | Logs + `describe`                      |
| ImagePullBackOff     | Cannot pull image                            | Image name, registry auth, network     |
| Error / Completed    | Container exited                             | Exit code + logs                       |
| OOMKilled            | Container exceeded memory limit              | Limits + application memory usage      |

---

## 3. Investigation Steps

### 3.1 Events and description

```bash
kubectl describe pod <pod> -n <ns>
```

Events section is often the fastest source of truth.

### 3.2 Logs

```bash
kubectl logs <pod> -n <ns>
kubectl logs <pod> -n <ns> -c <container>          # multi-container
kubectl logs <pod> -n <ns> --previous              # previous crashed container
kubectl logs <pod> -n <ns> -f                      # follow
```

### 3.3 Resource usage and limits

```bash
kubectl top pod <pod> -n <ns>
kubectl describe pod <pod> -n <ns> | grep -A5 -E 'Limits|Requests'
```

### 3.4 Shell into the container (when running)

```bash
kubectl exec -it <pod> -n <ns> -- /bin/sh
```

---

## 4. Decision Flow (simplified)

```
Pending?
  → describe → look for FailedScheduling, insufficient CPU/memory, taints, affinity

ImagePullBackOff?
  → image name, tag, registry credentials, network to registry

CrashLoopBackOff / Error?
  → logs --previous, describe, check probes, config, permissions

Running but not Ready?
  → readiness probe failing, application not listening yet

OOMKilled?
  → memory limits too low or application leak
```

---

## 5. Useful Extra Commands

```bash
# All events in a namespace
kubectl get events -n <ns> --sort-by='.lastTimestamp'

# Watch pods
kubectl get pods -n <ns> -w

# YAML of the running pod
kubectl get pod <pod> -n <ns> -o yaml
```

---

## Related Notes

- [[Kubernetes Architecture]]
- [[Resource Requests and Limits]]
- [[Services DNS and Ingress]]
- [[Container Internals]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> 
