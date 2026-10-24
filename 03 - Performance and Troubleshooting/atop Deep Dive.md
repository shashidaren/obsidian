# atop Deep Dive

## Concept

`atop` is an interactive and historical process-level accounting tool. Unlike `sar` (machine counters) or `pidstat` (live), `atop` can keep a binary log of every process's CPU, memory, disk, and network activity at a fixed interval. When the incident is over, you can still ask "which process was writing at 02:17".

It needs the `atop` package and usually a systemd timer or cron that runs `atop` in logging mode.

## Why it matters

- "Something filled the disk last night" is answered by the process that issued the writes, not by `du` after the fact.
- CPU, RSS, and I/O per process are in the same record. You do not have to correlate three tools.
- Default `sar` does not record per-PID. `atop` does.
- A host with `atop` logging enabled has a local incident recorder that survives the process exiting.

## Mental Model

```
atop -w /var/log/atop/atop_YYYYMMDD  interval
    → binary log, one file per day (or rotated)
    → atop -r /var/log/atop/atop_YYYYMMDD   to replay

Live: atop
Historical: atop -r file -b HH:MM -e HH:MM
```

Interval is typically 10 minutes or 1 minute. Shorter intervals give better incident resolution and larger logs.

## Key Commands

```bash
# Is it logging?
systemctl status atop atop.timer 2>/dev/null
ls -l /var/log/atop/

# Live view (keys: m memory, d disk, n net, c CPU, g generic)
atop

# Replay yesterday's log for the incident window
atop -r /var/log/atop/atop_$(date -d yesterday +%Y%m%d) -b 02:00 -e 02:30

# Show only processes that did disk or CPU in the window
# (interactive once inside: t next sample, T previous, b/e time)

# One-shot summary of a past interval
atop -r /var/log/atop/atop_20261024 -b 02:10 -e 02:15 -P PRC | head
```

Inside the replay, the same keys as live mode work. `t` advances one interval.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No file for the day of the incident | timer/cron not enabled, or disk full | `systemctl status atop`, `/var` space |
| Log exists but process missing | interval too coarse, or process shorter than interval | shorten interval after the fact; live `atop` next time |
| "Permission denied" on the log | not root | `sudo atop -r ...` |
| Huge logs filling /var | interval 10s on a busy host | raise interval or add logrotate |
| Numbers differ from `sar` | different sampling, or atop includes exited processes | both are valid; note the window |
| Container process shows host PID | atop on the host sees all; inside container it sees only the container | run on the node for node-level accounting |

## Investigation Tips

- Enable the logging timer on hosts that get paged. A 1-minute interval is a good incident trade-off.
- When disk fills, open the atop log for the window and sort by disk writes. The process name is usually enough to identify the job.
- Exited processes are still in the log for the intervals they ran. That is the feature `pidstat` does not give you after the fact.
- Pair with `sar` for the machine-wide picture and atop for the culprit process.
- On systems where you cannot install packages, you do not have this. Plan the package in the image.
- Logs are binary. Do not try to `grep` them. Use `atop -r` or `atopsar` if you need text.

## Related Notes

- [[sar and sysstat]]
- [[pidstat Deep Dive]]
- [[iotop Deep Dive]]
- [[Performance Investigation Framework]]
- [[Disk Full Runbook]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A nightly job wrote 40 GB into a temporary directory and exited before anyone looked. `du` was clean by morning. The atop log still showed the PID and the command line for the 02:xx interval. That ended the "who filled /var" ticket.
- I now treat "package installed" and "timer enabled" as separate checks, same as sysstat.
