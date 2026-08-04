
# User Manageent and Security 

tags: #security #users #permissions #ssh #interview
created: 2026-07
related: [[Daily Server Checklist]] , [[Networking Commands]]

## Why This matters 

-  Every Linux  system needs controlled access
-  Wrong permissions = security breach 
- sudo misconfig = biggest risk in the real world  
- SSH hardening is expected in every sysadmin role 
- This topic appears in every interview 

## 1. User management 

## Create new user 
```
sudo useradd username  
sudo useradd -m username  # Create home Directory  
sudo useradd -m -s /bin/bash username  # with bash shell 
```

### Create user with comment  (full name )
```
sudo useradd -m -c "John Smith" -c /bin/bash john 
```

### Set password for user  
```
sudo passwd username 
```

## Modify existing user  
```
sudo usermod -s /bin/bash username  # change shell 
sudo usermod -aG sudo username  # add to sudo group 
sudo usermd  -l newname oldname # rename user  
sudo usermod -l username  # lock account  
sudo usermod  -u username #unlock account  
```
### Delete user 
```
sudo userdel username   # Keep home directory 
sudo userdel -r username # remove home dir too 
```
### Check user detail  
```
id username  
who 
w
```

---

## Quick tip while you type 💡

- `-m` always when creating users - creates home directory
- `-aG` is critical - the `a` means **append** to group
- Without `a` in `-aG` you will **remove** user from all other groups!
- Interviewers love asking about `-aG` vs `-G` difference

## 2. Groups 

### create a new usergroup 
```
sudo groupadd username  
```

## Add a user to group 
```
sudo usermode -aG groupname username  
```

### Remove group 
```
sudo groupdel groupname 
```

### Check groups for a current user  
```
groups 
```

### Check groups for a specific user 
```
groups username  
```

### ------- Important Files  --------

### View user account 
```
cat /etc/passwd
```

### Structure of /etc/passwd 
```
# username:password:UID:GID:comment:home:shell
# shashi:x:1000:1000:Shashi:/home/shashi:/bin/bash
# x means password is in /etc/shadow
```

### View password hashes 
```
sudo cat /etc/shadow
```

### Structure of /etc/shadow
```
#username:hashedpassword:lastchange:min:max:warn:inactive:expire
```
### View all groups  
```
cat /etc/group 
```

### View sudoers file (never edit directly )
```
sudo cat /etc/sudoers 
```

### safe way to edit sudoers  
```
sudo visudo 
```

## Quick tip while you type 💡

- `/etc/passwd` is readable by everyone - no passwords stored here
- `/etc/shadow` has password hashes - root only
- **Never** edit `/etc/sudoers` directly - always use `visudo`
- `visudo` validates syntax before saving - prevents lockout
- Interviewers ask _"where are passwords stored in Linux?"_
- Answer: hashed in `/etc/shadow`

## 3. Files permissions - chown and chmod  

### View permissions 
```
ls -la 
ls -la /etc/passwd
```

### Permission Structure  
```
# -rwxrwxrwx
# - = file type (- file, d directory, l link)
# rwx = owner permissions
# rwx = group permissions
# rwx = others permissions

```

### chmod  - numeric method  
```
sudo chmod 755 filename    # rwxr-xr-x
sudo chmod 644 filename    # rw-r--r--
sudo chmod 600 filename    # rw-------
sudo chmod 777 filename    # rwxrwxrwx (avoid this)
```

### Common permission numbers  
```
# 7 = rwx (read, write, execute)
# 6 = rw- (read, write)
# 5 = r-x (read, execute)
# 4 = r-- (read only)
# 0 = --- (no permissions)
```

### chmod  - Symbolic method  
```
chmod u+x filename         # add execute for owner
chmod g-w filename         # remove write for group
chmod o-r filename         # remove read for others
chmod a+x filename         # add execute for all
```
### chown - change ownership 
```
sudo chown username filename 
sudo chown username:groupname filename  
sudo chown -R username:groupname /directory 
```
### chgroup - change group only  
```
sudo chgroup groupname filename 
```

## Quick tip while you type 💡

- `755` = standard for scripts and directories
- `644` = standard for config files
- `600` = private files like SSH keys
- `777` = never use in production - security risk
- `-R` means recursive - applies to all files inside directory