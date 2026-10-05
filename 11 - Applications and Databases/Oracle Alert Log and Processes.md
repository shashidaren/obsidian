# Oracle Alert Log and Processes

## Concept

The alert log is Oracle's own incident diary: startups, shutdowns, `ORA-` errors, checkpoint problems, and archiver complaints. Background processes keep the instance alive. If PMON is gone, the instance is gone. If LGWR cannot write redo, the instance will stop committing.

ADR (Automatic Diagnostic Repository) is the tree under `$ORACLE_BASE/diag`. The alert log you want is the text file in `trace/`, not a random `.trc` from a user session.

## Why it matters

- Restarting before you read the alert log destroys the timeline and can hide a full filesystem
- A single `kill -9` of LGWR or DBWn is an instance crash
- Trace files in `trace/` fill disks. The alert log tells you why they started
- "High CPU in oracle" is often one server process for one SQL, not "Oracle is broken"

## Mental Model

```
ora_pmon_<SID>   process monitor; if missing, instance is down
ora_lgwr_<SID>   redo writer; commits wait on it
ora_dbw*_<SID>   database writer; dirty buffers to datafiles
ora_smon_<SID>   recovery / cleanup
ora_arc*_<SID>   archiver; copies online redo to archive dest
ora_lreg_<SID>   listener registration (12c+)
tnslsnr          listener, not part of the instance
oracle <SID>     dedicated server process (one per session, often)
```

Online redo is a small circular set. Archiver copies a filled group to the archive destination or FRA before that group can be reused. If the copy cannot happen, commits eventually stop (`ORA-00257`).

## Key Commands

```bash
sudo -iu oracle
. oraenv

ps -ef | grep -E "[o]ra_pmon_|[o]ra_lgwr_|[o]ra_dbw|[o]ra_arc|[t]nslsnr"

# Text alert log
ADR="$ORACLE_BASE/diag/rdbms"
ls -lt "$ADR"/*/*/trace/alert_*.log
tail -n 100 "$ADR"/*/*/trace/alert_${ORACLE_SID}.log
grep -E 'ORA-|starting|shutting|Archiver' "$ADR"/*/*/trace/alert_${ORACLE_SID}.log | tail -n 40

# ADR CLI, if you do not want to guess the path
adrci <<'EOF'
show homes
set home diag/rdbms/<dbname>/<SID>
show alert -tail 50
EOF

# Who is burning CPU — map PID back to SID, do not kill yet
ps -eo pid,pcpu,pmem,etime,cmd --sort=-pcpu | head
# then in sqlplus, as a DBA:
# select s.sid, s.serial#, s.username, s.program, s.sql_id, p.spid
# from v$session s join v$process p on s.paddr = p.addr
# where p.spid = '<pid>';
```

Incident dumps live next to the alert log (`trace/`). A flood of `.trc` / `.trm` is a symptom. Do not delete the alert log. Old incident packs can be purged with `adrci` (`purge`) once you have copied what the DBA needs.

## Common Failure Modes & Symptoms

| Pattern | Meaning | Next |
|---------|---------|------|
| No `ora_pmon_<SID>` | Instance down | Alert log tail from before it died; then startup if that is your job |
| `ORA-00257` archiver error | Archive dest or FRA full | `df` that filesystem; do not delete redo or datafiles |
| `ORA-19815` / FRA full | Same family: recovery area out of space | DBA backup/delete of expired archivelogs, not `rm` of datafiles |
| `ORA-00600` / `ORA-07445` | Oracle internal error; trace file path in the alert log | Keep the trace; patch/support territory |
| Checkpoint not complete | Redo cannot wrap; I/O or too-small redo | Storage latency; DBA redo sizing |
| Many `oracle ORCL` CPU hogs | User SQL, not background | Map PID to `sql_id` before any kill |
| Alert log quiet, app errors | Failures never reached the instance | Listener log |

## Investigation Tips

- Note the timestamp of the first `ORA-` in the window, then read upward for the startup or the I/O error that preceded it.
- `SHUTDOWN IMMEDIATE` that sits for ages is sessions not going away. Look at `v$session` before anyone sends `ABORT`.
- `SHUTDOWN ABORT` is a crash. Next startup runs instance recovery. Say so in the ticket.
- Do not delete `*.dbf`, control files, or online redo to free space. Archive logs and trace files are the only candidates, and archive logs only under a documented RMAN retention.
- A server process in `D` state is storage. Go to `iostat` and the alert log for `I/O error`, not to a SQL rewrite.
- After an `ORA-07445`, the instance may still be up. The trace file named in the alert log is the artifact to keep.

## Related Notes

- [[Oracle for Linux Admins]]
- [[Oracle Listener and Connections]]
- [[Oracle Storage and the FRA]]
- [[Disk Full Runbook]]
- [[Disk I/O and Latency]]
- [[journalctl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I tailed the wrong file, a session `.trc`, and missed a repeating `ORA-00257` in `alert_ORCL.log`. The name in the path is the SID. If it is not `alert_`, it is not the diary.
- Someone `rm`'d archivelogs from the FRA to clear a page. RMAN still thought they existed, and the next restore failed. Space emergencies go through RMAN or the DBA, not `rm`.
- A 90% CPU `oracle` process was one report. Killing PMON would have crashed everyone else. Map the PID to the session first.
