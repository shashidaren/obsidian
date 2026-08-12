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

## 4. LVM (Logical Volume Manager)

### The LVM stack (bottom + top )
```
Physical Disks → /dev/sdb, /dev/sdc
↓
Physical Volume → PV (pvcreate)
↓
Volume Group → VG (vgcreate) — pool of storage
↓
Logical Volume → LV (lvcreate) — usable "partition"
↓
Filesystem → mkfs.ext4 /dev/vg_name/lv_name
↓
Mount Point → /data

```

  
**Analogy:** PVs are bricks, VG is the wall you build from them, LVs are rooms you carve out of the wall. ---


### Step 1: Create Physical Volume  (PV)
```
sudo pvcreate /dev/sdb /dev/sdc 
sudo pvs   # summary 
sudo pvdisplay # detailed  
```

### Step 2: Create Volume Group (VG)

```
sudo vgcreate /vg_data /dev/sdb /dev/sdc 
sudo vgs 
sudo vgdisplay vg_data 

```

## Step 3: Create Logical Volume 
```
sudo lvcreate -L 10G -n lv-app vg_data 
sudo lvcreate  -l 100%FREE -n lv_logs vg_data # use all remaining space  
sudo lvs  
sudo lvdisplay 
```

### Step 4: Format and mount 
```
sudo mkfs.ext4 /dev/vg_data/lv_app 
sudo mkdir /data 
sudo mount /dev/vg_data1/lv-app /data 
```

## The killer feature - Extend and LV live (no downtime)

### Extend a Logical Volume  
```
# 1. Add space to the  LV
sudo lvextend -L +5G /dev/vg_data_lv_app 

# 2. Grow the filesystem to match 
sudo resize2fs /dev/vg_data/lv_app  # for ext4  
sudo xfs_growfs /data               # fr XFS (mount point1)
```

### Add new disk to existing VG 
```
sudo pvcreate  /dev/sdd 
sudo vgextend vg_data /dev/sdd 
sudo vgs   #confirm new size  
```

```
## 💡 Interview gold — add this callout

```markdown
> [!tip] The #1 LVM Interview Question
> **"How do you extend a filesystem without downtime?"**
> 1. `lvextend -L +5G /dev/vg/lv`
> 2. `resize2fs` (ext4) OR `xfs_growfs` (XFS)
>
> **Gotcha:** XFS can only GROW, never shrink.
> ext4 can do both (but shrinking requires unmount).
```

