# TB: System Wont Boot  

## First response  
Stay calm : Boot issues  are almost always recoverable


## Symptoms 

-  Black scren after grub  
-  Kernel Panic  message  
-  Emergency Mode  /  Rescue mode prompt  
-  System hangs at boot 


## Step 1: Grub Recovery 
if system stops at grub screen  

```
# At GRUB menu press 'e' to edit boot entry 
# Find the line starting with 'Linux'
# Add at the end of the line :
systemd.unit=rescue.target 
# Press Ctrl+X to boot  
```

If GRUB menu not showing: 
```
# At BIOS/boot screen hol Shift  (BIOS)
# or press Escape (UEFI)
# This forces GRUB menu to appear 
```

---
**Important tip to add:**

```
## GRUB Config location 
/boot/grub/grub.cfg   < - Do not edit Directly  
/etc/default/grub     <-- Edit this instead  
/etc/grub,d/          <-- GRUB scripts live here 
```

## After GRUB change always run: 
```
sudo update-grub   <-- Debian/Ubuntu/Mint  
sudo grub2-mkconfig  <--RHEL /Centos 
```

## Step 2: Emergency mode 
When system drops to emergency shell: 

```
# First check what failed  
systemctl list-units --failed 

# Read the logs immediately 
journalctl -xe 

# Check filesystem errors  
dmesg | grep -i error 
dmesg | grep -i fail  
```


### Fixing Filesystem Issues in Emergency mode

```
# Remount root system as read-write  
mount -o remount, rw  /

# Check and repair filesystem 
fsck -y /dev/sda1  < -- replace sda1 with your disk 

# Check all file system in fstab 
fsck -A -y 

# If fstab is corrupted - view it
cat /etc/fstab 

# Mount a specific partition manually  
mount /dev/sda1 /mnt 
```

### Exit Emergency mode  
```
# After fixing isues  
systemctl reboot 

# Or if systemctl not responding 
reboot -f 

```

## Step 3: Common Causes and Fixes 

### Cause 1:  bad /etc/fstab entry 
```
# Symptoms: emergency mode, mount errors in journal 
# Fix: edit fstab and corret the bad entry 
nano /etc/fstab 

# Comment out the bad line with #
# Then reboot  
systemctl reboot  

# Better practise - always test fstab before reboot 
mount -a                   <-- mounts all fstab entries 
                           <-- errors show immediately 
```

### Cause 2: Corrupted GRUB
```
# Boot from Live USB then : 
mount /dev/sda1 /mnt 
mount --bind /dev /mnt/dev 
mount --bind /proc /mnt/proc
mount --bind  /mnt/sys

# Reinstall GRUB from inside chroot 
grub-install /dev/sda 
updaate-grub 
exit
reboot
```

### Cause 3: Kernel Panic 
```
# Symptoms: Kernel panic message on screen 
# Fix: boot older kernel from GRUB Menu 
# in GRUB select: Advanced options
# Choose previous kernel version 

# After booting check which kernel install 

dpkg --list | grep linux-image    <- Debian/Ubuntu
rpm -qa | grep kernel             <- RHEL/CentOS
```

## Step 4: Verify Fix 
```
# Confirm  system booted normally 
systemctl is-system-running 

# Check no failed units remain 
systemctl --list-units --failed 

# Verify filesystems mounted correctly 
df -h 
mount | grep -v tmpfs

# Check logs show clean boot  
journalctl -b 0             <-- Current boot logs  
journalctl -b -1            <-- Previous boot log 

# Verify uptime and load normal 
uptime

```

## Document What Happened

```
# Always record in your notes:
# 1. What was the symptom
# 2. What logs showed
# 3. What was the root cause
# 4. What fixed it
# 5. How to prevent it next time

```

## Tags

#troubleshooting #boot #grub #emergency-mode #linux-admin 


---

# 🎉 TB-System-Wont-Boot.md Complete!

**Quick review of what we built:**

| Section | Content |
|---|---|
| Chunk 1 | Symptoms |
| Chunk 2 | GRUB Recovery |
| Chunk 3 | Emergency Mode |
| Chunk 4 | Common Causes and Fixes |
| Chunk 5 | Verify and Document |

---

