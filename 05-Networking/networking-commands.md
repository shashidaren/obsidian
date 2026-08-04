## Networking Commands  

```
tags: #networking #daily-ops #interview
created: 2025-06
related: [[Daily Server Checklist]], [[Systemd Commands]]

## Why This Matters
- Network issues are the #1 on-call scenario
- ip, ss, dig are used daily by every Linux admin
- Firewall rules protect your servers
- These commands appear in almost every interview
```

## 1.  Ip Command - Network Interface & Routing 

### Show all netowrk interface 
```
ip addr show 
ip a  # short form  
```

### Show specific interface  
```
ip addr show eth0 
ip addr show ens33
```

### Show routing table  
```
ip route show 
ip r   # short form  
```

### Show default gateway 
```
ip route | grep default 
```

### Bring interface up or down

```
ip link set eth0 up 
ip link set eth0 down 
```

### Add ip address to interface  
```
ip addr add 192.168.1.100/24 dev eth9 
```

### Delete ip address from interface  
```
ip addr del 192.1568.1.100/24 dev eth0
```

## 2.  ss Command - Ports & Sockets

### Show all listening ports
```
ss -tlnp
```

### Breaking down the flags
# -t = TCP only
# -l = listening ports only
# -n = show numbers not names
# -p = show process name

### Show UDP ports
```
ss -ulnp
```


### Show all connections (established)
```
ss -tnp
```


### Show specific port
```
ss -tlnp | grep 22
ss -tlnp | grep 80
```


### Show connections to specific port
```
ss -tnp | grep ESTABLISHED
```

### Quick check - what is using port 8080

```
ss -tlnp | grep 8080
```


## DNS - Dig & Nslookup 

### Basic DNS Lookup 
```
dig google.com 
nslookup google.com 
```
### Get just ip address (clean output)
```
dig google.com short 
```

### Query Specific DNS Server 
```
dig @8.8.8.8 google.com 
```

### Look up MX records (mail servers)
```
dig google.com MX
```

### Look up name  servers 
```
dig google.com NS 
```

### Reverse DNS lookup (ip to hostname)

```
dig -x 8.8.8.8
nslookup 8.8.8.8
```

### check your local DNS server 
```
cat /etc/resolv.conf 
```

### Check hosts file (local overrides)
```
cat /etc/hosts 
```

## 4. Connectivity - ping and traceroute 

### Basic ping  
```
ping google.com 
ping 8.8.8.8
```
### Ping with limit (stop after 4 packets )
```
ping -c 4 google.com 
```

### Ping with interval (every 2 seconds)
```
ping -i 2 google.com 
```

### Traceroute - show network hops 
```
traceroute google.com
```

### IF traceroute not installed use 
```
tracepath google.com 
```

### Faster traceroute using TCP 
```
sudo traceroute  -T google.cm 
```

### Check if host is reacheable silently  
```
ping -c 1 google.com > /dev/null && echo "UP" || echo "DOWN"
```

## 5. Firewall  -firewalld and ufw

### UFW  (ubuntu / Debian/ Mint)

### Check firewall status 
```
sudo ufw status 
sudo ufw status verbose 
```

### Enable and Disable firewall 
```
sudo ufw enable 
sudo ufw disable
```

### Allow and Deny ports 
```
sudo ufw allow 80 
sudo ufw allow 22
```

### Allow specific Service by name 
```
sudo ufw allow ssh 
sudo ufw allow http 
```

### Allow from a specific IP 
```
sudo ufw allow from 192.168.1.100
```


### Firewalld (Redhat/Centos/Rocky)

### Check firewall status 
```
sudo firewall-command state 
sudo firewall-command --list-all 
```

### Allow port permanently
```
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --reload
```

### Allow service permanently
```
sudo firewall-cmd --permanent --add-service=http 
sudo firewall-cmd --reload
```

### Remove a rule 
```
sudo firewall-cmd --permanent --remove-port=80/tcp
sudo firewall-cmd --reload
```

## 6. Network Troubleshooting Checklist

### Step 1 - Check interface is up and has IP
```
ip addr show
```

### Step 2 - Check default gateway exists
```
ip route | grep default
```

### Step 3 - Ping gateway first
```
ping -c 4 <gateway-ip>
```

### Step 4 - Ping external IP (bypass DNS)

```
ping -c 4 8.8.8.8
```

### Step 5 - Test DNS resolution

```
dig google.com +short
```

### Step 6 - Check DNS config

```
cat /etc/resolv.conf
```
### Step 7 - Check if port is open locally
```
ss -tlnp | grep <port>
```

### Step 8 - Check firewall rules
```
sudo ufw status
sudo firewall-cmd --list-all
```
### Step 9 - Trace the route
```
traceroute google.com
```

### Step 10 - Check logs for errors

```
sudo journalctl -u NetworkManager --since today
```


## Quick Reference
```
| Command | Purpose |
|---------|---------|
| ip a | Show interfaces and IPs |
| ip r | Show routing table |
| ss -tlnp | Show listening ports |
| dig +short | Quick DNS lookup |
| ping -c 4 | Test connectivity |
| traceroute | Find broken hop |
| ufw status | Check firewall (Ubuntu) |
| firewall-cmd --list-all | Check firewall (RHEL) |
```

