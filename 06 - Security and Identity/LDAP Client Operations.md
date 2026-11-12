# LDAP Client Operations

## Concept

An LDAP client on Linux resolves users, groups, and sometimes sudo or automount maps from a central directory. The usual stack is `sssd` (or the older `nslcd`/`nss-pam-ldapd`) talking to one or more LDAP servers, with TLS, and with a local cache so a directory outage does not instantly lock everyone out.

NSS (`/etc/nsswitch.conf`) and PAM decide when the LDAP source is consulted. SSSD is the component that actually speaks LDAP.

## Why it matters

- “User cannot log in” after a directory change is usually a client-side cache, TLS certificate, or bind-DN problem, not an application bug.
- A full LDAP outage with a cold cache locks out everyone who is not root or a local user. The cache TTL and the offline credentials setting decide how long you survive.
- Certificate expiry on the LDAP servers produces a sudden “all SSH logins fail” that looks like a PAM or sshd problem.
- Nested groups and `memberOf` overlays are the usual reason a user is in the directory but not in the group the sudoers rule expects.

## Mental Model

```
login / sudo / id
  → PAM / NSS
    → sssd
      → cache (memory + disk)
        → LDAP (StartTLS or LDAPS)
          → directory

Cache hit = fast, works offline (if configured)
Cache miss + LDAP down = failure
```

## Key Commands

```bash
# Is the user visible?
getent passwd <user>
getent group <group>
id <user>

# SSSD status and logs
systemctl status sssd
sssctl user-show <user>
sssctl domain-status <domain>
journalctl -u sssd -n 100 --no-pager

# Force cache refresh
sss_cache -E
# or for one user
sssctl cache-expire -u <user>

# Raw LDAP (proves the directory itself)
ldapsearch -H ldaps://ldap.example.com -b dc=example,dc=com -D cn=reader,dc=example,dc=com -W '(uid=<user>)'
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Local users work, LDAP users fail | sssd down, TLS, or bind | systemctl, journalctl -u sssd |
| Worked yesterday, fails today | cert expiry or clock skew | openssl s_client, timedatectl |
| `id` works, sudo does not | sudoers LDAP map or group | sudo -l, sssctl, sudoers |
| Slow logins | LDAP latency or missing index | time getent, ldapsearch timing |
| User in directory but not in group | nested groups, memberOf | ldapsearch memberOf, sssd config |
| Works until reboot | cache only, no persistent offline | sssd.conf cache_credentials |

## Investigation Tips

- Start with `getent passwd <user>`. If that fails, the problem is NSS/sssd/LDAP, not the application.
- `journalctl -u sssd` almost always names the TLS or bind error. Do not guess.
- Clock skew breaks TLS. See [[Time Sync and chrony]].
- A reader bind DN with an expired password is a classic “everything broke at 02:00” incident.
- See [[SSSD and Central Identity]] for the daemon configuration and [[PAM]] for the stack order.
- After changing sssd.conf, `systemctl restart sssd` and then `sss_cache -E`.

## Related Notes

- [[SSSD and Central Identity]]
- [[PAM]]
- [[Users Groups and Permissions]]
- [[Time Sync and chrony]]
- [[Kerberos Operations]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An intermediate CA expired. Every LDAP TLS handshake failed at the same second. Local root still worked; every other login failed. The sssd log said “certificate verify failed” in the first ten lines.
- A user was added to a group in the directory. `id` on the host still showed the old groups for twenty minutes because of the cache. `sssctl cache-expire -u` made the sudo rule work immediately.
