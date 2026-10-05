# Oracle Storage and the FRA

## Concept

Oracle storage on Linux is either files on a filesystem (datafiles, tempfiles, online redo, control files) or disks in ASM. The fast recovery area (FRA) is a quota-capped location for archivelogs, backups, and flashback logs. It is the volume that fills when the database is "fine" and commits are about to stop.

Linux `df` sees filesystem files. It does not see ASM diskgroup free space unless you query Oracle or `asmcmd`.

## Why it matters

- Datafile autoextend will eat a filesystem until `df` hits 100%, then writes fail
- FRA full is `ORA-00257` / `ORA-19815`, which looks like an app outage and is a space problem
- Online redo is not a backup. Deleting it to free space corrupts the instance
- A snapshot of a running Oracle filesystem without the database in backup mode or a crash-consistent storage snapshot is not a restore plan

## Mental Model

```
Control files     where the database thinks its files are
Datafiles         tablespaces (SYSTEM, SYSAUX, UNDO, app, TEMP)
Online redo       small groups, circular, required to open
Archivelogs       copies of filled redo, required for PITR
FRA               budget for archivelogs + RMAN pieces + flashback
```

TEMP growing is sort and hash spill, not user data. UNDO growing is open transactions. Neither is fixed by deleting rows in the app without a commit.

ASM diskgroups (`+DATA`, `+FRA`) hide the Linux path. `df` on `/` will not warn you.

## Key Commands

```bash
# Filesystem layout the host actually has
findmnt -A | grep -iE 'oracle|oradata|fra|u01'
df -hT /u01 /u02 /opt/oracle 2>/dev/null
# big files — do not run du on an ASM path
du -xh -d 1 /u01 2>/dev/null | sort -h

# From SQL, as a DBA, filesystem or ASM
sqlplus -s / as sysdba <<'SQL'
set lines 200
col name format a60
select name, round(total_mb/1024,1) total_gb, round(free_mb/1024,1) free_gb
from v$asm_diskgroup;   -- errors if this instance is not ASM; that is fine

select tablespace_name, round(used_percent,1) pct
from dba_tablespace_usage_metrics
order by used_percent desc;

select name from v$datafile;
select name from v$tempfile;
select member from v$logfile;

show parameter db_recovery_file_dest
select name, round(space_limit/1024/1024/1024,1) limit_gb,
       round(space_used/1024/1024/1024,1) used_gb
from v$recovery_file_dest;
SQL

# ASM free space without SQL
. oraenv   # SID often +ASM
asmcmd lsdg
```

RMAN is how archivelogs and backup pieces should leave the FRA:

```text
rman target /
LIST ARCHIVELOG ALL;
DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-2';
-- only if that matches the site retention, and backups exist
```

Do not invent that retention during an incident. Read the runbook. If there is no runbook, free space by moving trace files and listener logs, and call the DBA before deleting anything under the FRA.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `ORA-00257` / commits stuck | FRA or archive dest full | `v$recovery_file_dest`; `df` on that path |
| `ORA-01653` cannot extend | Tablespace or filesystem cannot grow | usage metrics; `df` of that datafile's mount |
| `ORA-01652` temp cannot extend | Sort spill, temp tablespace | TEMP free; who is sorting |
| `df` fine, Oracle says full | ASM diskgroup, or FRA quota below filesystem free | `asmcmd lsdg`; `space_limit` |
| Snapshot restore will not open | Files inconsistent, or control file from another time | Do not "fix" with random `rm`; DBA recovery |
| Permissions after restore | Files owned by root | `chown oracle:oinstall` only on the restored tree you mean |

## Investigation Tips

- List every mount Oracle uses before you declare disk healthy. Control file, data, redo, FRA, and `diag/` are often four filesystems.
- FRA `space_limit` can be smaller than the filesystem. Oracle stops at the quota and leaves `df` looking comfortable.
- Autoextend on a datafile will consume the filesystem with no further prompt. A 90% tablespace with autoextend is a disk ticket, not a SQL ticket.
- TEMP at 100% is pressure, not corruption. Resize or kill the sort after you know the session. Do not delete the tempfile while the instance is up.
- Backup window I/O is real. An RMAN backup to the same disks as datafiles will show up in `iostat` and in app latency. See [[Disk I/O and Latency]].
- Filesystem snapshots of a running instance are not a substitute for RMAN unless storage and the DBA have agreed the snapshot is crash-consistent and tested.

## Related Notes

- [[Oracle for Linux Admins]]
- [[Oracle Alert Log and Processes]]
- [[Database Backup and Restore]]
- [[Disk Full Runbook]]
- [[LVM Deep Dive]]
- [[Filesystems and Mounts]]
- [[Restore Testing]]

## Personal Lessons Learned

- FRA quota was 50 GB on a 200 GB volume. `df` said 40% used. Oracle stopped archiving. The column that mattered was `space_used` versus `space_limit`, not `df`.
- I almost removed an online redo member because the directory looked like logs. Redo members are a few fixed files the instance cannot open without. Archivelogs are the copies. Learn the names before you clean.
- A storage snapshot restored the datafiles and not the matching control file. The instance would not mount. That was a recovery problem, not a filesystem permission problem.
