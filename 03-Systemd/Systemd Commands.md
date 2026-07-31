
## Systemd Command 

Modern init system for Linux. Manages services, logging, timers, and system state.

**Used on:** RHEL 7+, Rocky, Alma, CentOS 7+, Ubuntu 16+, Debian 8+

---
##  Key Concepts

- **Unit** — anything systemd manages (service, socket, timer, mount, target)
- **Service** — a running program (nginx, sshd, mysql)
- **Target** — a group of services (similar to old runlevels)
- **Journal** — the systemd log system
- **Unit file** — configuration file for a unit (`.service`, `.timer`, etc.)

---

## 1.  Service Management (Daily Use )

```
# Start a service  
systemctl start nginx 

# Stop a service
systemctl stop nginx

# Restart a service 
systemctl restart nginx  

# Reload service config without restart 
systemctl reload nginx  

# Chack Status  
Systemctl status nginx 
  
```

## 2.  Enable /Disable at boot 

```
# Enable service start at boot  
systemctl enable nginx 

# Disable service from starting atboot 
systemctl disable nginx 

# Enable and start immediately 
systemctl enable --now nginx 

# Disable and stop immediately 
systemctl disable --now nginx  

# Check if enable 
systemctl is-enabled nginx 

# Check if active / running 
systemctl is-active nginx  

```

## 3. Listing Units 
```
# List all running Units 
systemctl list-units -- type=service 

# List all Services  
systemctl list-units--type=service -all 

# List failed Services (VERY IMPORTANT)
systemctl --failed 

# List all enabled Services 
systemctl list-unit-files  --state=enabled  

# List all unit files 
Systemctl list-unit-files  

```

## 4. Journal Logs 
# The systemd log tool  -replaces old school log grepping 

```
# View all logs  (newest at the bottom )
journalctl 

# Follow logs live (Like tail -f )
journalctl -f 
 
# Logs from current boot only 
journalctl -b 

# Logs fro previous boot  
journalctl -b -1

# Logs for a specific service 
journalctl -u nginx  

# Follow logs of a service 
journalctl -u nginx -f 

# Logs with errors only  
journalctl -p err -b 

# Logs from last hour  
journactl --since "1 hour ago"

# Logs between times   
journalctl --since  '2026-01-01' --until '2026-01-02'

# Kernel Messages Only 
journalctl -k  

```

## 5. Troubleshooting a Broken Service

Standard order when a service won't start.

```
# 1. Check status and last logs 
systemctl status servicename  

# 2. Check recent journal entries  
journalctl -u servicename -xe  

# 3. Check if config file has errors (varies by service)
nginx -t 
sshd -t 
httpd -t 

# 4. Check if port is already in use 
ss -tulpn | grep :80

# 5. Check permissions on config  files  
ls -l /etc/nginx/nginx.conf 

# 6. Try starting manually to see errors  
systemctl start servicename 
```

## 6. Unit file allocation 

- **System units:** `/usr/lib/systemd/system/` (do NOT edit — vendor files)
- **Custom/override units:** `/etc/systemd/system/` (edit here)
- **User units:** `~/.config/systemd/user/`

```
# Show unit file content  
systemctl cat nginx 

# Edit unit file safely (creates override) 
systemctl edit nginx 

# Edit full unit file 
systemctl edit --full nginx 

# After editing any unit file ,  always reload 
systemctl daemon-reload  

# Then restart the sevice 
systemctl restart nginx 


```

## 7.  System Power / State  

```
# Reboot 
systemctl poweroff

# shutdown 
systemctl power

# suspend  
systemctl suspend  

# Show current default target (like runlevel)
systemctl get -default 

# Change default target
systemctl set-default multi-user.target 
systemctl set-default graphical.target 

# Switch target immediately 
systemctl isolate multi-user.target

```

## 8. Systemd timers (Modern Cron)

```
# List all active timers 
systemctl list timers  

# List all timers (including inactive)
systemctl list-timers --all 

# Check status of a timer  
systemctl status backup.timer  

# Enable ad start a timer 
systectl enable --now backup.timer 

```


## ⚠️ Common Mistakes

- ❌ Forgetting `systemctl daemon-reload` after editing unit files
- ❌ Editing files in `/usr/lib/systemd/system/` (gets overwritten by updates)
- ❌ Using `service` command on modern systems (works but deprecated)
- ❌ Not checking `journalctl -xe` when troubleshooting
- ❌ Restarting a service without checking config first (`nginx -t`)

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Start | `systemctl start SERVICE` |
| Stop | `systemctl stop SERVICE` |
| Restart | `systemctl restart SERVICE` |
| Reload config | `systemctl reload SERVICE` |
| Status | `systemctl status SERVICE` |
| Enable at boot | `systemctl enable SERVICE` |
| Disable at boot | `systemctl disable SERVICE` |
| Failed services | `systemctl --failed` |
| Service logs | `journalctl -u SERVICE` |
| Follow logs | `journalctl -u SERVICE -f` |
| Reload systemd | `systemctl daemon-reload` |


## Related Notes
- [[Daily Server Checklist]]
- [[Troubleshooting Checklist]]
- [[Networking Commands]]
