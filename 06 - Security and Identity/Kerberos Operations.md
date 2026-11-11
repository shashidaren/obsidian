# Kerberos Operations

## Concept

Kerberos is a ticket-based authentication protocol. A client proves its identity to a Key Distribution Center (KDC) with a password or keytab and receives a Ticket-Granting Ticket (TGT). Service tickets are then requested for specific services (HTTP, NFS, SSH, etc.) without sending the password again.

Clocks must agree within the skew tolerance (default 5 minutes). The KDC and the service both check timestamps.

## Why it matters

- “Clock skew too great” is the most common production failure and is almost never a password problem.
- Keytabs that drift from the principal’s password (or are regenerated without updating clients) produce “Decrypt integrity check failed” or “Server not found in Kerberos database”.
- Cross-realm trusts and SPN mismatches look like network problems until you look at the ticket.
- NFS, HTTP SPNEGO, and AD-integrated SSH all stop when tickets expire or the ccache is wrong.
- A KDC outage takes down every service that requires Kerberos; local accounts and keytabs do not save you if the service itself requires a ticket.

## Mental Model

```
kinit → AS-REQ/AS-REP (TGT from KDC)
     → TGS-REQ/TGS-REP (service ticket for host/service@REALM)
     → AP-REQ to the service

ccache  — ticket cache (FILE:/tmp/krb5cc_UID or KEYRING)
keytab  — long-lived key for a principal (service or machine)
SPN     — service principal name that must match the service’s DNS name
skew    — |client clock − KDC clock| < max_skew (usually 300s)
```

One KDC (or a set of replicas) is the source of truth for principals. Clients and services only need a correct `/etc/krb5.conf` (or DNS SRV) and a working clock.

## Key Commands

```bash
# Current tickets and expiry
klist
klist -ef          # encryption types
klist -A           # all caches

# Get a TGT
kinit user@REALM
kinit -k -t /etc/krb5.keytab host/$(hostname -f)@REALM

# Destroy
kdestroy

# Verbose negotiation (very useful)
KRB5_TRACE=/dev/stderr kinit -V user@REALM

# Config and realm discovery
cat /etc/krb5.conf
klist -s && echo "valid TGT" || echo "no valid TGT"

# Keytab contents (no password)
klist -k -t /etc/krb5.keytab

# Clock (always check first)
chronyc tracking | grep "System time"
date -u
```

Typical `/etc/krb5.conf` snippet:

```
[libdefaults]
  default_realm = EXAMPLE.COM
  dns_lookup_kdc = true
  ticket_lifetime = 10h
  renew_lifetime = 7d

[realms]
  EXAMPLE.COM = {
    kdc = kdc1.example.com
    admin_server = kdc1.example.com
  }
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Clock skew too great` | Offset > max_skew | `chronyc tracking`, compare to KDC |
| `Decrypt integrity check failed` | Wrong keytab or password changed | `klist -k`, re-ktpass / ktutil |
| `Server not found in Kerberos database` | SPN missing or wrong DNS name | `setspn` / `ipa service-show`, forward/reverse DNS |
| `KDC reply did not match expectations` | Wrong realm, DNS SRV, or MIT vs Heimdal | `krb5.conf`, `dig SRV _kerberos._tcp` |
| Ticket expired, app still “logged in” | ccache not renewed, long-running process | `klist`, `kinit -R` or keytab renewal |
| NFS “nobody” or access denied after mount | idmap + Kerberos principal mismatch | `nfsidmap`, `klist` on client |
| Works from one host, fails from another | Different krb5.conf or clock | Diff configs, `chronyc` on both |
| `Cannot find KDC` | Firewall, DNS, or KDC down | `dig`, `nc -uvz kdc 88`, journal on KDC |

## Investigation Tips

- Always start with `chronyc tracking` and `klist`. Skew or an expired TGT explains the majority of pages.
- `KRB5_TRACE=/dev/stderr` on the client shows the exact AS/TGS exchange and the principal it is requesting.
- Confirm the SPN the client is requesting matches the one registered for the service. Reverse DNS often decides the hostname used.
- Keytabs are secrets. Never copy them into tickets or chat. Rotate by creating a new keytab on the KDC and distributing it atomically.
- For AD-joined hosts, SSSD usually manages the keytab. Check `sssctl domain-status` and the machine account password age before blaming Kerberos itself.
- After a clock step, existing tickets may become invalid or “in the future”. `kdestroy` + `kinit` is safer than hoping they recover.
- UDP/88 is the classic port; modern KDCs also speak TCP/88. Blocked TCP is a common “works for small tickets, fails for large” symptom.

## Related Notes

- [[Time Sync and chrony]]
- [[SSSD and Central Identity]]
- [[Certificates and PKI]]
- [[NFS Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “Kerberos is broken” page after a VM snapshot restore was 12 minutes of skew. `chronyc makestep` + `kinit` fixed it; the keytab was fine.
- An HTTP service kept failing SPNEGO after a hostname change. The SPN still pointed at the old name. `setspn` and a restart of the service were required; the keytab itself did not need regeneration.
- Long-running batch jobs that did `kinit` once at start died at the 10-hour mark. A systemd timer that renewed the keytab-based TGT every few hours made them boring.
