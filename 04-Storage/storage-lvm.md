```
# Storage & LVM

**Category:** Storage
**Tags:** #storage #lvm #filesystem #disk
**Last Updated:** {{date}}

---

## Why This Matters
Storage issues are among the top 3 causes of production
outages. LVM gives flexibility that fixed partitions cannot.

---
```

## 1. Disk Inspection 
### List all Block Devices 
```
lsblk 
lsblk -f # Show filessystems and UUID's 
```

### Detailed Disk Info 
```
sudo fdisk -l 
sudo parted -l 
```

### Show Disk Usage (mounted files system)
```
df -h  # human readable 
df -hT # include filesystm type 
df -i  # show inodes (important)
```

### Show Directory Size  
``
```
du -sh /var/log
du -sh /var* | sort -h  # Sorted, Human Readable 
```

## Interview tip to remember 

```
> **"Disk full but df shows space available?"**
> Check inodes with `df -i` — you may have millions of tiny files eating inodes even when bytes are free.

```
## 2.  Partition Management 

## Create/Modify partitions from fdisk 
```
sudo fdisk /dev/sdb #interatif parttion editor 
# inside fdisk 
#   n = new partition 
#   d = delete partition 
#   p = print table 
#   w = write changes 
#   q = quit without saving  
```

### Create partitions with parted (scriptable)
```
sudo parted /dev/sdb mklabel gpt 
sudo parted /dev/sdb mkpart primary ext4 0% 100%
```

### Re-read partition without reboot  
```
sudo partprobe /dev/sdb 
```

## 3. Filesystems  

### Create a filesystem 
```
sudo mkfs.ext4 /dev/sdb1
sudo mkfs.xfs /dev/sdb1
```

### Check and repair a filesystem 
```
sudo fsck /dev/sdb1 #never run on mounted FS 
sudo fsck -y /dev/sdb1 # auto answer yes  
```

### Get filesystem uuid (needed for /etc/fstab)
```
sudo blkid /dev/sdb1
```

```

## 💡 Interview tip

> **"When would you use XFS vs ext4?"**
> - **ext4** — general purpose, good for most Linux servers, mature
> - **XFS** — better for large files & high-performance workloads (default on RHEL/CentOS 7+)

Add as a callout if you like:

```markdown
> [!tip] Interview Gotcha
> RHEL/CentOS 7+ defaults to **XFS**.
> Ubuntu/Debian defaults to **ext4**.
> Know both — you'll see both in the wild.

```