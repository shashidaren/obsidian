# SSH Agent and Agent Forwarding

## Concept

`ssh-agent` holds private keys in memory and answers signature requests from SSH clients. Agent forwarding (`-A` or `ForwardAgent yes`) lets a remote host use your local agent to authenticate further hops without copying the private key.

It is convenient and also a common pivot path. A compromised intermediate host can use your agent for as long as the connection lives.

## Why it matters

- Avoids scattering private keys across jump hosts and bastions
- A single compromised jump host with agent forwarding enabled can authenticate to every system your key is allowed on
- Many “SSH works from my laptop but not from the jump host” problems are missing agent or wrong `SSH_AUTH_SOCK`
- Corporate policies often ban agent forwarding; understanding the risk lets you design safer alternatives (ProxyJump, certificates, short-lived keys)

## Mental Model

```
Local machine
  ssh-agent (holds keys)
    ↑ SSH_AUTH_SOCK
  ssh client
    → (optional) ForwardAgent → remote sshd
                              → remote processes can use the forwarded socket
```

The remote host never sees the private key. It sees a socket that can request signatures. That socket is only as trustworthy as the remote host.

`ProxyJump` / `ProxyCommand` does not forward the agent by default. You still need `-A` or a config entry if you want it.

## Key Commands

```bash
# Local agent
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519
ssh-add -l          # list loaded keys
ssh-add -D          # remove all

# Forwarding
ssh -A user@jumphost
# or in ~/.ssh/config
Host jumphost
  ForwardAgent yes

# On the remote side, confirm the socket
echo $SSH_AUTH_SOCK
ssh-add -l          # should show your keys if forwarding works

# Restrict forwarding (server side)
# /etc/ssh/sshd_config
AllowAgentForwarding no   # or yes only for specific Match blocks
```

Use `ssh-add -c` (confirm) or hardware keys (FIDO2) to reduce the window an attacker has.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| “Permission denied (publickey)” from jump host onward | Agent not forwarded or empty | `ssh-add -l` locally and on jump, `SSH_AUTH_SOCK` |
| Agent works locally, fails after sudo on remote | `SSH_AUTH_SOCK` not preserved across sudo | `sudo -E` or explicit env, or avoid sudo for the hop |
| Unexpected logins from jump host IP | Agent forwarding + compromised jump | Audit `AllowAgentForwarding`, rotate keys, check auth logs |
| “Could not open a connection to your authentication agent” | Agent not running or socket stale | `eval $(ssh-agent)`, `ssh-add` |
| Forwarding ignored | Server has `AllowAgentForwarding no` | `sshd -T \| grep -i agent` |

## Investigation Tips

- `ssh -vvv` shows whether the client offered agent forwarding and whether the server accepted it.
- On the jump host, `ssh-add -l` is the fastest proof that the agent socket is usable.
- Prefer `ProxyJump` without `-A` when the final destination accepts your key directly or via a certificate. Forward the agent only when you truly need the intermediate to authenticate further.
- Short-lived certificates (see [[SSH Certificates and CA]]) or FIDO2 keys reduce the value of a stolen agent socket.
- Disable agent forwarding globally on bastions that are internet-facing or shared. Enable it only via `Match` for specific admin groups if required.
- After any suspected compromise of a host that had agent forwarding, treat every key that was loaded as potentially used and rotate.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[SSH Tunnels and Jump Hosts]]
- [[SSH Certificates and CA]]
- [[FIDO2 SSH Keys]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A jump host that was briefly compromised led to lateral movement because several admins had `ForwardAgent yes` in their config and long-lived keys loaded. We switched the bastion to `AllowAgentForwarding no` and moved to certificate-based auth with short TTLs.
- “It works from my laptop” was agent forwarding that the jump host’s sudo environment dropped. `ssh-add -l` on the jump host immediately showed an empty agent.
