# TB: Disk Full 

## Why this  Happens  

- Log files growing out of control 
- Old kernel images not cleaned up
- Large core dump files 
- Application writing too much data 
- Temp fles never cleaned 

## Symptoms 
- 'No space left on device' error 
- Application crashes wont start 
- Cannot write to log files 
- SSH login fails 
- Database stops accespting writes  

## Step 1: Diagnose First - Never Delete Blindly 

```
# Check overall disk usage 
df -h

# Check which partition is full
df -h | grep -v tmpfs 

# Find the biggest directories from root 
du -sh /* 2>/dev/null | sort -rh | head -20 

# Drill down into problem directory 
du -sh /var/* | sort -rh | head -10
du -sh /var/log/* | sort -rh | head -10

# Find large files over 100MB 
find / -type f -size +100M 2>/dev/null

# Find large files over 1GB
find / -type f -size +1G 2>/dev/null

# Find files modified in last 24 hours  
find /var/log -type f -mtime -1 | xargs ls -lh
 
```


## Quick Size Reference

```
# du flags to remember 
du -sh       <--summary huhman readable 
du -sh *     <--all items in current dir
sort -rh     <--sort by large files first 
-h           <--human readable (KB MB GB)
```

## Step 2:  Safe Cleanup - Low Risk Command 

### Clean Package Cache 
```
# Debian/Ubuntu/Mint  
sudo apt clean                  <-- remove cached package
sudo apt autoremove             <-- remove unused packages

# RHEL/Centos 
sudo dnf clean all 
sudo dnf autoremove

```

### Clean Old Kernels
```
# Check current kerne first -never remove this one  
uname -r 

# List all installed kernels  
dpkg --list | grep linux-image   <-- Debian/Ubuntu
rpm -qa | grep kernel            <-- RHEL/Centos 

# Auto remove old kernel safely 
sudo apt autoremove --purge      <-- Debian/Ubuntu
sudo dnf remove $(dnf repoquery --installonly --latest-limit=-2 -q)
```

### Clean Log Files Safely

```
# Check journal log size 
journalctl --disk-usage 

# Reduce journal too 500MB 
sudo journalctl --vacuum-size=500M

# Remove logs older than 7 days 
sudo journalctl --vacuum-time=7d

# Truncate a log file safely -never delete active logs 
sudo truncate -s 0 /var/log/syslog

```

## Step 3: Emergency Recovery - Need Space now!

### Find and Clean Temp Files 
```
# Clean temp directories 
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*

# Find and remove core dump files
find / -name "core" -type f 2>/dev/null
sudo find / -name "core" -type f -delete 2>/dev/null

# Find and remove old log archive 
find /var/log -name "*.gz" -type f
sudo find /var/log -name "*.gz" -type f -delete 
find /var/log -name "*.old" -type f -delete 
```

### The Deleted But Still Open Trick
```
# Sometimes a deleted file still holds space 
# because a process has it open 
# Find these ghost files 
sudo lsof | grep deleted 

# Truncate the file without killing process 
sudo truncate -s 0 /path/to/deleted/file 

# Or restart the process holding the file 
sudo systemctl restart servicename
```

### Last Resort - Find and Move Large Files
```
# Move large files to another partition 
mv /var/log/hugefile.log /home/backup

# Or compress then in place 
gzip /var/log/hugefile.log
```


## Step 4: Prevention - Think Like a Senior Admin

### Enable Log Rotation 
```
# Check logrotate config  
cat /etc/logrotate.conf 
ls /etc/logrotate.d/ 

# Test logrotate manually 
sudo logrotate -f /etc/logrotate.conf  
```

### Configure Journal Limits

```
# Edit journald config 
sudo nano /etc/systemd/journald.conf 

# Set limits (uncomment and adjust)
SystemMaxUse=500M
SystemKeepFree=1G
SystemMaxFileSize=100M

# Restart journald
sudo systemctl restart systemd-journald

```

### Monitor Disk Usage

```
# Quick manual check 
df -h 

# Install monitoring tools 
sudo apt install ncdu          <- Debian/Ubuntu
sudo dnf install ncdu          <- RHEL/CentOS

# Interactive disk usage viewer
ncdu /

```

### Set Up Alerts (Concept)

- Monitor disk usage > 80%
- Alert at 85%
- Critical at 90%
- Never wait until 100%


## Tags
#troubleshooting #disk #storage #linux-admin

