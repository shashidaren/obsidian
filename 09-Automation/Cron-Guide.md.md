
---
tags: [cron, automation, scheduling, sysadmin]
topic: Cron Job Scheduling
---

# ⏰ Cron — Scheduling Guide

> Cron is the classic Linux tool for scheduling recurring tasks — from simple backups to complex maintenance jobs.

---

## 🎯 What is Cron?

**Cron** is a time-based job scheduler that runs commands at specified intervals. The `crond` daemon runs in the background and executes tasks based on entries in **crontab** files.

- Runs every minute, checking if any jobs are due
- Perfect for: backups, log rotation, cleanup, monitoring checks, reports
- Alternative: **systemd timers** (more modern, better logging)

---

## 📌 The Crontab Syntax

- command_to_run  
    │ │ │ │ │  
    │ │ │ │ └── Day of week (0-7, both 0 and 7 = Sunday)  
    │ │ │ └──── Month (1-12)  
    │ │ └────── Day of month (1-31)  
    │ └──────── Hour (0-23)  
    └────────── Minute (0-59)


### Visual Breakdown
| Field | Range | Example |
|-------|-------|---------|
| Minute | 0-59 | `30` = at minute 30 |
| Hour | 0-23 | `14` = 2 PM |
| Day of Month | 1-31 | `15` = the 15th |
| Month | 1-12 | `6` = June |
| Day of Week | 0-7 | `1` = Monday, `0` or `7` = Sunday |

---

## ⚡ Special Characters

| Character | Meaning | Example |
|-----------|---------|---------|
| `*` | Every value | `* * * * *` = every minute |
| `,` | Multiple values | `0,15,30,45` = every 15 min |
| `-` | Range | `1-5` = Monday to Friday |
| `/` | Step values | `*/10` = every 10 units |
| `@` | Shortcuts | `@daily` = once a day |

---

## 🎯 Common Cron Patterns

### Every X Time
```
* * * * *          # Every minute
*/5 * * * *        # Every 5 minutes
*/15 * * * *       # Every 15 minutes
*/30 * * * *       # Every 30 minutes
0 * * * *          # Every hour (at minute 0)
0 */2 * * *        # Every 2 hours
0 0 * * *          # Every day at midnight
0 12 * * *         # Every day at noon
```


### Specific Times

Bash

```
30 2 * * *         # Every day at 2:30 AM
0 9 * * 1-5        # Weekdays at 9 AM
0 0 * * 0          # Every Sunday at midnight
0 0 1 * *          # First day of every month at midnight
0 0 1 1 *          # January 1st at midnight (yearly)
15 14 1 * *        # 2:15 PM on the 1st of every month
```

### Multiple Times

Bash

```
0 9,12,17 * * *    # At 9 AM, 12 PM, and 5 PM daily
0 9-17 * * 1-5     # Every hour from 9 AM to 5 PM, weekdays
```

## 🔤 Cron Shortcuts (Easier to Remember)

|Shortcut|Equivalent|Meaning|
|---|---|---|
|`@reboot`|—|Run once at startup|
|`@yearly` or `@annually`|`0 0 1 1 *`|Once a year|
|`@monthly`|`0 0 1 * *`|Once a month|
|`@weekly`|`0 0 * * 0`|Once a week|
|`@daily` or `@midnight`|`0 0 * * *`|Once a day|
|`@hourly`|`0 * * * *`|Once an hour|
**Example:**

Bash

```
@daily /usr/local/bin/backup.sh
@reboot /usr/local/bin/startup-check.sh
```

## 🛠️ Managing Cron Jobs

### View Your Crontab

Bash

```
crontab -l                    # List current user's cron jobs
sudo crontab -l               # List root's cron jobs
sudo crontab -u username -l   # List another user's cron jobs
```

### Edit Your Crontab

Bash

```
crontab -e                    # Edit your own crontab
sudo crontab -e               # Edit root's crontab
sudo crontab -u username -e   # Edit another user's crontab
```

⚠️ **First time?** It asks which editor to use. Pick `nano` if you're unsure (option 1).

### Remove Crontab

Bash

```
crontab -r                    # ⚠️ Deletes ALL your cron jobs (no confirmation!)
crontab -ri                   # Safer: asks for confirmation
```

### Backup Your Crontab

Bash

```
crontab -l > ~/crontab-backup-$(date +%Y-%m-%d).txt
```

**Restore from backup:**

Bash

```
crontab ~/crontab-backup-2025-01-15.txt
```

## 📁 System-Wide Cron Files

Besides user crontabs, the system has these directories:

text

```
/etc/crontab              # Main system crontab (has USER field!)
/etc/cron.d/              # Drop-in cron files (great for packages)
/etc/cron.hourly/         # Scripts run every hour
/etc/cron.daily/          # Scripts run every day
/etc/cron.weekly/         # Scripts run every week
/etc/cron.monthly/        # Scripts run every month
```

### System Crontab Difference

`/etc/crontab` and files in `/etc/cron.d/` have an **extra field** for the user:

Bash

```
# m h dom mon dow  user  command
30 2 * * *         root  /usr/local/bin/backup.sh
```

**For scripts in `/etc/cron.daily/` etc:** Just drop an executable script in the folder. No crontab syntax needed. It runs automatically.

Bash

```
sudo cp myscript.sh /etc/cron.daily/
sudo chmod +x /etc/cron.daily/myscript.sh
```

---

## 🔐 Cron Permissions

Control who can use cron with:

text

```
/etc/cron.allow    # If exists, only listed users can use cron
/etc/cron.deny     # Users listed here CANNOT use cron
```

**Rules:**

- If `cron.allow` exists → only users in it can use cron
- If only `cron.deny` exists → everyone EXCEPT those users can use cron
- If neither exists → depends on distro (usually only root)

---

## 📝 Real-World Examples

### 1. Daily Backup at 2 AM

Bash

```
0 2 * * * /usr/local/bin/backup.sh
```

### 2. Log Rotation Every Sunday

Bash

```
0 0 * * 0 /usr/local/bin/rotate-logs.sh
```

### 3. Check Disk Usage Every 15 Min

Bash

```
*/15 * * * * /usr/local/bin/check-disk.sh
```

### 4. Restart Service Every Monday at 3 AM

Bash

```
0 3 * * 1 systemctl restart myapp
```

### 5. Send Daily Report at End of Business

Bash

```
0 17 * * 1-5 /usr/local/bin/daily-report.sh | mail -s "Daily Report" admin@example.com
```

### 6. Run Script at Boot

Bash

```
@reboot /usr/local/bin/startup-tasks.sh
```

### 7. Sync Files Every 5 Minutes During Work Hours

Bash

```
*/5 9-17 * * 1-5 rsync -az /data/ backup-server:/data/
```

---

## 📤 Handling Cron Output

By default, cron **emails** the output to the user. If mail isn't set up, output is lost.

### Redirect to Log File

Bash

```
0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

**Breakdown:**

- `>>` = append to file
- `2>&1` = redirect errors (stderr) to same place as output (stdout)

### Discard All Output

Bash

```
0 2 * * * /usr/local/bin/backup.sh > /dev/null 2>&1
```

### Log Only Errors

Bash

```
0 2 * * * /usr/local/bin/backup.sh > /dev/null 2>> /var/log/backup-errors.log
```

## Common Pitfalls & Solutions

### ❌ Pitfall 1: "It works from terminal but not in cron!"

**Reason:** Cron runs with a **minimal environment**. Your `$PATH` is different.

**Fix:** Always use **full paths** in cron jobs:

Bash

```
# ❌ BAD
0 2 * * * backup.sh

# ✅ GOOD
0 2 * * * /usr/local/bin/backup.sh
```

Or set PATH at the top of your crontab:

Bash

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * * backup.sh
```

### ❌ Pitfall 2: Script needs environment variables

**Fix:** Source your profile or set variables at the top:

Bash

```
0 2 * * * . /home/user/.bashrc && /path/to/script.sh
```

### ❌ Pitfall 3: The `%` character breaks jobs

Cron treats `%` as a newline. Escape it with `\%`:

Bash

```
# ❌ BAD
0 2 * * * echo "Date: $(date +%Y-%m-%d)" >> /tmp/log

# ✅ GOOD
0 2 * * * echo "Date: $(date +\%Y-\%m-\%d)" >> /tmp/log
```

### ❌ Pitfall 4: No output = no clue what went wrong

**Always log output during testing:**

Bash

```
* * * * * /path/to/script.sh >> /tmp/cron-test.log 2>&1
```

### ❌ Pitfall 5: Forgetting to make script executable

Bash

```
chmod +x /usr/local/bin/backup.sh
```

### ❌ Pitfall 6: Using relative paths inside the script

Even inside scripts, use absolute paths — cron has no idea what your current directory is.

---

## 🔍 Debugging Cron Jobs

### 1. Check if cron is running

Bash

```
systemctl status cron         # Debian/Ubuntu
systemctl status crond        # RHEL/CentOS
```

### 2. Check cron logs

Bash

```
# Ubuntu/Debian
grep CRON /var/log/syslog

# RHEL/CentOS
grep CRON /var/log/cron

# With journalctl (systemd)
journalctl -u cron -f
journalctl -u crond -f
```

### 3. Test your cron entry syntax

Use online tool: [crontab.guru](https://crontab.guru/) — paste your schedule, get plain English explanation.

### 4. Run script manually first

Bash

```
bash -x /usr/local/bin/backup.sh    # Debug mode, shows every line
```

### 5. Test with a "1 minute from now" schedule

Set the job to run in 2 minutes, watch the log to see what happens.

---

## 🆚 Cron vs Systemd Timers

Modern alternative to cron. Both work — here's when to use which:

|Feature|Cron|Systemd Timers|
|---|---|---|
|Simplicity|✅ Simple|❌ More setup|
|Logging|❌ Manual|✅ Built-in (journalctl)|
|Dependencies|❌ No|✅ Wait for network, etc.|
|Missed runs|❌ Skipped|✅ Can run when back online|
|Resource limits|❌ No|✅ CPU/Memory limits|
|Standard on old systems|✅ Yes|❌ Systemd required|

**Rule of thumb:**

- Simple recurring task → **cron**
- Complex task with dependencies → **systemd timer**

---

## 📚 External References

- 🌐 [crontab.guru](https://crontab.guru/) — Interactive cron syntax helper (bookmark this!)
- 🌐 [crontab generator](https://crontab-generator.org/)
- 📖 `man 5 crontab` — The crontab file format
- 📖 `man cron` — The cron daemon

