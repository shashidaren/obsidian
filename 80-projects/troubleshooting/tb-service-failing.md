# TB:  Service Failing  

## Why this happens 

- Misconfiguration after changes  
- Port already in use by another process 
- Missing files or wrong permissions 
- Dependency service not running  
- Out of memory or disk space 
- Bug in application code  

## Symptoms  
- Service status shows failed 
- Application not responding  
- Port not listening 
- Error messages in logs 
- Service starts then mmediately stops 

## Step 1: First Response - Check Service Status 

### Check Service Status  

```
# Check service status immediately
sudo systemctl status servicename

# Output tells you:
# Active: failed      <- service is down
# Active: active      <- service is running
# Active: activating  <- service is starting

# Common services to check
sudo systemctl status nginx
sudo systemctl status apache2
sudo systemctl status mysql
sudo systemctl status sshd
```

### Quick Service Commands

```
# Try restarting service first
sudo systemctl restart servicename

# If restart fails try stop then start
sudo systemctl stop servicename
sudo systemctl start servicename

# Check status after restart
sudo systemctl status servicename

# Is service enabled at boot?
sudo systemctl is-enabled servicename
# Output: enabled or disabled

# Enable service at boot
sudo systemctl enable servicename
```

### Check All Failed Services
```
# See all failed services at once
systemctl list-units --failed

# Check service dependencies
systemctl list-dependencies servicename
```

##  Step 2: Investigate Logs - Find Root Cause 

### Systemd Journal logs 

```
# Most important command  - check service logs  
sudo journalctl -u servicename 

# Show last 50 lines 
sudo journalctl -u servicename -n 50 

# Follow logs in real time  
sudo journalctl -u servicename -f 

# Show logs since last boot  
sudo journalctl -u servicename -b

# Show logs with errors only  
sudo journalctl -u servicename  -p err

```

### Check Application Logs

```
# Common log locations  
tail -f /var/log/nginx/error.log
tail -f /var/log/apache2/error.log 
tail -f /var/log/mysql/error.log 
tail -f /var/log/syslog 

# Search for errors in logs  
grep -i error /var/log/nginx/error.log 
grep -i failed /var/log/syslog
grep -i "permission denied" /var/log/syslog

# Check last 100 lines of any log 
tail -100 /var/log/syslog 
```

### Check Port Conflicts

```
# Is the port already in use ? 

ss -tlnp | grep 80               <- check port 80
ss -tlnp | grep 443              <- check port 443
ss -tlnp | grep 3306             <- check MySQL port

# Find what process is using port
sudo lsof -i :80
sudo lsof -i :443

# Kill process using port if needed
sudo kill -9 $(lsof -t -i:80)

```

## Step 3: Fix Common Causes 

### Fix: Configuration Errors 
```
sudo nginx -t                    <-- test nginx config 
sudo apache2ctl configtest       <-- test apache config 
sudo mysqld --validate-config    <-- test mysql config 
sudo sshd -t                     <-- test SSH config 

# If config test passes the restart
sudo systemctl restart sericename  

# View current config file location 
sudo systemctl cat servicename 

```

### Fix: Wrong Permissions
```
# Check service user and group
ps aux | grep servicename
# Note the user running the service

# Fix common permission issues
sudo chown -R www-data:www-data /var/www/html    <- nginx/apache
sudo chown -R mysql:mysql /var/lib/mysql         <- mysql
sudo chmod 750 /var/www/html

# Check SELinux or AppArmor blocking
sudo aa-status                   <- AppArmor status
sudo journalctl | grep apparmor  <- AppArmor blocks
```

### Fix: Missing Dependencies

```
# Check service dependencies
systemctl list-dependencies servicename

# Start dependency first
sudo systemctl start dependency-service
sudo systemctl start servicename

# Check if required files exist
sudo systemctl cat servicename   <- shows service file
# Look for ExecStart= line
# Verify that binary exists
which nginx
which apache2
```

### Fix: Resource Issues
```
# Check if disk full
df -h

# Check if out of memory
free -h

# Check system limits
ulimit -a
cat /proc/PID/limits

```

## Step 4:  Verify Service Recovered 

### Confirm Service Running  
```
# Check service is active
sudo systemctl status servicename
# Look for: Active: active (running)

# Verify service port is listening
ss -tlnp | grep servicename

# Test service functionality
curl http://localhost:80         <- test web server
mysql -u root -p                 <- test database
ssh localhost                    <- test SSH

# Watch service stays running
watch -n 5 systemctl status servicename

```

### Check Service Logs Clean
```
# Confirm no more errors in logs
sudo journalctl -u servicename -n 20
tail -20 /var/log/servicename/error.log

# Confirm service survives reboot
sudo systemctl reboot
sudo systemctl status servicename
```

### Prevention Checklist

```
# Always test config before applying
sudo nginx -t
sudo apache2ctl configtest

# Keep backups of working configs
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak

# Monitor service status
sudo systemctl enable servicename   <- auto start at boot

# Set up automatic restart on failure
sudo systemctl edit servicename
# Add these lines:
[Service]
Restart=always
RestartSec=5
```

