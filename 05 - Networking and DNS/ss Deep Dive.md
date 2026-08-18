# ss Deep Dive

## Concept

`ss` (socket statistics) is the modern replacement for `netstat`. It shows TCP/UDP sockets, listening ports, connection states, and more, with better performance and more detail.

## Why it matters

When a service is “not reachable”, the first question is usually:
- Is anything listening on the expected port?
- Is the connection established, stuck in SYN, TIME_WAIT, etc.?

`ss` answers these quickly.

## Mental Model

```
ss shows the kernel’s view of sockets:
- Listening sockets (servers)
- Established connections
- Connection states (SYN-SENT, ESTAB, TIME-WAIT, CLOSE-WAIT…)
- Queues (send/recv)
```

## Key Commands

```bash
# All TCP sockets with process info
ss -tulpn

# Listening sockets only
ss -tuln

# Established connections
ss -tp state established

# Summary
ss -s

# Connections to/from a specific port
ss -tp sport = :80
ss -tp dport = :443

# Show timer information (useful for stuck connections)
ss -tn state time-wait
ss -tn state close-wait
```

### Useful state filters

```bash
ss -tp state syn-sent
ss -tp state syn-recv
ss -tp state fin-wait-1
ss -tp state fin-wait-2
ss -tp state time-wait
ss -tp state close-wait
```

## Common Failure Modes & Symptoms

| Symptom                          | What ss often shows                  | Meaning                              |
|----------------------------------|--------------------------------------|--------------------------------------|
| Service unreachable              | No listening socket on expected port | Service not started or wrong port    |
| Connections hang                 | Many SYN-SENT                        | Outbound blocked or remote down      |
| Client connections pile up       | Many CLOSE-WAIT or FIN-WAIT          | Application not closing properly     |
| Port already in use              | Listening socket already present     | Conflict / old process still running |
| High connection count            | Large number of ESTAB or TIME-WAIT   | Possible leak or traffic spike       |

## Investigation Tips

- Always add `-p` when you need to know which process owns the socket (requires root).
- `CLOSE-WAIT` usually means the local application is not closing the socket.
- `TIME-WAIT` is normal after a connection closes; large numbers can still cause pressure.
- Combine with `lsof -i` or `lsof -p <PID>` when you need more detail on a specific process.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[File Descriptors]]
- [[lsof Deep Dive]]
- [[curl Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
