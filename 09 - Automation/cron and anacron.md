# cron and anacron

## Concept

cron runs commands on a wall-clock schedule. anacron runs commands that must eventually happen even if the machine was powered off at the scheduled time (typical for laptops and for daily/weekly system jobs).

On systemd hosts most new work should be a timer. cron still exists, still runs, and still surprises people who only look at `systemctl list-timers`.

## Why it matters

- Package-supplied jobs live in `/etc/cron.daily`, `/etc/cron.hourly`, `/etc/anacrontab`.
- User crontabs and `/etc/cron.d` are invisible to `systemctl`.
- A job that prints anything is mailed (see [[Local Mail for Cron and Alerts]]). Silence is ambiguous.
- Overlapping cron and systemd timer for the same script is a classic double-execution bug.
- anacron’s “run if missed” behaviour is exactly what you want for `logrotate` and `mlocate` and exactly what you do *not* want for a non-idempotent cleanup.

## Mental Model

```
crond / cronie
  → reads /etc/crontab, /etc/cron.d/*, user crontabs
  → at the minute boundary, forks the command
  → stdout/stderr → mail (unless redirected or MAILTO="")

anacron
  → reads /etc/anacrontab
  → if the job has not run in N days, run it (with a random delay)
  → records timestamp in /var/spool/anacron/
```

Fields (classic crontab):

```
minute hour day-of-month month day-of-week   command
0 2 * * *   /usr/local/bin/backup.sh
```

`%` in the command is turned into a newline unless escaped. That still bites people.

## Key Commands

```bash
# What is scheduled?
crontab -l                          # current user
sudo crontab -u root -l
ls -l /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly
cat /etc/anacrontab
systemctl status cron crond cronie --no-pager

# Is the daemon actually running?
systemctl is-active cron || systemctl is-active crond

# anacron state
ls -l /var/spool/anacron/
cat /var/spool/anacron/cron.daily

# Test a job the way cron will run it (minimal environment!)
sudo -u root env -i PATH=/usr/bin:/bin /bin/bash -c '/path/to/job.sh'

# Force anacron (careful on production)
anacron -d -f                       # debug + force
```

Cron environment is famously sparse: `HOME`, `LOGNAME`, `PATH=/usr/bin:/bin`, `SHELL=/bin/sh`. Anything else must be set inside the job or the crontab.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Job never runs | Daemon stopped, syntax error, wrong user crontab | `systemctl status cron`, `crontab -l`, syslog/journal |
| Job runs but command not found | PATH too small | full path in crontab, or set PATH= |
| Works from shell, fails from cron | Environment, cwd, or `%` unescaped | run under `env -i` |
| Runs twice | cron + systemd timer, or cron.d + user crontab | `list-timers`, all cron locations |
| Missed daily job after long downtime | anacron not installed or not enabled | `/etc/anacrontab`, spool timestamps |
| Mail flood | Job prints every run, MAILTO set | redirect to logger or MAILTO="" + explicit logging |
| anacron runs a job every boot | timestamp file missing or not writable | `/var/spool/anacron` permissions |
| `%` in command truncates it | classic cron parsing | escape as `\%` |

## Investigation Tips

- Inventory *all* of them: user crontabs, `/etc/cron.d`, `/etc/cron.{hourly,daily,weekly,monthly}`, anacrontab, *and* systemd timers. One list.
- Journal or syslog usually contains the cron start line (`CRON[pid]: (root) CMD (...)`). If that line is absent, the daemon never launched it.
- Reproduce with a clean environment. Most “cron can’t find java” bugs are PATH.
- Prefer systemd timers for new work. They have dependencies, journal integration, and `Persistent=`. Leave cron for what the distro already ships.
- If a job must not overlap itself, use `flock` or a systemd timer with proper locking. cron will happily start a second copy.
- After disabling a cron job, confirm it is gone from the next `crontab -l` and that no timer replaced it unintentionally.
- anacron random delay (`RANDOM_DELAY`, `START_HOURS_RANGE`) is why “daily” jobs do not all fire at 00:00.

## Related Notes

- [[systemd Timers]]
- [[Local Mail for Cron and Alerts]]
- [[logrotate]]
- [[journalctl Deep Dive]]
- [[Bash Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A certificate-renewal script lived only in root’s crontab. After we migrated the host to a new image the crontab was not copied. The first expiry page arrived 90 days later.
- `PATH` difference made a backup job succeed interactively and fail under cron for months. The mailed error went to a mailbox nobody read.
- We had both a cron.daily script and a systemd timer calling the same non-idempotent cleanup. It ran twice on the days the timer was also due. One owner, one scheduler.
