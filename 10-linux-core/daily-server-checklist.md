
Quick Checks I perform every morning in production servers 


---

## 1.  System Health 

```
top
htop
free -h
vmstat 1 5
```

# 2.  Cpu and Memory 

```
top
htop
free -h
vmstat 1 5
```

## 3.  Disk Usage

Always check before disk fills up — the #1 cause of outages.

```
df -h
du -sh /var/*
du -sh /home/*
lsblk
```

## 4. Services
```
systemctl --failed
systemctl list-units --type=service --state=running
```


## 5.  Check Logs for Errors
```
 journalctl -p err -b 
 tail -50  /var/log/syslog
 tail -50 /var/log/messages
 dmesg | tail -20
```

## 6. Network Health
```
ip a 
ip r 
ss -tulpn 
ping -c 3 8.8.8.8 `
```

## 7.  Security Quick Check 
```
last -20 
lastb -20 
grep "Failed password" /var/log/auth.log | tail -20 
who

```

## 8.  Related notes 

```
## Related Notes
- [[Systemd Commands]]
- [[Networking Commands]]
- [[Troubleshooting Checklist]]
```
