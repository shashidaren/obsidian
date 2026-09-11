# Kubernetes Architecture

## Concept

Kubernetes is a **declarative reconciliation loop**. You write desired state (Deployments, Services, …). Controllers watch that state in etcd via the API server and continuously push actual state toward it.

Two planes:

- **Control plane** — API server, etcd, scheduler, controller-manager (and cloud-controller-manager when present)
- **Data plane (workers)** — kubelet, container runtime (containerd/CRI-O), kube-proxy or equivalent dataplane, CNI plugin

Pods are the smallest deployable unit. Containers in a Pod share network namespace and often volumes; they are scheduled together onto one node.

## Why it matters

Almost every Kubernetes incident falls into one layer:

- Control plane / etcd health
- Scheduling and placement
- Node / kubelet / runtime
- Pod lifecycle and application
- Service networking / CNI / DNS
- Storage (PV/PVC/CSI)
- AuthN/AuthZ and admission

If you do not know which layer owns the symptom, you restart random Pods and lose time. Architecture is the map for triage.

## Mental Model

```
User / CI / GitOps
        │  kubectl / API
        ▼
   kube-apiserver  ◄──── admission, authn/authz
        │
        ▼
      etcd          (desired + observed state)
        │
        ├──────────── controllers (Deployment, ReplicaSet, EndpointSlice, …)
        ├──────────── scheduler (Pod → Node binding)
        ▼
   kubelet on node → CRI (containerd) → Pod sandbox + containers
        │
        └──────────── CNI + kube-proxy/dataplane → Service traffic
```

Reconciliation is eventually consistent. "I applied the YAML" is not the same as "the cluster matches the YAML". Watch status and Events.

## Key Components

| Component | Role | Failure symptom |
|-----------|------|-----------------|
| kube-apiserver | Only public control-plane API | kubectl hangs/fails; controllers stall |
| etcd | Source of truth | API latency, leader election issues, lost writes |
| scheduler | Binds free Pods to nodes | Pods stuck Pending (FailedScheduling) |
| controller-manager | Replica counts, Jobs, endpoints, … | Objects not converging |
| kubelet | Node agent; runs Pods via CRI | Node NotReady; Pods not starting |
| container runtime | Pulls images, creates containers | ImagePullBackOff, CreateContainerError |
| CNI plugin | Pod IPs, routes, NetworkPolicy | Pods Running but unreachable |
| kube-proxy / dataplane | Service VIP → endpoints | Service IP works on node, fails in Pod (or vice versa) |

## Key Commands

```bash
# Wide health
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get events -A --sort-by='.lastTimestamp' | tail -30

# API / control plane
kubectl get --raw='/readyz?verbose'
kubectl get --raw='/healthz?verbose'
kubectl -n kube-system get pods

# Node and capacity
kubectl describe node <node>
kubectl top nodes
kubectl get pods -A --field-selector spec.nodeName=<node>

# Object status (desired vs actual)
kubectl get deploy,rs,pod -n <ns>
kubectl describe deploy <name> -n <ns>
kubectl get endpointslices -n <ns>
```

Managed clusters (EKS/GKE/AKS) hide etcd and sometimes the API server process list. You still diagnose via API latency, `readyz`, and control-plane events.

## Common Failure Modes & Symptoms

| Symptom | Typical layer | First checks |
|---------|---------------|--------------|
| Pods Pending | Scheduler / resources / taints / affinity | `describe pod` Events; node allocatable |
| Node NotReady | kubelet, runtime, disk pressure, network | `describe node`; kubelet logs; `df` |
| CrashLoopBackOff | App, config, probes | logs --previous; probe definitions |
| ImagePullBackOff | Image name, registry auth, network | Events; `crictl pull` on node |
| Service has no endpoints | Selector mismatch, Pods not Ready | `get endpointslices`; Pod labels + readiness |
| API slow or timeouts | apiserver / etcd / webhook latency | readyz; admission webhook timeouts |
| NetworkPolicy "broke prod" | CNI policy engine | Recent Policy objects; default-deny behaviour |
| Volume stuck Attach/Mount | CSI, IAM, zone mismatch | `describe pvc/pv`; CSI pod logs |

## Investigation Tips

- Start with `kubectl get nodes` and `kubectl get pods -A`. Then `describe` the unhealthy object and **read Events from the bottom**.
- Pending is almost never fixed by restarting the Pod. Fix scheduling constraints or capacity.
- Ready vs Running: a Pod can run containers and still fail readiness, so Services omit it. Check probes before blaming CNI.
- If kubectl itself fails, the problem is control plane or your path to the API — not the workload.
- kube-system and the CNI namespace are production. Treat their Pods with the same care as customer apps.
- Prefer `kubectl get -o wide` and Events over speculative `exec` into every container.
- Version skew (kubectl vs server vs node) produces confusing errors. Check `kubectl version` early when behaviour looks impossible.

## Related Notes

- [[Pod Troubleshooting]]
- [[Services DNS and Ingress]]
- [[Resource Requests and Limits]]
- [[Container Internals]]
- [[Persistent Storage]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I once spent an hour on application logs for a "network outage" that was Pending Pods after a node drain. `get pods -o wide` showed no node assigned. Scheduling first, packets second.
- An admission webhook timed out and blocked *all* new Pods, including the fix I was trying to roll. Know how to bypass or scale the webhook path in an emergency, and monitor webhook latency like any other dependency.
- `kubectl get componentstatuses` lied on modern clusters while `readyz` told the truth. Prefer livez/readyz and actual kube-system Pod health.
- ReplicaSet status and Deployment conditions often explain "I applied but nothing moved" before any container log will.
