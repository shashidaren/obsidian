# SSH Hardening and Troubleshooting

## Concept

SSH is the remote shell, file transfer, and tunnel protocol that almost every Linux admin uses. Hardening is mostly about authentication method, exposure, and what a compromised key or password can do. Troubleshooting is mostly about which hop failed: DNS, TCP, host key, auth method, or the shell that starts after auth.

## Why it matters

- Password authentication on an internet-facing port is a continuous brute-force tax on logs, fail2ban, and account lockout policies.
- A single leaked key with `AllowAgentForwarding` or a `ForceCommand` bypass can turn one host into a pivot.
- “SSH is down” is often DNS, a changed host key, `MaxStartups`, or `AllowUsers` — not a dead sshd.
- Tunnel and jump-host patterns are how you reach private networks; a broken `ProxyJump` looks like a network outage.

## Mental Model

```
Client → TCP/22 → sshd
  → host key check (known_hosts)
  → auth (publickey, password, keyboard-interactive, GSSAPI)
  → session (shell, command, sftp, tunnel)

Hardening levers:
  PasswordAuthentication no
  PermitRootLogin no (or prohibit-password)
  AllowUsers / AllowGroups
  PubkeyAuthentication yes
  MaxAuthTries, MaxStartups
  (optional) Match blocks for source or user
```

The server decides what is allowed; the client decides what it will try. A client that only offers a password against a server that only accepts keys fails at auth, not at TCP.

## Key Commands

```bash
# Server status and config that is actually in effect
systemctl status sshd --no-pager
sshd -T | grep -E 'passwordauthentication|permitrootlogin|pubkeyauthentication|allowusers|maxstartups|port'

# Client debug (the most useful single command)
ssh -vvv user@host

# Host key and known_hosts
ssh-keygen -F host
ssh-keyscan -t ed25519 host

# Who is connected
ss -tnp | grep ':22'
who

# Authorized keys and permissions (must be 700/600)
ls -ld ~/.ssh; ls -l ~/.ssh/authorized_keys
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Connection refused | sshd down, wrong port, firewall | `ss -tlnp`, firewall, `systemctl status sshd` |
| Connection timed out | routing, security group, wrong IP | `ip route get`, cloud SG, ping/traceroute |
| Host key changed warning | reinstall, MITM, or IP reuse | `ssh-keygen -R`, verify out-of-band |
| Permission denied (publickey) | wrong key, bad perms, AllowUsers | `-vvv`, `~/.ssh` perms, server auth log |
| Permission denied (password) | PasswordAuthentication no | `sshd -T`, client `-o PreferredAuthentications=password` |
| Too many auth failures / MaxStartups | brute force or many keys offered | fail2ban, `MaxStartups`, client `IdentitiesOnly` |
| Works for one user, not another | AllowUsers/AllowGroups or shell | `/etc/passwd` shell, Match blocks |
| Hangs after auth | shell profile, DNS reverse, GSSAPI | `ssh -vvv`, `UseDNS no` |

## Investigation Tips

- `ssh -vvv` on the client and `journalctl -u sshd -f` on the server together solve most auth problems in one pass.
- Check effective config with `sshd -T`, not by reading every Include file. The running daemon may differ from the file you edited until reload.
- `~/.ssh` must be 700 and `authorized_keys` 600, owned by the user. sshd is deliberately picky; a 644 key file is a silent failure.
- When many keys are offered, the server may hit `MaxAuthTries` before the right key. `IdentitiesOnly yes` and an explicit `IdentityFile` fix it.
- After hardening, test from a second session before you close the one you are using. Lockouts are real.
- See [[fail2ban Operations]] if brute-force noise is the immediate problem; disabling passwords is the durable fix.

## Related Notes

- [[fail2ban Operations]]
- [[Users Groups and Permissions]]
- [[Certificates and PKI]]
- [[PAM]]
- [[Firewall and NAT]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The most common “SSH broken after hardening” ticket I see is `PasswordAuthentication no` combined with a client that had no key loaded. `-vvv` shows the client never offered a public key.
- A jump host outage was `MaxStartups` tripped by a monitoring script that opened hundreds of connections per minute. Raising the limit was the wrong fix; the script was.
- I have locked myself out by editing `AllowUsers` and forgetting the reload left the old config until restart. Always keep a console or a second path.
