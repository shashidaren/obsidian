# Backup Strategy

## Concept

A backup strategy defines what data is protected, how often it is copied, where the copies live, how long they are retained, and how quickly they can be restored. It is driven by Recovery Point Objective (RPO) and Recovery Time Objective (RTO), not by "we take a nightly dump".

## Why it matters

- Disk failure, ransomware, human error, and bad deploys all destroy data; backups are the last line of defence
- Untested backups are not backups — restore success rate is the real metric
- Correlated failures (same rack, same cloud region, same credentials) wipe out multiple copies at once
- Compliance and audit requirements almost always demand proven retention and recoverability

A strategy that only lives on the primary storage array is a single point of failure with extra steps.

## Mental Model

```
3-2-1 (classic minimum):
  3 copies of the data
  2 different media / technologies
  1 off-site (or offline / immutable)

Key dimensions:
  What     → databases, filesystems, configs, secrets, VMs, object storage
  When     → frequency (RPO) and retention windows
  Where    → local, remote, air-gapped, immutable object lock
  How      → full / incremental / differential / continuous (CDC, snapshots)
  Who      → ownership, access, encryption keys
  Prove    → scheduled restore tests, not just "job succeeded"
```

RPO = how much data you can afford to lose.
RTO = how long you can afford to be down while restoring.

Scope is usually wider than "the database":

- Application data and object buckets
- Machine images / VM snapshots if rebuild time matters
- Config and IaC state (or the repo that generates them)
- Secrets and TLS material, stored separately from the data copies
- Identity of the restore environment (cloud accounts, DNS, package mirrors)

Snapshots on the same array are a convenience, not an off-site copy.

## Key Commands

```bash
# Quick local filesystem snapshot examples (illustrative)
rsync -aHAX --delete /data/ /backup/data/
rsync -aHAX --delete --link-dest=/backup/prev /data/ /backup/current/

# Database dumps (examples — adapt to your engine)
pg_dump -Fc -f /backup/db_$(date +%F).dump mydb
mysqldump --single-transaction --routines --triggers mydb > /backup/db.sql

# Verify a tarball or dump is readable
tar -tzf /backup/files_$(date +%F).tar.gz | head
pg_restore -l /backup/db.dump | head
restic snapshots
borg list /backup/repo

# Check backup job logs / systemd timers
systemctl list-timers | grep -i backup
journalctl -u backup-job -n 50 --no-pager

# Destination health
df -hT /backup
find /backup -type f -mtime -1 -ls | head

# Object storage / remote (examples)
aws s3 ls s3://my-backups/ --recursive | tail
rclone check /data remote:backups/data

# Inventory: what is *not* in the backup set?
# Compare running services and mount points against the backup include list
findmnt -D
systemctl list-units --type=service --state=running
```

Exact tooling (Bacula, Borg, restic, Velero, cloud native snapshots, vendor agents) varies; the principles do not.

## Common Failure Modes & Symptoms

| What you discover | Likely cause | First checks |
|-------------------|--------------|--------------|
| Backup job "succeeded" but restore fails | Silent corruption, incomplete dump, wrong path | Restore to scratch; see [[Restore Testing]] |
| Missing recent backups | Timer/cron broken, disk full, credentials expired | Job logs, `list-timers`, destination free space |
| All copies in one failure domain | Same region / same credentials / same array | Map physical and logical locations of every copy |
| Ransomware encrypts backups too | Backups online and writable with same credentials | Offline / immutable / separate identity |
| Restore takes far longer than RTO | No bandwidth plan, full restore only, untested | Time a real restore; measure throughput |
| Configs / secrets not included | Only "data" was scoped | Inventory what the application actually needs |
| Encryption keys lost | Keys only on the primary system | Key escrow / separate secure storage |
| Incremental chain broken | Failed full, pruned parent, mixed tools | Can you restore *this week* from what remains? |
| Snapshot mistaken for a backup | Same array, same credentials, same blast radius | Ask "survives array / account loss?" |

## Investigation Tips

- Start from the restore, not the backup job. "Can I get the data back?" is the only question that matters.
- Document the exact restore procedure (commands, order, dependencies) and keep it with the runbooks.
- Test restores on a schedule (quarterly at minimum for critical data). Record time taken and any surprises.
- Separate backup credentials from production credentials; prefer write-once or short-lived tokens where possible.
- Watch destination capacity *and* inode usage — full backup targets are a classic silent failure.
- For databases, prefer consistent methods (snapshots with freeze, `--single-transaction`, storage-level consistency groups) over naive file copies of live data files.
- Encrypt in transit and at rest; protect the keys as carefully as the data.
- Put an alert on "last successful backup older than RPO", not only on job failure. A disabled timer does not fail.
- Revisit scope after every architecture change. New disks and new buckets are born unprotected.

## Related Notes

- [[Disaster Recovery]]
- [[Restore Testing]]
- [[High Availability]]
- [[Database Backup and Restore]]
- [[Secrets Management]]
- [[rsync]]
- [[Change Management]]
- [[Incident Management]]
- [[Alert Design]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Nightly job green for months. The include list still pointed at the old mount. The new volume that held production data had never been backed up. Inventory mounts against the backup config after every storage change.
- We treated array snapshots as off-site copies because they were "on the other controller." The array firmware bug took both. Off-site means a different product *and* a different identity.
- Ransomware used the same AD service account that wrote the backup share. Immutable object lock plus a separate backup principal would have left us a restore path. Writable backups are not backups; they are extra copies of production.
- A 2-hour RTO assumed restore bandwidth we did not have from the DR region. The first timed restore took 11 hours. Publish the measured number, not the brochure number.
