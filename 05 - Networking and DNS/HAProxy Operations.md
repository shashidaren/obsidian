# HAProxy Operations

## Concept

HAProxy terminates client connections and load-balances them across backends. It owns listen sockets, health checks, timeouts, stickiness, and the decision to retry or fail over. Clients never see the real servers unless you misconfigure the topology.

Stats socket and `haproxy -c` are the two commands that separate a working reload from a silent outage.

## Why it matters

- Most "app is down" pages are HAProxy: a backend marked down, a timeout shorter than the work, or a health check that lies.
- A bad reload can drop every listener. `haproxy -c` before reload is non-negotiable.
- Retries on non-idempotent methods turn one slow POST into three charges or three writes.
- Connection queues and session rates show up in the stats socket long before the process itself looks unhealthy.

## Mental Model

```
frontend (bind, ACL, default_backend)
    → backend (servers, check, balance, retries)
        → server (weight, check, maxconn, on-marked-down)

Health check: interval, fall, rise, httpchk / tcp-check
Timeouts: client, connect, server, queue, http-request, http-keep-alive
Stats socket: show stat, show errors, show sess, disable server
```

A server can be UP in the process list and DOWN in HAProxy. Trust the stats socket, not `systemctl status` alone.

## Key Commands

```bash
systemctl status haproxy --no-pager
haproxy -c -f /etc/haproxy/haproxy.cfg          # always before reload

# Stats socket (adjust path)
echo "show stat" | socat stdio /run/haproxy/admin.sock | column -t -s,
echo "show errors" | socat stdio /run/haproxy/admin.sock
echo "show info" | socat stdio /run/haproxy/admin.sock
echo "show sess" | socat stdio /run/haproxy/admin.sock | head

# Disable a bad server without a full reload
echo "disable server be_app/srv1" | socat stdio /run/haproxy/admin.sock

curl -v --max-time 5 http://127.0.0.1:8080/healthz     # whatever the check hits
ss -tlnp | grep haproxy
journalctl -u haproxy -n 50 --no-pager
```

Useful `show stat` columns: svname, status, scur, qcur, qmax, ereq, econ, eresp, chkfail, lastchg.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| 503, empty backend | All servers DOWN or maxconn hit | `show stat`, health check definition |
| 504 on long requests | `timeout server` < app p99 | compare timeouts vs app latency |
| Intermittent 502 after deploy | Check still hits old path or needs Host header | curl the exact check URL from the HAProxy host |
| Reload kills traffic | Syntax error that only appears on the second config | `haproxy -c` + staged config |
| Stick-table grows without bound | No expire, or key too broad | `show table`, stick-table size/expire |
| High queue, low CPU | Server maxconn or backend full | scur vs maxconn in stats |
| TLS handshake fails only through HAProxy | Wrong cert, missing chain, or bind not listening on 443 | `show stat` on the frontend, openssl s_client |
| POST duplicated | `retries` on a non-idempotent method | backend retries line |

## Investigation Tips

- `show stat` first. Status, queue, and chkfail tell you more than the error log in the first minute.
- Reproduce the health check exactly: same Host, same path, same HTTP version, from the HAProxy box.
- Draw the timeout chain (client → HAProxy → app → DB) before you raise any number. Raising only `timeout server` just moves the 504.
- Prefer `disable server` for a single bad node over a full reload when you are already in the incident.
- Log `$HAPROXY_SERVER_NAME` and response time. Without them you cannot tell which backend answered.
- `option httpchk` that returns 200 on `/` while the app is wedged is how bad servers stay in rotation. Check a dependency-aware endpoint.
- After any config change, confirm the new server appears UP and the old one is gone before you close the ticket.

## Related Notes

- [[Reverse Proxies]]
- [[Web Server Troubleshooting]]
- [[TLS Troubleshooting]]
- [[curl Deep Dive]]
- [[ss Deep Dive]]
- [[Connection Exhaustion]]
- [[Certificates and PKI]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The health check returned 200 because it hit a static file. Switching to `/ready` that touched the DB stopped a rolling 502 after a schema change. The process was up the whole time.
- I raised `timeout server` to 60s without looking at the client timeout. The browser still gave up at 30s and the user saw a hang. The stats socket showed the request still running on the backend.
- A staged config passed `haproxy -c` on the jump host but failed on the real box because of a missing cert path. Always `-c` on the target host before `systemctl reload`.
