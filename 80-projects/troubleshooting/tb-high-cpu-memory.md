 #  TB: High CPU / Memory 

## Why This Happens 
- Runaway proces consuming all  CPU
- Memory leak in application 
- Too many processes running 
- Zombie processes accumulating
- DDOS or traffic spike 

## Symptoms  
- Server feels slow or unresponsive  
- Commands take long to execute 
- Application timing out 
- Load average very high 
- Out of memory killer (OOM) triggered 

## Step 1:  First Response - Get The Big Picture 

```
# Check load average immediately 
uptime  

# Output: load average: 1.5,2.3,1.8
#                       1min 5min 15 min
# Rule: Load average sould not exceeed number of CPUs

# How many CPUs do you have ? 
nproc 
cat /proc/cpuinfo | grep processor | wc -l 

# Quick overall system snapshot 
top 
# Inside top press:
# P  <- sort by CPU usage
# M  <- sort by Memory usage
# k  <- kill a process
# q  <- quit

# Better version of top
htop                              <- more visual
sudo apt install htop             <- if not installed
```

## Understanding Load Average
```
# Example: 4 CPU server
# Load 4.0  = 100% busy - acceptable
# Load 8.0  = 200% busy - investigate now
# Load 16.0 = 400% busy - critical, act fast

# Quick check if load is problem
uptime && nproc

```

## Step 2 : Diagnose CPU -  Go deeper  

### Find CPU Hungry Processes 

```
# Top 10 CPU consuming process
ps aux --sort=-%cpu | head -10 

# Watch processes in real time  
watch -n 2 'ps aux --sort=-%cpu | head -10'

# Check specfic process details  
ps aux | grep processname

# how long has the process be running 
ps -eo pid,comm,etime,pcpu --sort=-%cpu | head -10 
```

### Investigate a Specific Process

# Get process ID (PID)
pidoff processname  
pgrep processname  

# See what files process has open 
lsof -p PID 

# See what the process is doing 

```
strace -p PID                    <- trace system calls
ls -l /proc/PID                  <- process details
cat /proc/PID/status             <- process status
```

### Check CPU Details

# Detailed CPU statistics 
vmstat 2 5                                                          <-- updates every 2sm 5 times 

# us = user cpu 
# sy = system cpu
# id = idle cpu 
# wa = waiting for disk IO

# Per CPU core usage  
```
mpstat -P ALL 2                 <--needs sysstat package 
sudo aprt install sysstat 
```

## Step 3:  Diagnose Memory - find The Leak 

## Check Memory Usage 
```
# Overall memory picture 
free -h 

# Output:
#               total    used    free    shared  buff/cache
# Mem:          15.6G    8.2G    2.1G    456M     5.3G
# Swap:          2.0G    1.2G    800M

# Watch memory in real time 
watch -n 2 free -h 

# Detailed  memory information 
cat /proc/meminfo
```

### Find Memory Hungry Processes

# Top 10 memory consuming process 
```
ps aux --sort=-%mem | head -10

# Show process memory in MB 
ps aux --sort=-%mem | awk '{print $2, $4, $11}' | head -10
# PID %MEM COMMAND

# Check memory per process nicely
top -b -n 1 | head -20 
```

### Check OOM Killer Activity
## Has OOM killer triggered recently  
```
dmesg | grep -i "oom"
dmesg | grep -i "killed process"

# Check in journal  logs 
journalctl -xe | grep -i "oom"
journalctl --since "1 hour ago" | grep -i "killed"

# See full OOM event details 
dmesg | grep -A 5 "oom-killer"

```

## Step 4: Fix and Verify 

### Kill Runaway Process 
```
# Graceful kill - always try this first  
kill -9 PID 

# Force kill -if graceful kill not working 
kill -9 PID

# Kill by name  
killall processname  
pkill processname  

# Kill all processes by user 
pkill -u username 

```

### Manage Process Priority

```
Lower priority of CPU hungry process 
renice +10 PID               <-- lower priority 
renice -10 PID               <-- higher priority 

# Range: -20 (highest) to +19 (lowest)

# Start new process with lower priority
nice -n 10 command

```

### Handle Memory Issues]

```
# Clear memory cache safely 
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches 

# Check and manage swap
swapon --show                    <- show swap usage
swapoff -a && swapon -a          <- reset swap

# Restart memory leaking service
sudo systemctl restart servicename
```

### Verify System Recovered
```
# Confirm load average dropping
watch -n 5 uptime

# Confirm memory freed
watch -n 5 free -h

# Check no more OOM events
dmesg | tail -20

```


