# Oracle Listener and Connections

## Concept

The listener (`tnslsnr`) accepts SQL*Net connections, usually TCP 1521, and hands each one to a server process for an instance. It is a separate process from the database. An instance can be open and still unreachable if the listener is down or does not know the service name.

Clients use a connect descriptor: host, port, and a service name (preferred) or SID. That descriptor lives in the app config, in `tnsnames.ora`, or in a JDBC URL.

## Why it matters

- Most "cannot connect" tickets are listener, name resolution, firewall, or service registration — not a corrupt database
- A bequeath session on the server hides all of those
- After a reboot the instance may come up and fail to register until the listener is listening
- `ORA-12514` and `ORA-12541` ask for different fixes. Treating them as one wastes the window

## Mental Model

```
Client
  resolve host
  TCP to host:1521
  tell listener the service name
  listener must have that service in "services"
  listener forks/hands off a server process
  that process attaches to the instance
```

Registration is dynamic by default (PMON / LREG tells the listener). Static entries in `listener.ora` (`SID_LIST`) exist so a down instance can still be started remotely. Dynamic registration needs the listener reachable on the local address the instance expects.

`sqlnet.ora` can force encryption or a timeout. A client that cannot do that looks like a hang, not a refusal.

## Key Commands

```bash
sudo -iu oracle
. oraenv

lsnrctl status
lsnrctl services
ss -lptn | grep -E '1521|tnslsnr'

# From the app host, not the DB host
# tnsping only proves the listener answered, not that the service exists
tnsping ORCL

# Real test: same user, service, and host the app uses
sqlplus appuser@'//db.example.com:1521/ORCLPDB1'

# Logs
# $ORACLE_BASE/diag/tnslsnr/<host>/listener/trace/listener.log
ls -lt "$ORACLE_BASE"/diag/tnslsnr/*/listener/trace/listener.log
```

Useful `lsnrctl` only with a reason: `reload` after an edit, `start` / `stop` during a planned listener bounce. A listener restart drops new connections; existing sessions usually stay.

Find the files actually in use:

```bash
lsnrctl status | sed -n '1,40p'          # shows listener parameter file and log
echo "$TNS_ADMIN"                        # overrides $ORACLE_HOME/network/admin
ls -l "${TNS_ADMIN:-$ORACLE_HOME/network/admin}"
```

## Common Failure Modes & Symptoms

| Error or symptom | Meaning | First checks |
|------------------|---------|--------------|
| `ORA-12541` no listener | TCP reached a host with no listener on that port | `ss`, `lsnrctl status`, firewall, wrong host |
| `ORA-12514` service not known | Listener is up; service name is not registered | `lsnrctl services`; PDB service vs SID |
| `ORA-12505` SID not known | Client used SID, listener has no static SID | Prefer service name; or `SID_LIST` |
| `ORA-12170` / timeout | Routing, firewall, or SQL*Net timeout | `traceroute`/`ss`; client `sqlnet.ora` |
| `ORA-01017` bad user/password | You got into the instance. Auth, not listener | User, password, account status |
| Works as `/ as sysdba`, fails remote | Listener, `REMOTE_LOGIN_PASSWORDFILE`, or network | Remote test from app subnet |
| Intermittent after failover | DNS TTL, or VIP listener not bound | Which IP `ss` shows; DNS answer |
| Hang after TCP connects | TCPS / encryption mismatch, or dispatcher stall | listener log; sqlnet trace only if needed |

## Investigation Tips

- `tnsping` is a listener ping. It does not log in and does not prove the service name. Follow it with one `sqlplus` using the app URL.
- Compare the JDBC URL service (`/ORCLPDB1`) with `lsnrctl services`. A CDB SID and a PDB service are not interchangeable.
- Multitenant: the listener registers each open PDB. A PDB that is `MOUNTED` will not take app connections.
- Firewall tickets: confirm the SYN reaches the DB host (`tcpdump -ni <dev> port 1521`) before you edit `listener.ora`.
- `TNS_ADMIN` and a second `ORACLE_HOME` are why "I edited listener.ora" did nothing. Trust the path in `lsnrctl status`.
- Scan listener.log for the client IP that failed. The alert log will be quiet if the instance never saw the session.

## Related Notes

- [[Oracle for Linux Admins]]
- [[Oracle Alert Log and Processes]]
- [[Connection Exhaustion]]
- [[DNS Resolution]]
- [[Firewall and NAT]]
- [[TLS Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- `tnsping` was green and the app was not. The service in the URL did not match any line in `lsnrctl services`. I had proved the port, not the database.
- A cloud security group allowed 1521 from the old app subnet. The new subnet timed out with `ORA-12170`. The listener log never saw the client. That is a firewall symptom, not an Oracle bug.
- After a listener restart, a PDB that had been closed stayed unregistered. `lsnrctl status` looked healthy because the CDB service was there. The app used the PDB service.
