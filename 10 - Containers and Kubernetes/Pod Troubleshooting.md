# Pod Troubleshooting

## Concept

Pod troubleshooting is a **state machine problem**. Read the phase and container statuses first, then the Events, then logs. Most Pods fail in a small set of modes; jumping straight to `exec` wastes the signal Kubernetes already put in the API object.

## Why it matters

- Pods are where application, image, schedule, network, and storage failures surface
- The same symptom ("not Ready") has different fixes depending on Pending vs ImagePull vs CrashLoop vs probe failure
- Guessing produces `kubectl delete pod` loops that destroy evidence (`--previous` logs, Events)
- A reliable order of operations turns 30-minute flails into 5-minute diagnoses

## Mental Model

```
Phase / STATUS column
    → Events (why the controllers / kubelet did what they did)
        → Container status (waiting reason, exit code, restart count)
            → Logs (--previous if crashing)
                → describe node / image / mounts / probes
```

Container states that matter:

- **Waiting** — ImagePullBackOff, CreateContainerConfigError, CrashLoopBackOff (between restarts)
- **Running** — started; may still be unready
- **Terminated** — exit code, reason (OOMKilled, Error, Completed)

## Key Commands

```bash
# Picture
kubectl get pods -n <ns> -o wide
kubectl get pods -n <ns> -w

# Source of truth
kubectl describe pod <pod> -n <ns>
kubectl get pod <pod> -n <ns> -o yaml

# Logs
kubectl logs <pod> -n <ns> -c <container>
kubectl logs <pod> -n <ns> -c <container> --previous
kubectl logs <pod> -n <ns> --all-containers --tail=100

# Events in the namespace (not only on the pod object)
kubectl get events -n <ns> --sort-by='.lastTimestamp'

# Resources
kubectl top pod <pod> -n <ns>
kubectl describe pod <pod> -n <ns> | grep -A6 -E 'Limits|Requests|Conditions'

# Exec only after the above
kubectl exec -it <pod> -n <ns> -c <container> -- /bin/sh
```

## Common States & What To Do

| State | Meaning | First actions |
|-------|---------|---------------|
| Pending | Not scheduled | Events: FailedScheduling — CPU/mem, taints, affinity, PVC |
| ContainerCreating | Sandbox / mounts / image pull in progress | Stuck? describe + CSI/CNI pods |
| ImagePullBackOff | Cannot pull | Image name/tag, imagePullSecrets, registry network, node credentials |
| CrashLoopBackOff | Process exits repeatedly | `logs --previous`; exit code; command/args; config |
| CreateContainerConfigError | Bad secret/configmap reference | describe Events; missing key |
| Running but 0/1 Ready | Readiness probe failing or slow start | Probe path/port; app listen address; `logs` |
| OOMKilled | cgroup memory limit | Limits vs working set; leak vs undersized limit |
| Error / Completed | Terminated | Exit code; Job vs long-running Deploy |
| Evicted | Node pressure | `describe node`; disk/inodes/memory pressure |

## Decision Flow

```
Pending?
  └─ describe → FailedScheduling → capacity, taints, affinity, PVC unbound

ImagePullBackOff?
  └─ Events → image string, pull secret, registry reachability from *node*

CrashLoopBackOff / Error?
  └─ logs --previous → exit code → bad config vs app bug vs missing dependency
  └─ check liveness probe killing the container on slow start

Running, not Ready?
  └─ readiness probe, Service selectors, app still binding

Running, Ready, traffic fails?
  └─ leave this note → [[Services DNS and Ingress]] and NetworkPolicy
```

## Investigation Tips

- **Events first.** The bottom of `kubectl describe pod` is often the entire answer.
- Keep `--previous` logs before you delete the Pod. CrashLoop evidence dies with the container.
- Exit code 137 often means SIGKILL (OOM or forced kill); 143 SIGTERM; 1 generic app error. Confirm with reason in container status.
- Liveness probes that are too tight turn slow starts into CrashLoops. If logs look healthy and restarts climb, read the probe.
- ImagePullBackOff on *one* node only → node-specific credentials or egress. On all nodes → name, tag, or registry policy.
- Pending with an unbound PVC is a storage problem, not a scheduler CPU problem. Check PVC/PV before adding nodes.
- `kubectl debug` / ephemeral containers help when the image has no shell; still collect describe+logs first.
- Compare a healthy Pod YAML to a bad one (`diff <(kubectl get pod … -o yaml)`). Drift in probes, mounts, and env is common after partial rollouts.

## Related Notes

- [[Kubernetes Architecture]]
- [[Resource Requests and Limits]]
- [[Services DNS and Ingress]]
- [[Container Internals]]
- [[Persistent Storage]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I deleted CrashLoop pods to "start clean" and lost `--previous` logs that showed a bad migration on boot. Describe and logs before delete, always.
- A readiness probe on `/healthz` against the admin port while the app listened only on `:8080` produced Running 0/1 forever with clean app logs. Probe config is part of the app contract.
- ImagePullBackOff with a private registry was "fine on my laptop" because my laptop had `docker login`. Nodes need imagePullSecrets or node-level credentials; the error is not subtle once you look at Events.
- OOMKilled at 256Mi on a Java service was not a leak; it was a heap set to 512Mi. Limits must exceed the process's own configured heap plus overhead.
