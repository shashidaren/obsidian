# Oracle for Linux Admins

## Concept

Oracle is a database plus an instance. The database is files on disk: control files, datafiles, online redo, temp, and (usually) archived redo. The instance is memory (the SGA) and background processes (`ora_pmon_<SID>`, `LGWR`, `DBWn`, `SMON`, and others) attached to those files.

From the Linux seat you own the host, the listener port, the Oracle OS user, `ORACLE_HOME`, disk, and the alert log. You do not need to be the DBA to tell "instance down" from "listener down" from "archive destination full".

## Why it matters

- Apps say "database is down" when only the listener is down, or only one service name is unregistered
- Killing `-9` an Oracle process, or filling the archive disk, is how a slow host becomes a recovery
- `sqlplus / as sysdba` works from the server and proves nothing about the network path the app uses
- The alert log is the source of truth. `systemctl status` on a wrapper is not

## Mental Model

```
App  --TCP 1521-->  listener (tnslsnr)  --hands off-->  server process
                                              |
                                              v
                              instance: SGA + ora_pmon_<SID>, LGWR, DBWn, ...
                                              |
                                              v
                              files: control, data, redo, archivelogs (FRA)
```

`ORACLE_SID` picks the instance. `ORACLE_HOME` picks the software tree. `/etc/oratab` maps `SID:ORACLE_HOME:Y|N` and is what `oraenv` reads.

A bequeath connection (`sqlplus / as sysdba` on the host, OS user in the `dba` group) bypasses the listener. A TNS connection does not.

## Key Commands

```bash
# Which instances is this host supposed to run?
cat /etc/oratab
grep -v '^#' /etc/oratab

# Is the instance process up? (replace ORCL)
ps -ef | grep -E '[o]ra_pmon_'
ps -ef | grep -E '[t]nslsnr'

# Environment the DBA account expects
sudo -iu oracle
. /usr/local/bin/oraenv    # or . oraenv, then type the SID
echo "$ORACLE_HOME $ORACLE_SID"

# Local proof the instance is open. Not the app path.
sqlplus -s / as sysdba <<'SQL'
select instance_name, status from v$instance;
select open_mode from v$database;
select name, free_mb from v$asm_diskgroup;   -- only if ASM; ignore errors otherwise
SQL

# Listener
lsnrctl status
lsnrctl services

# Alert log (19c path shape; diag root can differ)
# $ORACLE_BASE/diag/rdbms/<dbname>/<SID>/trace/alert_<SID>.log
ls -lt "$ORACLE_BASE"/diag/rdbms/*/*/trace/alert_*.log
tail -n 80 "$ORACLE_BASE"/diag/rdbms/*/*/trace/alert_${ORACLE_SID}.log
```

Startup and shutdown belong to the DBA or a documented job. If you must, from the oracle account:

```text
sqlplus / as sysdba
STARTUP;
SHUTDOWN IMMEDIATE;     -- clean, can wait on sessions
-- SHUTDOWN ABORT;      -- last resort; instance recovery on next start
```

Do not `kill -9` PMON or LGWR to "restart Oracle". That is an abort, and you will own the recovery.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| App cannot connect, `ora_pmon` exists | Listener down, wrong port, service not registered | `lsnrctl status`; `ss -lptn | grep 1521` |
| `ORA-12541: no listener` | Nothing on that host:port | Listener process, firewall, correct host |
| `ORA-12514: listener does not know of service` | Instance up, service name not registered | `lsnrctl services`; SID vs service name |
| `ORA-01034: ORACLE not available` | Instance not started | `ora_pmon`; alert log |
| `ORA-00257: archiver error` | Archive dest / FRA full | `df` on FRA and archive mount; alert log |
| Host up, no `ora_pmon` after reboot | `oratab` flag `N`, or dbstart not enabled | `/etc/oratab`; how this host autostarts |
| Local sqlplus works, app does not | Bequeath vs listener, or firewall / SQL*Net | Test with the app's TNS entry |
| Disk full on `/` but datafiles are fine | Audit, trace, or listener log on another filesystem | `df -h` every Oracle mount, not just data |

## Investigation Tips

- Split the path: process up, listener up, service registered, port reachable from the app host, then SQL. Do them in that order.
- Read the alert log before you restart. The last `ORA-` is usually the incident.
- `ORACLE_HOME` and `PATH` differ per SID on a multi-home host. `oraenv` or the unit file, not your login profile.
- Archive and FRA disks fill while data disks look fine. Check every mount in the alert log path and in `v$recovery_file_dest` if you can query.
- Permissions: datafiles owned by `oracle:oinstall`. A restored tree as `root` will not open.
- Patching the OS kernel or glibc can be fine; replacing `ORACLE_HOME` libraries by hand is not. Oracle has its own patch tool (OPatch / `opatch`).

## Related Notes

- [[Oracle Listener and Connections]]
- [[Oracle Alert Log and Processes]]
- [[Oracle Storage and the FRA]]
- [[Database Operational Basics]]
- [[Database Backup and Restore]]
- [[Connection Exhaustion]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first "Oracle is down" ticket was a listener. `ora_pmon_ORCL` was fine and `lsnrctl status` was not. Restarting the instance would have made a short outage into crash recovery.
- `sqlplus / as sysdba` from the DB host passed, and the app still failed with `ORA-12514`. The service name in the app URL was not the SID. `lsnrctl services` was the check that mattered.
- An archive destination on a 20 GB volume filled overnight. Datafiles had hundreds of GB free. `df` on the wrong mount is how you miss `ORA-00257`.
