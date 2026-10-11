# Disk Quotas

## Concept

Disk quotas limit how much space or how many inodes a user, group, or project can consume on a filesystem. They are enforced by the filesystem (ext4, XFS) after the quota feature is turned on and the quota files are consistent.

Soft limits warn; hard limits reject the write with `EDQUOT`. Grace periods let a user exceed the soft limit for a while before it becomes hard.

## Why it matters

- A full filesystem that `df` says has free space is often a quota. The application sees `Disk quota exceeded`.
- Runaway processes (logs, build caches, mail spools) are contained without filling the volume for everyone else.
- Project quotas (XFS) or directory quotas give per-tenant limits on a shared filesystem without a separate mount.
- Quotas that were never turned on, or whose files are corrupt, silently do nothing until the incident.

## Mental Model

```
filesystem mounted with quota option (usrquota, grpquota, prjquota)
    → quota files (aquota.user, aquota.group) or XFS internal
         → kernel tracks usage
              → write that would exceed hard limit → EDQUOT

repquota / quota  → human view
edquota           → set limits
quotacheck        → rebuild accounting (offline or careful)
```

XFS project quotas are often used for containers or per-directory limits. They require the project to be defined and the directory to be marked.

## Key Commands

```bash
# Is quota on for this mount?
mount | grep -E 'usrquota|grpquota|prjquota'
findmnt -o TARGET,OPTIONS /home

# Usage
repquota -a
repquota -u /home
quota -u username
quota -g groupname

# XFS
xfs_quota -x -c 'report -h' /data
xfs_quota -x -c 'report -p -h' /data

# Set limits (interactive or via setquota)
edquota -u username
setquota -u username 1000000 1100000 0 0 /home

# Turn on (ext)
quotacheck -cugm /home
quotaon -v /home

# Grace
edquota -t
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Disk quota exceeded` but `df` shows space | User/group/project hard limit hit | `quota -u`, `repquota` |
| Quota “set” but never enforced | Filesystem not mounted with quota option, or quotaon not run | `findmnt`, `quotaon -p` |
| Usage looks wrong after crash | Quota files inconsistent | `quotacheck` (plan downtime) |
| XFS project quota ignored | Project not assigned to directory | `xfs_quota -x -c 'project -d /path'` |
| Soft limit exceeded, writes still work | Still inside grace period | `repquota` grace column |
| Only some users affected | Limits differ; or only user quota on | `repquota -a` |
| Container fills host despite limit | No project quota or cgroup limit | both layers |

## Investigation Tips

- When an application logs `EDQUOT` or “quota exceeded”, run `quota` for that UID before you look at `df`. They answer different questions.
- `repquota -a` on a large filesystem can be slow. Target the mount that owns the path (`findmnt -T`).
- After enabling quotas, always run `quotacheck` or the XFS equivalent so the accounting matches reality. Otherwise the first writes are allowed and the numbers are fiction.
- Grace periods surprise people. A user who was “fine yesterday” hits the hard limit today when the grace expires.
- Project quotas and user quotas can both apply. The tighter one wins.
- Quotas do not replace monitoring. Alert on soft-limit breaches so you hear about the problem before the hard limit stops the service.

## Related Notes

- [[Filesystems and Mounts]]
- [[df and du Deep Dive]]
- [[Inodes]]
- [[Disk Full Runbook]]
- [[XFS Operations]]
- [[ext4 Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A build user filled `/home` according to the ticket. `df` showed 40 % free. `quota -u build` showed the hard block limit reached. Raising the quota (and cleaning the cache) fixed it; enlarging the filesystem would have been the wrong change.
- Quotas were configured in fstab but `quotaon` had never been run after the last fsck. They had been decorative for months.
- An XFS project quota on a container root was never applied because the directory was not marked with the project ID. `xfs_quota report` showed zero usage for that project while the directory grew.
