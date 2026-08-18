# TCP/IP Troubleshooting Model

**Purpose**: A layered, systematic way to diagnose network connectivity problems.

---

## Core Principle

Start from the bottom (local) and move up.  
Do not jump to DNS or the application before proving the lower layers work.

```
7. Application     (curl, app logs, certificates)
6. DNS             (name resolution)
5. Transport       (TCP/UDP ports, firewalls)
4. Routing         (can we reach the gateway and remote network?)
3. Local stack     (IP address, interface state)
2. Link / Physical (cable, interface up, ARP)
```

---

## 1. Local Interface & Address

```bash
ip link show
ip addr show
ip route show
```

Checks:
- Is the interface UP?
- Does it have the expected IP and prefix?
- Is there a default route?

---

## 2. Gateway & Basic Reachability

```bash
ip route
ping -c 3 <gateway>
ping -c 3 <remote-ip>          # if ICMP allowed
```

---

## 3. Listening Service (on the target)

On the server:

```bash
ss -tulpn | grep <port>
```

Is anything actually listening?

---

## 4. Firewall / Security Groups

- Local: `iptables -L -n -v`, `nft list ruleset`, `firewall-cmd --list-all`
- Cloud: Security groups / Network ACLs
- Path: intermediate firewalls

---

## 5. DNS (only after basic connectivity works)

```bash
getent hosts <hostname>
dig +short <hostname>
cat /etc/resolv.conf
```

Compare application behaviour with `getent` and `dig`.

---

## 6. Application Layer

```bash
curl -v https://target
openssl s_client -connect host:443 -servername host
```

Look at certificates, TLS version, HTTP status codes, application logs.

---

## Quick Decision Tree

| Symptom                        | First layer to check       |
|--------------------------------|----------------------------|
| Nothing works, even by IP      | Local interface & routing  |
| Works by IP, fails by name     | DNS                        |
| Connection refused             | Listening socket / firewall|
| Connection timed out           | Routing, firewall, remote down |
| TLS / certificate errors       | Application / cert layer   |

---

## Related Notes

- [[ss Deep Dive]]
- [[DNS Resolution]]
- [[ip Command Deep Dive]]
- [[curl Deep Dive]]
- [[TLS Troubleshooting]]
- [[Troubleshooting Methodology]]

---

## Personal Lessons Learned

> 
