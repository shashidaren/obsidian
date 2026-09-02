# tar and Compression

## Concept

`tar` packs a directory tree into a single stream (an archive). Compression tools (`gzip`, `xz`, `zstd`, `bzip2`) shrink that stream. Together they move trees between hosts, feed backups, and produce the tarballs you attach to tickets.

An archive is not a backup strategy. It is a file format. Integrity, completeness, ownership, and a tested extract path are separate problems — see [[Backup Strategy]] and [[Restore Testing]].

## Why it matters

- Bad tarballs are discovered at restore time: absolute paths, missing files, wrong owner, truncated stream
- Compression choice is a CPU vs size vs time trade-off on the box you are already debugging
- `tar` + SSH is still the fastest way to copy a tree when `rsync` is not installed
- Live application directories change while you read them; a “successful” tar can still be inconsistent

Treat create and extract as two different operations you rehearse, not as one command you memorised in 2009.

## Mental Model

```
tree  --(tar)-->  .tar stream  --(compress)-->  .tar.gz / .tar.xz / .tar.zst

Flags you actually need:
  -c  create
  -x  extract
  -t  list (test the archive is readable)
  -f  file (or - for stdin/stdout)
  -z  gzip     -J xz     -I 'zstd -T0'   (or auto via .gz/.xz)
  -p  preserve permissions (extract)
  -C  change directory first
  -v  verbose (noisy on large trees; use for small tests)

Path rule:
  store *relative* names (app/, etc/myapp.conf)
  extracting as root from an archive with /etc/... will write /etc/...
```

`tar -tf archive | head` is the cheapest honesty check. If list fails, do not start an extract onto a production mount.

## Key Commands

```bash
# Create relative to the parent so names do not start with /
tar -C /var -cf - lib/myapp | gzip -c > myapp-$(date +%F).tar.gz
tar -C /etc -czf myapp-conf.tar.gz myapp/

# Modern compressors
tar -C /data -I 'zstd -T0 -3' -cf data.tar.zst app/
tar -C /data -cJf data.tar.xz app/          # xz; high CPU, small file

# List / verify before extract
tar -tzf myapp-2026-09-01.tar.gz | head
tar -tJf data.tar.xz | wc -l
zstd -t data.tar.zst && tar -t -I zstd -f data.tar.zst | head

# Extract into an empty staging directory, never onto live /
mkdir -p /restore/staging && tar -C /restore/staging -xzf myapp.tar.gz
# inspect, then rsync into place

# Copy a tree over ssh without an intermediate file
tar -C /var/www -cf - html | ssh backup-host 'tar -C /backups/www -xf -'

# Preserve xattrs / ACLs when you mean to (GNU tar)
tar --xattrs --acls -C /home -czf homes.tar.gz alice/

# Compare / show what would be restored
tar -tzf backup.tar.gz | sort > /tmp/arch.list
find app -type f | sort > /tmp/live.list
comm -3 /tmp/arch.list /tmp/live.list
```

Checksum the artifact after create:

```bash
sha256sum myapp.tar.gz | tee myapp.tar.gz.sha256
sha256sum -c myapp.tar.gz.sha256
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| Extract writes into `/` or unexpected dirs | Archive stored absolute paths | `tar -tf` first; extract with `-C` into staging |
| “Unexpected EOF” / gzip: truncated | Copy cut off, disk full mid-write | Check size vs source; re-copy; do not extract |
| Permissions / owner wrong after extract | Extracted as non-root, or `-p` omitted | Extract as the correct user; GNU tar `-p` |
| Archive “succeeds” but app will not start | Live files changed during tar; partial tree | Quiesce, snapshot, or use rsync/`--listed-incremental` |
| CPU pegged, tiny progress | `xz -9` on a huge tree during an incident | `zstd -3` or uncompressed tar + later compress |
| Sparse VM images balloon | tar stored holes as zeros | `tar --sparse` or copy at block layer |
| SELinux contexts lost | Default tar does not keep xattrs | `--selinux` / `--xattrs` and a filesystem that stores them |
| `tar: file changed as we read it` | Expected on live trees | Decide if consistency matters; snapshot first |

## Investigation Tips

- Always `-t` (list) before `-x` (extract). Listing is the restore dry-run.
- Create from `-C parent name/` so the archive contains `name/...`, not `/var/lib/name/...`.
- Do not extract as root onto a host you care about until you have listed the first 50 members.
- For backups of databases, a filesystem tarball of the datadir is not a consistent backup. Use the engine’s dump/snapshot path — [[Database Backup and Restore]].
- `zstd` is usually the best default on current hardware: fast, parallel (`-T0`), good ratio. `gzip` is the compatibility default. `xz -9` is for things you ship once and keep for years.
- Watch destination space *and* inodes. A full target produces a truncated archive that still looks like a file.
- Pair with [[rsync]] when you need incrementals, delete detection, or resume. tar is a snapshot of a tree at one moment.

## Related Notes

- [[rsync]]
- [[Backup Strategy]]
- [[Restore Testing]]
- [[Database Backup and Restore]]
- [[find Deep Dive]]
- [[df and du Deep Dive]]
- [[SELinux Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have extracted a “home directory backup” and watched it plant files in `/home/home/user` because the archive already contained `home/user` and I added another `-C /home`. List the members; then choose `-C`.
- Truncated `.tar.gz` from a `scp` that the operator Ctrl-C’d still had a plausible size. `gzip -t` / `tar -tzf` would have caught it before a four-hour “restore”.
- Compressing with `xz -9e` on a production app node during a disk-full incident made the outage worse. Compress on the backup host, or use `zstd -1` live.
- The only tarballs I trust now are ones a restore test has unpacked onto a scratch box and booted or `diff`’d.
