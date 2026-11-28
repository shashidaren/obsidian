# SSH ControlMaster and Multiplexing

## Concept

SSH multiplexing lets multiple sessions share a single TCP connection and authentication via a control socket (`ControlMaster` / `ControlPath` / `ControlPersist`). Subsequent `ssh`, `scp`, or `rsync` commands to the same host reuse the master connection, avoiding repeated handshakes and key prompts.

## Why it matters

- Automation that opens dozens of SSH sessions per minute (deploy scripts, monitoring, parallel rsync) can hit `MaxStartups` or simply waste time on handshakes.
- A long-lived ControlMaster reduces load on both client and server and makes jump-host hops feel instant.
- A stale control socket after a network blip produces “Control socket connect failed” errors that look like SSH is broken.
- Multiplexing changes the failure domain: one dead master takes every multiplexed session with it.

## Mental Model

```
First ssh -o ControlMaster=auto -o ControlPath=... -o ControlPersist=10m host
    → creates control socket, authenticates once
Subsequent ssh/scp/rsync to same host
    → connect to socket, reuse channel
ControlPersist keeps master alive after last client exits
```

The socket is a Unix domain socket; permissions and path matter. `ssh -O check/exit/stop` manages the master.

## Key Commands

```bash
# Typical client config snippet
# Host *
#   ControlMaster auto
#   ControlPath ~/.ssh/cm-%r@%h:%p
#   ControlPersist 10m

# Check / stop a master
ssh -O check user@host
ssh -O exit user@host
ssh -O stop user@host

# Force a new connection (ignore existing master)
ssh -o ControlMaster=no -o ControlPath=none user@host

# See the socket
ls -l ~/.ssh/cm-*
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| “Control socket connect failed” | Stale socket after disconnect | `ssh -O exit`, rm socket |
| Works once, then hangs | Master died, socket left behind | `ssh -O check`, `ps` for ssh |
| Permission denied on socket | Wrong user or umask | `ls -l` ControlPath dir |
| MaxStartups still hit | Multiplexing not actually used | `ss -tnp`, confirm one connection |
| Automation flaky after laptop sleep | ControlPersist + network change | shorter Persist or explicit -O exit |

## Investigation Tips

- When a script suddenly cannot SSH, test with `ControlMaster=no` first. If that works, the control socket is the problem.
- `ControlPersist` is convenient for interactive use and dangerous for short-lived CI jobs that expect a clean exit. Set it to `no` or a few seconds in automation.
- The control socket directory must be writable only by the user. A world-writable `~/.ssh` breaks both authorized_keys and multiplexing.
- On a jump host, multiplexing the first hop often gives more benefit than multiplexing the final hop.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[SSH Tunnels and Jump Hosts]]
- [[SSH Agent and Agent Forwarding]]
- [[fail2ban Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A deployment job that opened 40 parallel SSH sessions started failing with “Too many authentication failures” after we enabled ControlMaster incorrectly (each parallel job created its own master). Switching to a single shared ControlPath and `ControlMaster=auto` dropped the connection count to one and eliminated the failures.
- After a VPN reconnect, every multiplexed session reported “broken pipe”. `ssh -O exit` followed by a fresh connection restored service; the old master had been bound to the previous source address.
