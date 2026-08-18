# Services, DNS and Ingress

## Concept

Kubernetes provides several layers for exposing and discovering workloads:

- **Service** – stable virtual IP + DNS name in front of a set of Pods
- **Cluster DNS** (CoreDNS) – name resolution for Services and Pods
- **Ingress** – HTTP/HTTPS routing from outside the cluster to Services

## Why it matters

Many “application is down” reports are actually:
- Service has no healthy endpoints
- DNS resolution failing inside the cluster
- Ingress controller or rules misconfigured
- Network policies blocking traffic

## Mental Model

```
External Client
    ↓
Ingress Controller (optional)
    ↓
Service (ClusterIP / NodePort / LoadBalancer)
    ↓
Endpoints / EndpointSlices
    ↓
Pods
```

Inside the cluster, Pods talk to each other via Service DNS names:

```
my-service.my-namespace.svc.cluster.local
```

## Key Commands

```bash
# Services and endpoints
kubectl get svc -A
kubectl get endpoints -A
kubectl describe svc <service> -n <ns>

# DNS debugging
kubectl get pods -n kube-system | grep coredns
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup my-service.my-namespace

# Ingress
kubectl get ingress -A
kubectl describe ingress <name> -n <ns>

# Test from inside the cluster
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- curl -v http://my-service.my-namespace
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Service has no endpoints             | Selector doesn’t match Pods / Pods not Ready | `kubectl get endpoints`, Pod labels & readiness |
| DNS name doesn’t resolve             | CoreDNS issue or wrong name               | CoreDNS pods, nslookup from a Pod |
| External traffic doesn’t reach app   | Ingress / LoadBalancer / firewall         | Ingress controller logs, Service type |
| Intermittent connectivity            | Network policy, kube-proxy, CNI           | Network policies, node health    |

## Investigation Tips

- Always check **Endpoints** (or EndpointSlices) — a Service with zero endpoints will never work.
- Readiness probes directly affect whether a Pod is added to endpoints.
- Test DNS and connectivity *from another Pod* inside the cluster, not only from outside.
- Ingress problems are often in the controller logs or in the Ingress object’s events.

## Related Notes

- [[Kubernetes Architecture]]
- [[Pod Troubleshooting]]
- [[TCP IP Troubleshooting Model]]
- [[DNS Resolution]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
