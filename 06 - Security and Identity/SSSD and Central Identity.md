# SSSD and Central Identity

## Concept

SSSD is the daemon that makes a Linux host a client of a central directory: FreeIPA, Active Directory, or LDAP. It answers NSS (`getent passwd`) and PAM (`auth`, `account`, `session`) from a cache, and it talks to the directory only when it must.

The cache is the product. A host whose SSSD is healthy will keep logging people in during a short directory blip. A host whose cache is cold, expired, or pointed at the wrong domain will not.

## Why it matters

- "SSH works for local root, not for anyone else" is usually SSSD, not sshd
- `getent` failing and PAM failing are different layers. Fixing one and retesting the other wastes the window
- Offline auth depends on cache credentials. A user who has never logged in on that box cannot log in when the DC is down
- Time skew breaks Kerberos. SSSD then looks "down" while chrony is the real fault
- `authselect` (RHEL) or hand-edited PAM will silently drop the `sss` module after a hardening run

## Mental Model

```
getent / id / sshd / sudo
  → nsswitch.conf   passwd: files sss
  → PAM             pam_sss.so in auth, account, session
    → sssd (NSS responder, PAM responder)
      → cache /var/lib/sss/db
      → provider: ipa | ad | ldap | krb5
        → DNS SRV for the domain, then LDAP/Kerberos
```

Config layout:

- `/etc/sssd/sssd.conf` — domains, providers, cache timeouts. Mode `0600`, owner root. SSSD will not start otherwise.
- `[domain/example.com]` — `id_provider`, `auth_provider`, `access_provider`.
- `access_provider = simple` or `ad` or `ipa` decides authorisation after authentication. A valid password can still be denied here.
- `enumerate = true` is how you melt a large AD. Leave it false unless you have a reason and a small directory.

Break-glass is a local account in `/etc/passwd` that does not depend on `sss`. If that account is missing, a directory outage is a console outage.

## Key Commands

```bash
systemctl status sssd
sssctl domain-list
sssctl domain-status example.com
getent passwd alice
id alice
getent group appadmins

# Auth path, not just NSS
sssctl user-checks alice
sssctl user-checks alice -a auth

# Cache and logs
ls -l /etc/sssd/sssd.conf
sssctl cache-expire -u alice          # one user, not the whole domain
journalctl -u sssd -S "30 min ago" --no-pager
# verbose only while debugging; files under /var/log/sssd/

# Discovery
dig +short SRV _ldap._tcp.example.com
dig +short SRV _kerberos._tcp.example.com
kinit alice
klist
timedatectl status

# RHEL PAM integration
authselect current
grep sss /etc/nsswitch.conf
grep sss /etc/pam.d/system-auth /etc/pam.d/password-auth
```

Do not delete `/var/lib/sss/db` as a first step. Expire the one user, or `systemctl stop sssd && sssctl cache-remove && systemctl start sssd` only when the cache itself is the suspect and you can reach a DC.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `getent` misses a new user | Cache negative, or DNS SRV wrong, or wrong domain | `sssctl user-checks`; domain-status; dig SRV |
| `id` works, SSH password fails | PAM stack missing `pam_sss`, or access_provider deny | PAM files; `user-checks -a auth`; secure/auth log |
| SSH key works, session closes | `account`/`session` denied (HBAC, expired, mkhomedir) | sshd journal; `pam_sss` line |
| Worked yesterday, all domain users fail | Clock skew, DC unreachable, expired machine account | `timedatectl`; `kinit`; domain-status |
| Only one host fails | Unique `sssd.conf`, or machine creds | diff conf; `adcli testjoin` / `ipa-getkeytab` health |
| Slow login, then success | Enumeration, or first DC timing out | `enumerate`; DNS order; sssd log timestamps |
| sudo for domain group fails | sudoers uses a group SSSD did not return | `getent group`; nsswitch `sudoers: files sss` |
| Conf change ignored | File mode not `0600`, or no restart | `ls -l`; journal on start |
| Users vanish after `authselect` | Profile without `with-sssd` | `authselect current` |

## Investigation Tips

- Split the question: can NSS see the user (`getent passwd`), can Kerberos get a ticket (`kinit`), can PAM authenticate (`sssctl user-checks -a auth`), can sshd finish a session (journal after `Accepted`). Stop at the first no.
- Check time before you rotate keytabs. Kerberos fails closed at roughly five minutes of skew. See [[Time Sync and chrony]].
- Read the domain log, not only the sssd unit. Failures naming `ldap_sasl` or `Cannot find KDC` are discovery and creds, not "the password is wrong".
- HBAC / GPO access denial is an authorisation success at the password layer. The user did authenticate. The directory said no.
- Keep a local break-glass user and a console path. Test the local user after every PAM or authselect change.
- Negative cache is why a user created "just now" is invisible. Expire that user, do not flush the domain, unless you enjoy a thundering herd against the DC.
- `sssd.conf` secrets and keytabs are credentials. Do not paste them into a ticket. Mode `0600` is also a startup requirement, not only hygiene.

## Related Notes

- [[PAM]]
- [[SSH Hardening and Troubleshooting]]
- [[Users Groups and Permissions]]
- [[sudo]]
- [[Time Sync and chrony]]
- [[DNS Resolution]]
- [[Certificates and PKI]]
- [[Identity in Cloud]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- AD login failed on one VM only. `timedatectl` showed the guest 7 minutes fast after a host migration. `kinit` failed, SSSD logged credential errors, and I almost re-joined the domain. Chrony was the fix.
- A CIS playbook ran `authselect` and dropped `sss` from `password-auth`. Local root still worked, so the first report was "only automation is locked out". `authselect current` matched the change window.
- I cleared the whole cache during an incident. Every login then waited on a distant DC. Expiring one user would have been enough.
