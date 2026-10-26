# systemd Socket Activation

## Concept

Socket activation lets systemd listen on a socket (or FIFO, or datagram) and start the associated service only when the first connection arrives. The service inherits the already-bound file descriptor. No process needs to be running until something actually talks to the port.

This is the opposite of a classic daemon that binds, daemonizes, and waits forever.

## Why it matters

- Idle services consume no CPU, no memory, and no attack surface until used.
- Boot is faster because nothing waits for a service that nobody has connected to yet.
- Port conflicts surface at socket start time, not later when the service tries to bind.
- Restarting the service does not drop the listening socket (systemd holds it).
- Many “the service is not running but the port is open” mysteries are socket units.

## Mental Model

```
.socket unit
  ListenStream= / ListenDatagram= / ListenFIFO=
  → systemd binds the socket at boot (or when the socket unit starts)
  → Accept=no (default): pass the listening fd to the service on first connection
  → Accept=yes: systemd accepts, then starts a new service instance per connection

.service unit
  Requires=foo.socket   (or the socket pulls the service)
  → service receives the fd via sd_listen_fds()
  → classic inetd-style or modern sd_notify ready
```

Common patterns:

- `sshd.socket` + `sshd@.service` (instance per connection on some distros)
- `docker.socket` that starts `docker.service` on first API call
- Custom app `.socket` + `.service` pair so the app never has to bind itself

`Accept=no` (the usual case) means one service process handles the socket. `Accept=yes` means systemd forks a new service for every connection (classic inetd).

## Key Commands

```bash
# Is the socket listening even if the service is inactive?
systemctl status foo.socket
systemctl status foo.service
ss -lntp | grep :PORT
systemctl cat foo.socket
systemctl show foo.socket -p Listen,Trigger,ActiveState

# Start the socket without starting the service
systemctl start foo.socket
systemctl enable foo.socket

# See what will start on connect
systemctl list-sockets
systemctl show foo.socket -p Service

# After changing the socket unit
systemctl daemon-reload
systemctl restart foo.socket
```

Minimal pair:

```ini
# /etc/systemd/system/myapp.socket
[Socket]
ListenStream=127.0.0.1:8080
Accept=no

[Install]
WantedBy=sockets.target

# /etc/systemd/system/myapp.service
[Service]
ExecStart=/usr/bin/myapp
# myapp must call sd_listen_fds() or use a library that does
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Port open, service inactive | Socket activation working as designed | `systemctl status *.socket`, `ss -lntp` |
| Service starts on boot anyway | Service has `WantedBy=multi-user.target` and is enabled | `systemctl is-enabled`, drop the WantedBy or mask the service |
| Connection refused after reboot | Socket unit not enabled | `systemctl enable --now foo.socket` |
| Service gets wrong fd / fails to bind | App not socket-activated (binds itself) | Check `sd_listen_fds`, or set `FreeBind=` / disable app bind |
| Many short-lived processes | `Accept=yes` with a heavy service | Switch to `Accept=no` and a long-running service |
| Socket starts but service crashes | Bad ExecStart or missing socket library support | `journalctl -u foo.service` right after first connect |
| Port still held after `systemctl stop` | Socket unit still active | Stop the `.socket` as well |

## Investigation Tips

- Always check both the `.service` and the `.socket`. `systemctl list-sockets` shows what is listening via systemd.
- If a port is open and no process owns it in `ss -p`, systemd’s socket unit is the owner.
- Do not enable both the service (via `WantedBy=`) and the socket if you want pure on-demand start. Enable only the socket.
- After a service crash, the socket usually stays up and will start a new instance on the next connection. That is often what you want.
- For debugging, temporarily set `StandardOutput=journal` and watch `journalctl -f -u foo.service` while you connect.
- `Accept=yes` + a service that does heavy init is a fork bomb under load. Prefer `Accept=no` unless you truly want inetd-style.

## Related Notes

- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[systemd Timers]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “ghost” listener on port 2375 was `docker.socket`. The docker service was inactive until the first API call. `systemctl list-sockets` ended the mystery in seconds.
- Enabling both `myapp.service` and `myapp.socket` made the service start at boot *and* get confused about who owned the port. Enable only the socket when you want lazy start.
- An app that still called `bind()` itself failed with “address already in use” the moment the socket unit handed it the fd. The fix was either to teach the app about `sd_listen_fds` or to stop using socket activation for that binary.
