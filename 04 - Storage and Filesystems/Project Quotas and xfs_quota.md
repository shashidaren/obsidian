# Project Quotas and xfs_quota

## Concept

XFS project quotas assign a numeric project ID to a directory tree and then apply block and inode limits to that project, independent of the user who owns the files. They are the usual way to give per-tenant or per-container limits on a shared XFS filesystem.

The project ID is stored in the directory’s inode attributes. Children inherit it. The kernel enforces the limit on every write that would exceed the hard quota.

## Why it matters

- Shared `/data` or container roots fill up one tenant and take everyone else down. Project quotas contain the damage without a separate filesystem.
- `df` still shows free space; the application receives `EDQUOT`. Without knowing about project quotas you chase the wrong problem.
- Enabling the feature requires the filesystem to be mounted with `prjquota` and the directory to be explicitly assigned. Missing either step makes the quota decorative.

## Mental Model

```
/etc/projects          → maps project name → numeric ID
/etc/projid            → same, reverse
directory inode        → project ID attribute (xfs_quota project -s)
XFS quota              → tracks usage per project ID
write that exceeds hard limit → EDQUOT to that project only
```

User and group quotas can coexist. The tightest applicable limit wins.

## Key Commands

```bash
# Is project quota enabled?
findmnt -o TARGET,OPTIONS /data | grep prjquota
xfs_quota -x -c 'print' /data

# Define projects (persistent)
echo "100:/data/tenantA" >> /etc/projects
echo "tenantA:100" >> /etc/projid

# Assign and set limits
xfs_quota -x -c 'project -s tenantA' /data
xfs_quota -x -c 'limit -p bhard=10g ihard=100000 tenantA' /data

# Report
xfs_quota -x -c 'report -p -h' /data
xfs_quota -x -c 'report -p -n' /data   # numeric IDs

# Clear
xfs_quota -x -c 'project -C tenantA' /data
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Disk quota exceeded` but `df` has space | Project hard limit hit | `xfs_quota report -p` |
| Quota configured, never enforced | Not mounted with `prjquota` or directory not assigned | `findmnt`, `xfs_quota project -d` |
| New files under the tree not counted | Directory not marked, or created before assignment | re-run `project -s` |
| Limits disappear after reboot | Only set in memory, not in `/etc/projects` + setup script | check `/etc/projects`, mount options |
| Container fills host | No project ID on the volume mount | both cgroup and XFS project |
| Soft limit ignored | Still in grace | report grace column |

## Investigation Tips

- When you see `EDQUOT`, run `xfs_quota -x -c 'report -p -h'` on the mount that contains the path before you look at `df`.
- `xfs_quota -x -c 'project -d /path'` shows whether the directory actually has a project ID.
- After adding a new tenant directory, you must both define the project and run `project -s`. Inheritance only works for new files created after the attribute is set.
- Project quotas require the `prjquota` mount option (or `pquota`). Adding it usually needs a remount or reboot depending on the distro.
- Combine with monitoring: alert when a project exceeds 80 % of its hard limit so you hear about it before the application stops.

## Related Notes

- [[Disk Quotas]]
- [[XFS Operations]]
- [[Disk Full Runbook]]
- [[Inodes]]
- [[df and du Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A multi-tenant XFS volume had project quotas “configured” in a wiki. `xfs_quota report` showed zero usage for every project because the directories had never been marked with `project -s`. The first tenant to run a backup filled the filesystem.
- Raising a project limit required both the `limit` command and a note in the runbook; the next person who rebuilt the host from the image lost the higher limit until the `/etc/projects` and a systemd oneshot were added.
