# SSH Hardening and Troubleshooting

## Concept

SSH (OpenSSH) provides encrypted remote access.  
Problems usually fall into one of these layers:

1. Network reachability
2. sshd is running and listening
3. Configuration / hardening rules
4. Authentication (keys, passwords, MFA)
5. Account / shell / SELinux issues

## Why it matters

SSH is the primary access method for most Linux servers.  
Misconfiguration can lock you out; weak configuration is a major security risk.

## Mental Model

```
Client → Network → sshd (listening) → Config checks → Authentication → Session
```

Always test configuration before reloading:

```bash
sshd -t
```

## Key Commands

```bash
# Is sshd running and listening?
systemctl status sshd
ss -tulpn | grep sshd

# Test config
sshd -t

# Detailed client-side debugging
ssh -vvv user@host

# Server logs
journalctl -u sshd -b
journalctl -u ssh -b          # on some distributions

# Effective config (minus comments)
sshd -T | sort
```

### Common hardening settings (sshd_config)

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers / AllowGroups
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no          # if not needed
ClientAliveInterval 300
ClientAliveCountMax 2
```

After changes:

```bash
sshd -t && systemctl reload sshd
```

## Common Failure Modes & Symptoms

| Symptom                          | First checks                              |
|----------------------------------|-------------------------------------------|
| Connection refused               | Is sshd running? Listening on expected port? |
| Connection timed out             | Network / firewall / security groups      |
| Permission denied (publickey)    | Key permissions, authorized_keys, sshd logs |
| Permission denied (password)     | PasswordAuth setting, account lock, PAM   |
| Works from some hosts only       | AllowUsers, firewall, TCP wrappers        |
| Lockout after config change      | Console / cloud serial access needed      |

## Investigation Tips

- Use `ssh -vvv` from the client — it often shows exactly where the handshake fails.
- On the server, always check the journal for sshd while reproducing the login.
- Key file permissions matter: private key `600`, authorized_keys `600`, `.ssh` directory `700`.
- Have a break-glass method (cloud serial console, another user, physical access) before hardening aggressively.

## Related Notes

- [[ss Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[sudo]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
