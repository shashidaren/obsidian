
# Troubleshooting Playbook 

## Overview 
A systematic approach  to diagnosing Linux Issues 
Alwaysfollow : Observer --> Disagnose --> Fix --> Verify 

## Golden Rule  
Dont guess. read the  logs first 
journalctl -xe 
dmesg | tail -20 

## Scenarios

### 🔴 Critical
- [[TB-System-Wont-Boot]] - System fails to boot
- [[TB-Disk-Full]] - No space left on device

### 🟡 Common Daily Issues  
- [[TB-High-CPU-Memory]] - System running slow
- [[TB-Service-Failing]] - Systemd service crashes
- [[TB-Network-Unreachable]] - Cannot reach network

### 🔵 Access Issues
- [[TB-SSH-Wont-Connect]] - Cannot SSH to server
- [[TB-Permission-Denied]] - Access denied errors

## Tags
#troubleshooting #playbook #linux-admin
