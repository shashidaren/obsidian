# Services, DNS and Ingress

## Concept

Kubernetes exposes and discovers workloads in layers:

- **Service** — stable virtual IP + DNS name in front of Pods selected by labels
- **EndpointSlice / Endpoints** — the actual ready Pod IPs the Service currently targets
- **Cluster DNS (CoreDNS)** — resolves Service (and Pod) names inside the cluster
- **Ingress / Gateway** — L7 HTTP(S) routing from outside to Services (controller-dependent)

A Service with zero ready endpoints is a black hole. Most "Service is down" tickets are selector, readiness, or DNS problems rather than broken kube-proxy magic.

## Why it matters

- Apps depend on in-cluster DNS names; when CoreDNS or search domains break, everything looks like an application outage
- Readiness probes gate membership in endpoints — a probe failure removes traffic without deleting the Pod
- Ingress misconfig produces 404/502 that look like app bugs
- NetworkPolicies can allow Pod-to-Pod and still block Pod-to-CoreDNS or Pod-to-Ingress

## Mental Model

```
External client
      │
      ▼
Ingress / LoadBalancer (optional)
      │
      ▼
Service (ClusterIP / NodePort / LoadBalancer)
      │
      ▼
EndpointSlice (only Ready Pods matching selector)
      │
      ▼
Pod IPs  (CNI)
```

In-cluster DNS name shape:

```
<service>.<namespace>.svc.cluster.local
```

Short names work only if `search` domains in the Pod's `resolv.conf` include the right suffixes (and `ndots` allows it). Prefer FQDNs in application config.

## Key Commands

```bash
# Service and backing endpoints
kubectl get svc -n <ns>
kubectl describe svc <svc> -n <ns>
kubectl get endpointslices -n <ns> -l kubernetes.kubernetes.io/service-name=<svc>
kubectl get endpoints -n <ns> <svc>            # older view, still useful

# Selectors vs Pod labels (the usual bug)
kubectl get pods -n <ns> --show-labels
kubectl get svc <svc> -n <ns> -o jsonpath='{.spec.selector}'

# DNS
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
kubectl run -it --rm dbg --image=busybox:1.36 --restart=Never -- \
  nslookup <svc>.<ns>.svc.cluster.local

# From a debug Pod: Service VIP and direct Pod IP
kubectl run -it --rm dbg --image=curlimages/curl --restart=Never -- \
  curl -sv --connect-timeout 3 http://<svc>.<ns>.svc.cluster.local:<port>/

# Ingress
kubectl get ingress -A
kubectl describe ingress <name> -n <ns>
kubectl logs -n <ingress-ns> -l app=<ingress-controller> --tail=100
```

Service types (short):

| Type | Scope |
|------|--------|
| ClusterIP | In-cluster only (default) |
| NodePort | Opens high port on nodes |
| LoadBalancer | Cloud/provider external LB |
| ExternalName | CNAME to external DNS name |

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Service has no endpoints | Selector mismatch; Pods not Ready | labels vs selector; readiness |
| DNS NXDOMAIN in Pod | Wrong name; CoreDNS down; search/ndots | nslookup FQDN; CoreDNS pods |
| DNS slow | CoreDNS CPU; ndots search storms | CoreDNS metrics/logs; use FQDN |
| ClusterIP works, external fails | LB/SG/Ingress | External path only; health checks |
| 502 via Ingress | No healthy upstream endpoints | endpoints; app readiness; controller logs |
| 404 via Ingress | Rule/path/host mismatch | Ingress rules vs request Host/path |
| Intermittent failures | Partially ready pods; policy; conntrack | endpoint count; NetworkPolicy |
| Works hostNetwork, fails normal Pod | CNI / policy / DNS config | resolv.conf; policy; CNI pods |

## Investigation Tips

- **Endpoints first.** `describe svc` or EndpointSlices with empty targets means traffic has nowhere to go. Fix selectors or readiness before touching kube-proxy.
- Readiness probe failures remove Pods from Service traffic while leaving them Running. `kubectl get pods` READY column is part of Service debugging.
- Test from a **Pod in the same namespace** (or with the same DNS config as the client). Laptop DNS is not cluster DNS.
- Confirm the FQDN with a trailing behaviour in mind: `ndots:5` makes short names expensive and sometimes surprising — see [[DNS Resolution]].
- Ingress is only as healthy as its controller Deployment and the Service it points to. Debug controller logs and the backend Service as two separate objects.
- NetworkPolicy: verify egress to CoreDNS (usually kube-system) and to the backend Pods. Default-deny without DNS allowance looks like total cluster failure.
- Avoid `latest` debug images in prod clusters if policy requires digests; keep a known debug image.

## Related Notes

- [[Kubernetes Architecture]]
- [[Pod Troubleshooting]]
- [[DNS Resolution]]
- [[TCP IP Troubleshooting Model]]
- [[Resource Requests and Limits]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Service selector used `app: api` while the Deployment labels were `app: api-v2` after a rename. Empty endpoints, perfect Pods. Diff labels against selector every time.
- Readiness on `/ready` returned 200 before the app opened its listen socket. The Pod was Ready, got traffic, reset connections, failed readiness, flapped. Probe the real listen path.
- CoreDNS was fine; a default-deny NetworkPolicy blocked the app namespace from `kube-system`. Symptoms were pure DNS timeouts. Policy and DNS share the critical path.
- Ingress 502s were chased in the app while the Service had zero endpoints during a rollout that used maxUnavailable 100%. Watch endpoint count during deploys.
