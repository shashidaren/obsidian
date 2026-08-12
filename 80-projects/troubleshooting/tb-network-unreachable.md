# TB: Network Unreachable 

## Why this happens  

- Wrong IP address or subnet mask  
- DNS not configured correctly  
- Firewall blocking traffic  
- Network interface down 
- Cable unplugged or switch issue 
- No network connectivity at all  
- Can ping but no hostname  

## Step 1:  First Response - Check The Basics  

### Check interface status  
```
# show all network interface 
ip addr show 
ip a                             <-- short version

# Check if interface is UP or DOWN
ip link show 
ip link show eth0                <-- specific interface 

# Old style command  still seen in interviews 
ifconfig                       <-- if net-tools installed
ifconfig -a                    <-- show al interface   
```

### Check Routing Table
```
# Show routing table  
ip route show 
ip route                       <-- short version 

# Check default gateway exists
ip route | grep default 
# Should be something lie :
# default via 192.1658.1.1 dev eth0 

# Old style 
route -n 
netstat -rn 
```

### Quick Connectivity Tests

```
# Test local interface  
ping -c 4 127.0.0.1            <--loopback test 

# Test default gateway 
ping -c 4 192.168.1.1          <--replace with ur gateway

# Test external connectivity 
ping -c 8.8.8.8                <-- Google DNS

# Test DNS resolution 
ping -c 4 google.com           <-- if fails , DNS issue  

```

## Step 2: Diagnose - Work From Bottom Up

### Layer 1:  Physical / Interface

```
# is interface up 
ip link show eth0
# Look for: UP or DOWN in output  

# Bring interface up /down 
sudo ip link set eth0 up 

# Check for errors in interface  
ip -s link show eth0 
# look for errors , dropped packets  
```

### Layer 2: IP Address
```
# Does interface have IP address
ip addr show eth0 
# Look for: 192.168.X.X

# Check if IP is correct subnet 
ipcalc 192.168.1.100/24       <-- install if needed
sudo apt install ipcalc 

```

### Layer 3: Routing

```
# Can we reach the gateway
ip route show 
ping -c 4 $(ip route | grep default | awk '{print $3}')

# Trace the route to destination 
traceroute 8.8.8.8               <- install if needed

sudo apt install traceroute
tracepath 8.8.8.8                <- usually pre-installed
```

### Layer 4: DNS
```
# Test DNS resolution
dig google.com
nslookup google.com

# Check DNS configuration
cat /etc/resolv.conf
# Should have nameserver line
# nameserver 8.8.8.8

# Test specific DNS server
dig @8.8.8.8 google.com

```

## Step 3:  Fix Common Issues  

### Fix : Interface Down 
```
# Bring interface up temporarily 
sudo ip link set eth0 up 

# Assign IP address temporarily 
sudo ip addr add 192.168.1.100/24 dev eth0

# Add default gateway temporarily 
sudo ip route add default via 192.168.1.1

# Note : above changes lost after reboot 
# For permanent fix edit network config 
```

### Fix: Permanent Network Config

```
# Debian/Ubuntu - edit netplan config
ls /etc/netplan/
sudo nano /etc/netplan/01-netcfg.yaml

# Example netplan config
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]

# Apply netplan changes
sudo netplan apply
```

### Fix: DNS Not Working
```
# Temporary fix - edit resolv.conf
sudo nano /etc/resolv.conf
# Add this line:
nameserver 8.8.8.8
nameserver 8.8.4.4

# Permanent fix - edit systemd resolved
sudo nano /etc/systemd/resolved.conf
# Set DNS=8.8.8.8
sudo systemctl restart systemd-resolved

```

### Fix: Firewall Blocking Traffic
```
# Check firewall status
sudo ufw status                  <- Ubuntu/Mint
sudo firewall-cmd --list-all     <- RHEL/CentOS

# Temporarily disable to test
sudo ufw disable                 <- Ubuntu/Mint
sudo systemctl stop firewalld    <- RHEL/CentOS

# If network works with firewall off
# Add proper rule instead of leaving it off
sudo ufw allow 22/tcp            <- allow SSH
sudo ufw enable                  <- re-enable firewall

```

## Step 4: Verify Fix 

### Confirm Network Working 
```
# Test layer by layer again
ping -c 4 127.0.0.1              <- loopback
ping -c 4 192.168.1.1            <- gateway
ping -c 4 8.8.8.8                <- external IP
ping -c 4 google.com             <- DNS resolution

# Confirm interface is up and has IP
ip addr show
ip route show

# Test actual service connectivity
curl -I http://google.com        <- test HTTP
ssh user@server                  <- test SSH
```

### Check Network Services

```
# Check what ports are listening
ss -tlnp                         <- TCP listening ports
ss -ulnp                         <- UDP listening ports

# Check specific port
ss -tlnp | grep 22               <- SSH port
ss -tlnp | grep 80               <- HTTP port

# Check network connections
ss -tnp                          <- active connections

```

### Prevention Checklist

```
# Always document your network config
ip addr show > /root/network-backup.txt
ip route show >> /root/network-backup.txt
cat /etc/resolv.conf >> /root/network-backup.txt

# Monitor network interface
ping -i 30 8.8.8.8               <- ping every 30 seconds

```

## Tags

#troubleshooting #networking #dns #firewall #linux-admin