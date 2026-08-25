# NFS Troubleshooting

## Concept

NFS (Network File System) exposes remote directories as local mounts. Failures span the whole stack: DNS, routing, firewall, RPC services, exports, identity mapping (UID/GID or Kerberos), and storage latency on the server. A “hung” application is often blocked on an NFS I/O that will never complete.

## Why it matters

- NFS hangs can freeze processes in uninterruptible sleep (`D` state); load average climbs while CPU stays low
- Soft vs hard mounts change whether timeouts surface as errors or indefinite stalls
- Permission problems are frequently UID/GID mismatch or root_squash, not Unix mode bits on the client
- Stale file handles appear after server-side export or inode changes

Distinguish “cannot mount” from “mount works but I/O stalls” — the playbooks differ.

## Mental Model

```
Client                          Server
------                          ------
mount.nfs / nfsd
  ↓                               ↓
RPC (portmapper / rpcbind)  ←→  rpcbind, nfsd, mountd, idmapd…
  ↓                               ↓
TCP/UDP to ports              exports (/etc/exports)
  ↓                               ↓
VFS + page cache              underlying filesystem / storage

Hard mount  → retries forever (can hang processes)
Soft mount  → returns error after retransmissions (apps must handle EIO/ETIMEDOUT)
```

NFSv3 is still common; NFSv4(+kerberos) adds state and idmapping complexity.

## Key Commands

```bash
# Client: what is mounted and how?
mount | grep nfs
findmnt -t nfs,nfs4
cat /proc/mounts | grep nfs

# Show NFS stats / stuck RPCs (client)
nfsstat -c
cat /proc/self/mountstats
# Look for high retrans / long RTT

# Try a fresh mount (read-only test)
mount -t nfs -o ro,soft,timeo=10,retrans=2 server:/export /mnt/test

# RPC connectivity to server
rpcinfo -p server
rpcinfo -t server nfs
showmount -e server              # list exports (if allowed)

# Server: exports and nfs services
exportfs -v
exportfs -r                      # re-export after edits
systemctl status nfs-server rpcbind
# RHEL-like: nfs-server; Debian-like: nfs-kernel-server

# Server: who is connected
cat /var/lib/nfs/etab            # effective exports
ss -tulpn | grep -E '2049|111|mountd'

# Identity (NFSv4 idmap)
nfsidmap -d                      # debug if available
cat /etc/idmapd.conf

# Process state on client (D-state = often NFS)
ps aux | awk '$8 ~ /D/ {print}'
cat /proc/<PID>/stack            # kernel stack may show nfs_* wait
```

### Useful mount options (client)

```bash
# Prefer explicit options in fstab or autofs
server:/export  /data  nfs  rw,hard,noatime,_netdev  0  0
# For interactive / less critical: soft,timeo=50,retrans=3
# NFSv4: nfsvers=4.1 or 4.2 when both sides support it
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| mount: Connection timed out          | Firewall, routing, nfsd/rpcbind down       | `rpcinfo -p server`, ports 111/2049, path to server |
| mount: Access denied                 | Export missing, wrong client IP/net, root_squash | `showmount -e`, `exportfs -v` on server           |
| Permission denied on files           | UID/GID mismatch, root_squash, idmap       | `id` on both sides, `ls -ln`, idmapd              |
| Processes stuck in D state           | Hard mount + server unreachable or slow    | `nfsstat`, ping/rpcinfo, server load/disk         |
| Stale file handle                    | Export changed, filesystem recreated, inode gone | Remount; avoid deleting underlying export path  |
| Very slow I/O                        | Server disk, network latency, small rsize/wsize | `iostat` on server, `mountstats`, network RTT     |
| Works as root, fails as user         | root_squash maps root to nobody            | Expected; use all_squash/anonuid or proper UIDs   |
| NFSv4 “nobody” ownership             | idmapd domain mismatch                     | `/etc/idmapd.conf` Domain= on client and server   |

## Investigation Tips

- On the client, `findmnt` and `/proc/mounts` show actual options in effect (not only fstab).
- Hard mounts are correct for critical data if the server is highly available; they are dangerous if the server can disappear without a clear failover path.
- Capture `cat /proc/<PID>/stack` for stuck processes — nfs wait functions confirm NFS involvement.
- Test RPC before blaming the filesystem: `rpcinfo -p` failing means network/firewall/rpcbind, not exports content.
- Server-side: confirm the export path is on a filesystem that is actually mounted and has free space/inodes.
- After changing `/etc/exports`, run `exportfs -r` (or restart nfs-server); clients may still need remount for some changes.
- For intermittent stalls, compare `nfsstat -c` retransmissions over time and correlate with server `iostat` / network errors.

## Related Notes

- [[Filesystems and Mounts]]
- [[Disk I/O and Latency]]
- [[iostat Deep Dive]]
- [[High Load Low CPU]]
- [[TCP IP Troubleshooting Model]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
