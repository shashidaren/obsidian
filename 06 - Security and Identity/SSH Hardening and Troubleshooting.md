# SSH Hardening and Troubleshooting

## Concept

OpenSSH is encrypted remote login plus a small pile of optional tunnels. Failures live in layers: path to port, daemon alive and listening, `sshd_config` / Match blocks, authentication (keys, certs, passwords, PAM, MFA), then account, shell, home directory, and MAC (SELinux/AppArmor).

Hardening and troubleshooting are the same skill. Every knob you tighten is a new way to lock yourself out. Test config, keep a second session open, and have console access before you reload.

## Why it matters

- SSH is still how most Linux boxes are operated. If it breaks, every other fix waits on serial console
- Weak defaults (password auth, root login, old host keys, open forwarding) are how boxes get owned
- Permission-denied tickets waste hours when the real issue is `600` on `authorized_keys`, a Match block, or PAM

## Mental Model

```
client ssh
  → TCP (or ProxyJump) to host:port
    → sshd accept + banner / kex / host key
      → sshd_config + Match (user, address, group)
        → auth: publickey / certificate / password / keyboard-interactive (PAM, MFA)
          → PAM account + session (limits, selinux, home)
            → login shell / forced command / subsystem
```

Client `-vvv` tells you which *auth method* died. Server journal tells you *why* sshd rejected it. You need both.

Always:

```bash
sshd -t && sshd -T | sort   # syntax + effective config
```

Reload, do not restart, when you already have a session: `systemctl reload sshd` (unit name is `ssh` on Debian).

## Key Commands

```bash
# Daemon and listen address
systemctl status sshd || systemctl status ssh
ss -tulpn | grep sshd
sshd -T | grep -E '^(port|listenaddress|permitrootlogin|passwordauthentication|pubkeyauthentication)'

# Config test before reload
sshd -t && systemctl reload sshd

# Effective config as sshd would apply it for a user/source
sshd -T -C user=alice,host=10.1.2.3,addr=10.1.2.3 | sort

# Client evidence
ssh -vvv -o PreferredAuthentications=publickey alice@host
ssh -G alice@host | grep -E 'identityfile|proxystation|proxyjump|port'

# Server evidence while you reproduce
journalctl -u sshd -u ssh -f
# RHEL-like also: /var/log/secure    Debian-like: /var/log/auth.log

# Host keys the client will pin
ssh-keyscan -t rsa,ecdsa,ed25519 host

# Permissions that actually matter
ls -ld ~alice ~alice/.ssh ~alice/.ssh/authorized_keys
# expect: home not group-writable, .ssh 700, authorized_keys 600, owned by alice
```

### Hardening baseline (adjust, then test)

```
Protocol 2
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
AllowUsers alice bob
# or AllowGroups ssh-users
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
PermitTunnel no
ClientAliveInterval 300
ClientAliveCountMax 2
# Debian: PasswordAuthentication is often re-enabled in /etc/ssh/sshd_config.d/*
```

Leave one break-glass path: cloud serial, out-of-band console, or a second user not covered by the new Match block.

## Common Failure Modes & Symptoms

| What you see | Likely meaning | First checks |
|--------------|----------------|--------------|
| Connection refused | Nothing listening, wrong port, socket activation failed | `ss -tlnp`, unit status, `ListenAddress` |
| Timeout / no banner | Security group, NACL, host firewall, wrong IP, tcpwrappers | Path from *this* source IP; `nc -vz host 22` |
| Host key changed warning | Rebuild, compromise, or anycast/load-balanced VIP | Compare `ssh-keyscan` to known_hosts; do not `-o StrictHostKeyChecking=no` as habit |
| Permission denied (publickey) | Wrong key, agent empty, perms on `.ssh`, `AuthorizedKeysFile`, Match | `-vvv` which key was offered; server “Failed publickey”; `ls -l` |
| Permission denied (password) | PasswordAuth off, account locked, PAM, expired password | `sshd -T`, `passwd -S`, PAM stack |
| Works from office, not CI | `AllowUsers` / `Match Address` / firewall / MaxStartups | `sshd -T -C addr=...` |
| Auth ok, session drops | Forced command, bad shell, home missing, SELinux, disk full | journal after “Accepted”; `getent passwd`; `df -h` |
| Locked out after reload | Syntax ok but Match/AllowUsers excluded you | Console; keep old session until a *new* login works |
| Slow login (~seconds) | Reverse DNS (`UseDNS`), GSSAPI, dead MOTD scripts | `UseDNS no`; `ssh -vvv` where it pauses |
| Agent forwarding surprise | `AllowAgentForwarding` + jump host | Do not enable globally; use `-A` only on known jumps |

## Investigation Tips

- Reproduce with a single auth method: `-o PreferredAuthentications=publickey` so password / GSSAPI noise does not hide the real failure.
- Debian splits config under `/etc/ssh/sshd_config.d/`. `sshd -T` is the only honest view.
- `authorized_keys` options (`from=`, `command=`, `restrict`) fail closed. A key that works on one host may be restricted on another.
- Root’s keys live in `/root/.ssh`. `PermitRootLogin prohibit-password` still allows root by key — that is not “root login off”.
- Cloud images often ship a vendor snippet that turns password auth back on. Grep `sshd_config.d` after every image update.
- SELinux `sshd_t` will deny a non-standard `AuthorizedKeysFile` on NFS homes. Check `ausearch` / `journalctl` for AVC, not just sshd.
- Never debug by setting `LogLevel DEBUG3` on a public-facing bastion and walking away. Use it briefly, then revert.

## Related Notes

- [[ss Deep Dive]]
- [[TCP IP Troubleshooting Model]]
- [[PAM]]
- [[sudo]]
- [[SELinux Deep Dive]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have locked myself out with a syntactically valid `AllowUsers` list that omitted the automation account. `sshd -t` does not test policy against your username. `sshd -T -C user=...` does.
- “Permission denied (publickey)” was group-writable home on a shared NFS tree. sshd refuses the key and the log line is easy to miss.
- A hardening commit disabled `AllowTcpForwarding` and broke a deployment that used `-L`. Treat forwarding as a product feature with owners, not a default to flip.
- Always open a second session *and* confirm a fresh login from another host before you close the laptop.
