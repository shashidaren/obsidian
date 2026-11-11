# Samba and CIFS Operations

## Concept

Samba provides SMB/CIFS file and print services. The kernel CIFS client (`mount.cifs` / `cifs.ko`) lets Linux mount Windows or Samba shares. Failures are usually credentials, dialect/version mismatch, signing, identity mapping, or a firewall blocking 445.

## Why it matters

- “Permission denied” on a CIFS mount is frequently a missing `domain=` or wrong `sec=` rather than Unix permissions.
- Dialect negotiation (`vers=`) decides whether the mount works at all. Old NAS boxes still speak SMB1; modern servers refuse it.
- Kerberos-backed mounts (`sec=krb5`) fail when the client has no ticket or the clock is skewed.
- A hung CIFS mount can put processes into D-state the same way a hard NFS mount does.
- Credential files in fstab that are world-readable are a standing secret leak.

## Mental Model

```
Client (cifs.ko)  ←→  TCP/445  ←→  Samba (smbd) or Windows
                     dialect negotiation (SMB2/3)
                     session setup (NTLM or Kerberos)
                     tree connect to \\server\share

credentials file   — username, password, domain (mode 0600)
uid/gid/file_mode  — how the client presents ownership locally
vers=              — force the dialect; do not let it guess in production
```

`smbclient` tests the server independently of the kernel mount. `dmesg` / journal shows the kernel’s real reason when `mount.cifs` only prints a numeric error.

## Key Commands

```bash
# List shares and test auth (no mount)
smbclient -L //server -U user
smbclient //server/share -U user -c 'ls'

# Manual mount with verbose errors
mount -t cifs //server/share /mnt/share -o credentials=/etc/samba/creds,vers=3.1.1,uid=1000,gid=1000 -v

# What is actually mounted
findmnt -t cifs
cat /proc/fs/cifs/Stats

# Kernel reason
dmesg -T | grep -i cifs | tail -20
journalctl -k -g cifs --no-pager | tail -20

# Credential file (root only)
install -m 0600 /dev/null /etc/samba/creds
# username=...
# password=...
# domain=EXAMPLE

# Samba server side
smbstatus
testparm -s
pdbedit -L
```

Typical fstab line:

```
//server/share  /mnt/share  cifs  credentials=/etc/samba/creds,vers=3.1.1,uid=1000,gid=1000,_netdev,nofail,file_mode=0640,dir_mode=0750  0  0
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `mount error(13): Permission denied` | Bad password, missing domain=, wrong sec= | credentials file, `smbclient`, dmesg |
| `mount error(2): No such file or directory` | Share name wrong or not exported | `smbclient -L`, server logs |
| `Host is down` / connection closed | Dialect rejected (SMB1 disabled) | `vers=3.0` or `3.1.1`, server min protocol |
| `Required key not available` | Kerberos ticket missing or skew | `klist`, `chronyc tracking`, `sec=krb5` |
| Mount succeeds, cannot write | uid/gid/file_mode or server ACL | `id`, mount options, server share permissions |
| Processes in D state | Server unreachable, hard semantics | `dmesg`, network to 445, server load |
| Works as root, fails in fstab | Relative path to credentials or noexec | Absolute path, mode 0600, `_netdev` |
| Intermittent disconnects | Signing mismatch or server timeout | `seal`, server `server signing = mandatory` |

## Investigation Tips

- Reproduce with `smbclient` before you touch mount options. If `smbclient` fails, the problem is auth, share name, or network—not the kernel client.
- Always read `dmesg` or the kernel journal after a failed `mount.cifs`. The numeric error is rarely sufficient.
- Force `vers=` in production. Auto-negotiation surprises you when a server is upgraded or a NAS is replaced.
- Credential files must be mode 0600 and owned by root. Never put the password on the fstab line.
- For Kerberos mounts, confirm a valid TGT exists for the user (or use a keytab + `sec=krb5`) and that clocks agree. See [[Kerberos Operations]].
- After changing server-side Samba config, `testparm` then restart `smbd`. Clients may need a remount.
- `_netdev` and `nofail` in fstab prevent boot hangs when the file server is down.

## Related Notes

- [[NFS Troubleshooting]]
- [[Kerberos Operations]]
- [[Users Groups and Permissions]]
- [[Time Sync and chrony]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A fleet of machines stopped mounting a share after the Windows server disabled SMB1. Adding `vers=3.0` to the fstab (and confirming with `smbclient`) restored service. The error had been the generic “Host is down”.
- “Permission denied” on every client was a credentials file that contained `domain=WORKGROUP` while the server expected the AD domain. `smbclient` with an explicit `-W` proved it in one command.
- A credentials file was mode 0644. The password appeared in a support bundle. Mode 0600 and a dedicated low-privilege account are non-negotiable.
