# Persistent Storage

## Concept

Kubernetes abstracts storage with:

- **PersistentVolume (PV)** – actual storage resource (NFS, cloud disk, local, etc.)
- **PersistentVolumeClaim (PVC)** – request for storage by a user/Pod
- **StorageClass** – dynamic provisioning template

Pods mount PVCs as volumes.

## Why it matters

Storage issues are a frequent source of Pending Pods, data loss risk, and performance problems.  
Binding, attaching, mounting, and permissions can each fail independently.

## Mental Model

```
StorageClass (optional)
    ↓ dynamic provisioning
PersistentVolume (PV)
    ↓ bound to
PersistentVolumeClaim (PVC)
    ↓ mounted by
Pod
```

Static provisioning: admin creates PV, user creates PVC that matches it.  
Dynamic provisioning: PVC triggers creation of a PV via a StorageClass.

## Key Commands

```bash
# Overview
kubectl get pv
kubectl get pvc -A
kubectl get storageclass

# Details
kubectl describe pv <pv>
kubectl describe pvc <pvc> -n <ns>

# See what a Pod is mounting
kubectl describe pod <pod> -n <ns> | grep -A20 Mounts
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Pod Pending – “unbound PVC”          | No matching PV or StorageClass issue      | `kubectl get pvc`, Events        |
| PVC stuck in Pending                 | No StorageClass / provisioning failure    | StorageClass, provisioner logs   |
| Mount errors in Pod events           | Attach/mount failure, permissions, FS issues | `describe pod`, node logs     |
| Data missing after Pod restart       | Using emptyDir instead of PVC             | Volume definition in Pod         |
| Performance problems                 | Slow underlying storage or wrong access mode | Storage backend, ReadWriteOnce vs Many |

## Investigation Tips

- Always look at both the PVC and the PV.
- Check the Events on the PVC and the Pod.
- Access modes matter: `ReadWriteOnce` can usually only be mounted by one node at a time.
- For cloud volumes, also check the cloud provider console (volume attachment state).
- Deleting a PVC can delete the underlying volume depending on the reclaim policy (`Retain` vs `Delete`).

## Related Notes

- [[Kubernetes Architecture]]
- [[Pod Troubleshooting]]
- [[Docker Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
