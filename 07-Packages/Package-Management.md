# Package Management

tags: #packages #apt #dnf #rpm #admin-daily

## Why This Matters
Package management is daily work — installing, updating,
removing, and troubleshooting software on Linux systems.
Different distros use different tools but concepts are the same.

---

## APT - Debian/Ubuntu/Mint  

### Update and upgrade  

```
apt update                    # refresh package index
apt upgrade                   # upgrade all packages
apt full-upgrade              # upgrade + handle dependencies
apt update && apt upgrade -y  # common daily combo
```

### Install and Remove  

```
apt update                    # refresh package index
apt upgrade                   # upgrade all packages
apt full-upgrade              # upgrade + handle dependencies
apt update && apt upgrade -y  # common daily combo
```

### Search and Info 
```
apt search nginx              # search for a package
apt show nginx                # show package details
apt list --installed          # list all installed packages
apt list --upgradeable        # show packages needing update
```

### Cache Management 
```
apt search nginx              # search for a package
apt show nginx                # show package details
apt list --installed          # list all installed packages
apt list --upgradeable        # show packages needing update
```

## DNF/YUM - RHEL/Centos/Fedora 

### Update and upgrade 
```
dnf check-update              # check available updates
dnf update                    # update all packages
dnf update nginx              # update specific package
yum update                    # older systems (same concept)
```

### Install and remove 
```
dnf install nginx             # install a package
dnf install nginx httpd       # install multiple packages
dnf remove nginx              # remove a package
dnf autoremove                # remove unused dependencies
```

### Search and Info 
```
dnf search nginx              # search for a package
dnf info nginx                # show package details
dnf list installed            # list installed packages
dnf list available            # list available packages
```

### Groups and  History 

```
dnf grouplist                 # show package groups
dnf groupinstall "Development Tools"   # install a group
dnf history                   # show transaction history
dnf history undo 5            # undo transaction number 5
```

## 💡 Quick Comparison To Remember

| Action | APT | DNF |
|--------|-----|-----|
| Update index | `apt update` | `dnf check-update` |
| Install | `apt install` | `dnf install` |
| Remove | `apt purge` | `dnf remove` |
| Search | `apt search` | `dnf search` |

---
## RPM - Low level Package Management  

### Install and Remove 

```
rpm -ivh package.rpm          # install a rpm file
                              # i=install v=verbose h=progress
rpm -Uvh package.rpm          # upgrade a rpm file
rpm -evh package-name         # remove a package

```

### Query and Verify 
```
rpm -qa                       # list all installed packages
rpm -qi nginx                 # show package info
rpm -ql nginx                 # list files in a package
rpm -qf /etc/nginx/nginx.conf # which package owns this file?
rpm -qc nginx                 # list config files of package
rpm -V nginx                  # verify package integrity
```

### Useful Combos  
```
rpm -qa | grep nginx          # search installed packages
rpm -qa | wc -l               # count installed packages
rpm -qa --last | head -20     # show recently installed
```

---

## 💡 RPM Flags To Remember

| Flag | Meaning |
|------|---------|
| `-i` | install |
| `-U` | upgrade |
| `-e` | erase/remove |
| `-q` | query |
| `-v` | verbose |
| `-h` | show progress |

---
## Real World Scenario 

### Scenario 1 - Find  what packages own a file
```
# You find a binary and want to know what installed it
dpkg -S /usr/bin/nginx        # Debian/Ubuntu/Mint
rpm -qf /usr/bin/nginx        # RHEL/CentOS
```

### Scenario 2 -Package broken / corrupted 
```
# Fix broken packages on apt systems
apt --fix-broken install
dpkg --configure -a           # reconfigure unconfigured packages
apt clean && apt update       # clear cache and refresh
```
### Scenario 3 - Hold a package version

```
# Stop a package from being upgraded
apt-mark hold nginx           # hold nginx at current version
apt-mark unhold nginx         # release the hold
apt-mark showhold             # show all held packages

# On DNF systems
dnf versionlock add nginx     # lock package version
dnf versionlock delete nginx  # remove lock
```

### Scenario 4 - Add a repository 

```
# Stop a package from being upgraded
apt-mark hold nginx           # hold nginx at current version
apt-mark unhold nginx         # release the hold
apt-mark showhold             # show all held packages

# On DNF systems
dnf versionlock add nginx     # lock package version
dnf versionlock delete nginx  # remove lock
```

### Scenario 5 - Download without installing 
```
# Useful for offline installs or inspection
apt download nginx            # download .deb only
dnf download nginx            # download .rpm only
```

## Quick Reference and interview tips  

### Files and locations to know  

```
/etc/apt/sources.list         # APT main repo config
/etc/apt/sources.list.d/      # APT additional repos
/var/cache/apt/archives/      # downloaded .deb files
/var/log/dpkg.log             # APT/DPKG activity log

/etc/yum.repos.d/             # DNF/YUM repo files
/var/cache/dnf/               # DNF cache location
/var/log/dnf.log              # DNF activity log
```

### Check Package logs  
```
# See recent package activity
cat /var/log/dpkg.log | grep installed
cat /var/log/dnf.log | grep Installed

# Last 20 apt actions
grep " install " /var/log/dpkg.log | tail -20
```

## Interview Questions You Will Face
```
Q: How do you prevent a package from upgrading?
A: apt-mark hold <package> or dnf versionlock add <package>

Q: System has broken dependencies, what do you do?
A: apt --fix-broken install then dpkg --configure -a

Q: How do you find which package owns a file?
A: dpkg -S <filepath> on Debian, rpm -qf <filepath> on RHEL

Q: Difference between apt remove and apt purge?
A: remove keeps config files, purge deletes everything

Q: How do you check recently installed packages?
A: rpm -qa --last | head -20  or  cat /var/log/dpkg.log
```

