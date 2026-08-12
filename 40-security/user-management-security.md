
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


## 4. Sudo Configuration 

### Run command as root 
```
sudo command 
sudo -i  # switch to root shell 
sudo -s  # root shell keep environment  
sudo su - # switch to root user  
```

### check sudo access for current user 
```
sudo -l 
sudo -l -U username  # check for specific user
```

### Add user to sudo group  
### Ubuntu /Debian/Mint  
```
sudo usermode -aG sudo username 
```

### RHEL/Centos/Rocky
```
sudo usermod -aG wheel username
```

### Edit sudoer safely 
```
sudo visudo 
```

### give user full sudo acess (in visudo)

```
username ALL=ALL(ALL:ALL) ALL
```

### give user sudo without password (in visudo)
```
username ALL=(ALL) NOPASSWD: ALL 
```

### Give user access to specific command only  
```
username ALL=(ALL) NOPASSWD: /usr/bin/systemctl 
```

### Check sudo logs 
```
sudo journalctl | grep sudo 
sudo cat /var/log/auth.log | grep sudo 
```

## Quick tip while you type 💡

- `sudo group` = Ubuntu/Mint world
- `wheel group` = RHEL/CentOS/Rocky world
- `NOPASSWD` is convenient but risky in production
- Limiting sudo to specific commands is best practice
- Interviewers ask _"how do you give user sudo without full root access?"_
- Answer: use `visudo` and specify exact command path

## 5. SSH Hardening  

### check ssh service status  
```
sudo systemctl status sshd  
```

### SSH config file location 
```
sudo cat /etc/ssh/sshd_config 
```

### Important  SSH settings to harden  
```
change default port  (security through obsecuritry)
port 2222
```

### Disable root login 
```
PermitRootLogin no 
```

### Disable passwd authentication (use keys only)
```
PasswordAuthentication no
```
### Limit authentication attemps 
```
MaxAuthTries 3
```

### Set idle timeout 
```
ClientAliveInterval 300
ClientAliveCountMax 2
```

### after every sshd_config change always 
```
sudo sshd -t                  # test config before restart
sudo systemctl restart sshd   # apply changes

```

### Generate ssh keypair 
```
ssh-keygen -t ed25519 -C "your@email.com"
```

### Copy public key to remote user 
```
ssh-copy-id username@serverip
```

### Manual way to add ublic key 
```
cat ~/.ssh/id_ed25519.pub
# paste into remote server:
# ~/.ssh/authorized_keys
```

### Set correct permissions  for SSH 
```
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

## Quick tip while you type 💡

- `PermitRootLogin no` is the most important setting
- Always run `sudo sshd -t` before restarting SSH
- Wrong SSH config + restart = locked out of server!
- `ed25519` is modern and more secure than `rsa`
- SSH key permissions must be strict - SSH will refuse loose permissions
- Interviewers always ask _"how do you harden SSH?"_
- Answer: disable root login, disable password auth, use keys only


## 6. Security Troubleshooting checklist  

### user locked out ?? 
```
sudo passwd -u username # unlock password  
sudo usermod -U username # unlock account 
```

### Check failed login attemps 
```
sudo cat /var/log/auth.log | grep Failed
sudo journalctl | grep "Failed password"
```

### Check who is logged in right now 
```
who
w
last                           # login history
lastb                          # failed login attempts
```

### Check last logins 
```
last username 
```

### Find files with dangerous permissions 
```
find / -perm -4000 2>/dev/null   # SUID files
find / -perm -777 2>/dev/null    # world writable files
```


## Quick Reference
| Command | Purpose |
|---------|---------|
| useradd -m -s /bin/bash | Create user properly |
| usermod -aG group user | Add user to group |
| userdel -r username | Delete user and home |
| passwd username | Set password |
| chmod 755 file | Set permissions |
| chown user:group file | Change ownership |
| sudo visudo | Edit sudoers safely |
| sudo sshd -t | Test SSH config |
| last | Login history |
| lastb | Failed logins |


## Permission Numbers Cheatsheet
| Number | Permission | Meaning |
|--------|-----------|---------|
| 7 | rwx | Full access |
| 6 | rw- | Read write |
| 5 | r-x | Read execute |
| 4 | r-- | Read only |
| 0 | --- | No access |

## Quick tip while you type 💡

- `lastb` is gold in security incidents - shows brute force attempts
- SUID files run as owner not caller - potential privilege escalation
- World writable files `777` are a security nightmare
- These commands show **you think like a security-aware admin**