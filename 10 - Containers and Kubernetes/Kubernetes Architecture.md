# Kubernetes Architecture

## Concept

Kubernetes is a declarative system: you declare the desired state, and controllers continuously reconcile the actual state toward it.

It is split into:

- **Control plane** – makes decisions (API server, scheduler, controller manager, etcd)
- **Worker nodes** – run the workloads (kubelet, kube-proxy, container runtime)

## Why it matters

Most Kubernetes problems can be categorized as:
- Scheduling / placement
- Runtime / container issues
- Networking
- Storage
- Configuration / permissions
- Control-plane health

Knowing which layer is broken focuses troubleshooting quickly.

## Mental Model

```
User / CI
    ↓ (kubectl / API)
API Server
    ↓
etcd (desired state)
    ↓
Controllers + Scheduler
    ↓
kubelet on nodes → container runtime → Pods
```

**Pods** are the smallest deployable unit. Containers inside a Pod share network and storage namespaces.

## Key Components

| Component            | Role                                      |
|----------------------|-------------------------------------------|
| kube-apiserver       | Front door for all API requests           |
| etcd                 | Key-value store for cluster state         |
| kube-scheduler       | Decides which node a Pod runs on          |
| controller-manager   | Runs controllers (Deployment, ReplicaSet, etc.) |
| kubelet              | Node agent – runs Pods                    |
| kube-proxy           | Service networking / load balancing       |
| container runtime    | containerd / CRI-O / Docker (legacy)      |

## Key Commands

```bash
# Cluster overview
kubectl get nodes
kubectl get pods -A
kubectl get componentstatuses          # older clusters
kubectl get --raw='/readyz?verbose'    # API server health

# Control plane pods (usually in kube-system)
kubectl get pods -n kube-system

# Node details
kubectl describe node <node>
```

## Common Failure Modes & Symptoms

| Symptom                          | Typical layer                     |
|----------------------------------|-----------------------------------|
| Pods stuck in Pending            | Scheduling / resources / taints   |
| Pods in CrashLoopBackOff         | Application / config / probes     |
| Service not reachable            | Networking / kube-proxy / CNI     |
| Node NotReady                    | kubelet / runtime / system        |
| API server slow or unavailable   | Control plane / etcd              |

## Investigation Tips

- Start with `kubectl get pods -A` and `kubectl get nodes`.
- Use `kubectl describe` heavily — Events at the bottom are often the fastest path to root cause.
- Check kube-system pods when the cluster itself feels unhealthy.
- Remember that kubectl talks to the API server; if the API is down, many commands will fail.

## Related Notes

- [[Pod Troubleshooting]]
- [[Services DNS and Ingress]]
- [[Resource Requests and Limits]]
- [[Container Internals]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
