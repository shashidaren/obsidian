# SSH Tunnels and Jump Hosts

## Concept

SSH can forward TCP ports in both directions and can chain through a bastion (`ProxyJump`). A local forward (`-L`) listens on the client and sends the traffic out the remote host. A remote forward (`-R`) listens on the remote host and sends the traffic back to the client. `ProxyJump` / `ProxyCommand` turns a multi-hop path into a single `ssh` command.

## Why it matters

Most production networks have no direct SSH to the application tier. Without a reliable jump and tunnel pattern you either open extra firewall holes or you spend the incident fighting `nc` and `socat` by hand. Tunnels also let you reach a management interface or a database that should never be exposed.

## Mental Model

```
local forward (-L 5432:db:5432):
  your laptop:5432  →  jump host  →  db:5432

remote forward (-R 2222:localhost:22):
  jump:2222  →  your laptop:22
  (useful when the remote cannot initiate outbound)

ProxyJump bastion:
  ssh -J bastion app.internal
  (SSH protocol over SSH, not a TCP tunnel of the SSH port)
```

`ProxyJump` is preferred over manual `-L` of port 22 because it handles the protocol correctly and supports agent forwarding and key constraints.

## Key Commands

```bash
# Jump through a bastion
ssh -J bastion.example.com app.internal

# Config equivalent
Host app
  HostName app.internal
  ProxyJump bastion.example.com

# Local forward to a database that only the app host can reach
ssh -L 15432:db.internal:5432 -N -J bastion app.internal

# Remote forward (the remote opens a listener that reaches you)
ssh -R 2222:localhost:22 -N bastion

# Check what is listening after the tunnel is up
ss -tlnp | grep 15432
```

Use `-N` when you only want the tunnel. Add `ExitOnForwardFailure=yes` in the config so a failed bind aborts the session instead of silently continuing.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `bind: Address already in use` | Local port taken | `ss -tlnp`, change local port |
| Tunnel up but connection refused | Target host/port wrong or firewall on the far side | `ssh` to the target from the jump, `ss` on target |
| Works from laptop, fails from CI | Agent not forwarded or wrong key | `-A` only when needed, `ssh-add -l` |
| ProxyJump hangs | Bastion cannot resolve or reach the next hop | `ssh bastion`, then `ssh` from there |
| Remote forward dies after idle | Server `ClientAlive` or `GatewayPorts` | server config, `ServerAliveInterval` |

## Investigation Tips

- Test the path in pieces: can you SSH to the bastion? From the bastion can you reach the target port? Then add the tunnel.
- `ssh -v` shows which hop is failing. Look for “Authenticated to” and the channel open.
- Prefer `ProxyJump` over nesting `ssh` commands. Nested shells hide the real exit status.
- Do not forward the SSH agent (`-A`) to untrusted hosts. Use a dedicated key with `command=` restrictions if the bastion must reach further.
- For long-lived tunnels use `autossh` or a systemd user unit with `Restart=always` and `ExitOnForwardFailure=yes`.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[Firewall and NAT]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “database unreachable” incident was fixed in two minutes with `ssh -L 5432:localhost:5432 -J bastion app` and a local `psql`. The security group only allowed the app subnet; the tunnel used that path.
- I left a remote forward open overnight and someone on the bastion connected to my laptop. Now remote forwards are bound to 127.0.0.1 unless there is an explicit reason, and they are torn down when the ticket closes.
