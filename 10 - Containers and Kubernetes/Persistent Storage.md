# Persistent Storage

## Concept

Kubernetes storage is a binding problem, not a mount problem. A **PersistentVolume (PV)** is a piece of storage that exists in the cluster. A **PersistentVolumeClaim (PVC)** is a request (“I need 100Gi, ReadWriteOnce, fast-ssd”). A **StorageClass** is the template a provisioner uses to create PVs on demand. The Pod only *mounts* a bound claim.

Until the PVC is **Bound** and the volume is **attached** to the node and **mounted** into the Pod, the workload is not ready — no matter how healthy the Deployment looks.

## Why it matters

- Unbound PVCs are a leading cause of Pods stuck in `Pending`.
- Access modes and attach limits explain “works on one replica, pending on the second”.
- Reclaim policy decides whether deleting a PVC is a resize… or a wipe.
- The performance you get is the backend’s performance (cloud disk, NFS, Ceph, local SSD), filtered through the CSI attach/mount path.
- Databases on `emptyDir` are a restore test you did not schedule.

## Mental Model

```
Admin or CSI provisioner
        ↓
StorageClass  ──dynamic──→  PersistentVolume
                                  ↑ bind
Pod  ──volumeMount──→  PersistentVolumeClaim

Attach (controller) → node disk/device
Mount  (kubelet + CSI node plugin) → path in the container
```

Static provisioning: human creates a PV; a matching PVC binds it.  
Dynamic provisioning: PVC + StorageClass → provisioner creates the PV.

Access modes (what the *API* promises, not always what the filesystem allows):

| Mode | Typical meaning |
|------|-----------------|
| `ReadWriteOnce` (RWO) | One node at a time |
| `ReadWriteMany` (RWX) | Many nodes, shared FS (NFS/CephFS-like) |
| `ReadOnlyMany` (ROX) | Many nodes, read-only |
| `ReadWriteOncePod` | One Pod, period |

`Retain` keeps the PV and data when the PVC dies (you must clean up). `Delete` asks the provisioner to destroy the backend volume.

## Key Commands

```bash
# Cluster view
kubectl get storageclass
kubectl get pv
kubectl get pvc -A
kubectl get volumeattachment

# Why is this claim pending?
kubectl describe pvc <pvc> -n <ns>
kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'

# What did the Pod actually mount?
kubectl get pod <pod> -n <ns> -o jsonpath='{range .spec.volumes[*]}{.name}{"\t"}{.persistentVolumeClaim.claimName}{"\n"}{end}'
kubectl exec -n <ns> <pod> -- df -h
kubectl exec -n <ns> <pod> -- mount | grep -E 'pvc|nfs|rbd|csi'

# CSI / node side when attach fails
kubectl -n kube-system get pods | grep -iE 'csi|provisioner|attacher'
kubectl logs -n kube-system <csi-controller-pod> --tail=100

# Backend leftovers after a Retain
kubectl get pv -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,RECLAIM:.spec.persistentVolumeReclaimPolicy,CLAIM:.spec.claimRef.name
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| PVC Pending, no PV | Wrong StorageClass, quota, provisioner down | SC name, provisioner logs, cloud API quotas |
| PVC Pending, PVs exist | Selector / class / access mode / size mismatch | Compare PVC spec to PV spec field by field |
| Pod Pending: “unbound PVC” | Claim not Bound yet | `describe pvc` Events |
| Pod Pending: “node(s) had volume node affinity” | RWO volume already attached elsewhere; zone mismatch | VolumeAttachment, node AZ vs PV zone |
| Multi-attach error | Two Pods on two nodes, one RWO disk | Replica count vs access mode |
| Mount failed, permission denied | fsGroup, SELinux, NFS root_squash, wrong UID | `describe pod`, `ls -lZ` in container |
| Data missing after reschedule | Used `emptyDir` or a new PVC each time | Volume spec; StatefulSet vs Deployment |
| Delete PVC, data gone | `reclaimPolicy: Delete` | SC and PV reclaim fields |
| Capacity / inode full *inside* the volume | Application filled the PVC, not the node | `df -h` *in the pod* |
| Slow I/O | Tiny cloud volume, bursting exhausted, NFS latency | Backend metrics, `iostat` on node |

## Investigation Tips

- Always pair `describe pvc` with `describe pod`. The PVC tells you binding; the Pod tells you attach/mount.
- Zone-aware disks cannot follow a Pod to another AZ. Topology is a scheduling constraint disguised as storage.
- StatefulSets give stable PVC identities (`data-<sts>-0`). Deployments do not. Do not run a single-writer database as a Deployment with a shared RWO claim and `replicas: 2`.
- `subPath` mounts fail in ways that look like empty directories when the subPath was never created. Check the volume root.
- Expanding a PVC is two steps: the claim size, then the filesystem (`resize2fs` / `xfs_growfs` — CSI often does this, until it does not).
- For NFS: the server, export options, and network path are still NFS. Kubernetes will not fix `soft` vs `hard` or a wedged lock.
- Before you delete a PVC in anger, read reclaim policy out loud.

## Related Notes

- [[Kubernetes Architecture]]
- [[Pod Troubleshooting]]
- [[Image and Layer Concepts]]
- [[NFS Troubleshooting]]
- [[Disk I/O and Latency]]
- [[Backup Strategy]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A Postgres “cluster” with two replicas and one RWO EBS volume spent its life with one Pod running and one Pending. That is the access mode working as designed.
- We deleted a PVC to “recreate it bigger” on a StorageClass with `Delete`. The cloud disk vanished. Restore from last night’s snapshot became the change window.
- `df` on the *node* was fine. `df` in the *container* was 100%. PVC size ≠ node disk. Look where the process writes.
