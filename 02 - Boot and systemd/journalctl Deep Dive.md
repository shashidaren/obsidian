# journalctl Deep Dive

## Concept

`journalctl` queries the systemd journal — a structured, indexed log store.  
It can filter by time, boot, unit, priority, PID, and many other fields.

## Why it matters

Most modern Linux troubleshooting starts (or ends) in the journal.  
Being able to quickly narrow logs to the exact incident window and unit saves a lot of time.

## Mental Model

```
journalctl [filters]     → shows matching log lines
-b / --boot              → current or previous boots
-u / --unit              → specific systemd unit
-p / --priority          → severity (err, warning, etc.)
--since / --until        → time window
```

## Key Commands

```bash
# Current boot, all errors
journalctl -p err -b

# Specific service, current boot
journalctl -u nginx -b

# Follow a service live
journalctl -u nginx -f

# Time window
journalctl --since "2026-08-18 10:00:00" --until "2026-08-18 11:00:00"
journalctl --since "10 min ago"
journalctl --since today

# Previous boot
journalctl -b -1

# Kernel messages only
journalctl -k

# Show reverse (newest first)
journalctl -r -u nginx -n 50

# Output in JSON (useful for scripting)
journalctl -u nginx -o json-pretty
```

### Priority levels (useful with -p)

```
0 emerg, 1 alert, 2 crit, 3 err, 4 warning, 5 notice, 6 info, 7 debug
```

## Common Patterns for Incidents

```bash
# What failed during this boot?
journalctl -p err -b

# Why did this service fail?
journalctl -u <service> -b --no-pager

# Correlate with a time
journalctl --since "30 min ago" -p warning

# Look at a specific PID
journalctl _PID=<pid>
```

## Investigation Tips

- Always start with a time window when possible — the journal can be huge.
- `-b` limits to the current boot and is usually what you want during an incident.
- Use `--no-pager` when piping or capturing output.
- Persistent journal (if configured) survives reboots and is extremely valuable.
- Combine with `systemctl status` — status already shows the most recent journal lines.

## Related Notes

- [[systemctl Deep Dive]]
- [[systemd Units]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
