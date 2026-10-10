# Local Mail for Cron and Alerts

## Concept

Classic cron, some monitoring scripts, and a few daemons still emit output by sending mail to a local user. On a modern systemd host that mail usually has nowhere to go unless you deliberately provide a local MTA (or a null client that forwards) and a place to read it.

“The job ran but we never saw the error” is frequently “MAILTO was unset and there is no local delivery”.

## Why it matters

- Cron jobs that print to stdout/stderr are mailed by default. Silence can mean success *or* that mail is being discarded.
- Disk-full, backup-failure, and certificate-expiry scripts historically relied on this path.
- systemd timers do **not** mail by default; they only journal. Mixing the two models without noticing produces missing alerts.
- A local MTA that cannot resolve or cannot relay fills its queue and eventually fills the disk.

If you still have cron jobs, you still need a mail story.

## Mental Model

```
cron / script  →  /usr/sbin/sendmail (or mailx)
                  →  local MTA (postfix, exim, nullmailer, msmtp, …)
                       →  local mailbox (/var/mail/root)   or
                       →  relay to a real SMTP server

systemd timer  →  journal only   (no automatic mail)
```

Two common patterns:

1. Local-only: mail lands in `/var/mail/root` and someone reads it with `mail` or a script tails it.
2. Relay: a null client forwards everything to a central mail host or ticketing system. Local disk stays clean.

`MAILTO=` in the crontab (or `MAILTO=""` to suppress) controls the recipient. An empty MAILTO drops the mail on the floor.

## Key Commands

```bash
# Is anything listening for local mail?
ss -lntp | grep -E ':25|:587'
systemctl status postfix exim4 nullmailer --no-pager

# Queue and local mailbox
mailq
ls -l /var/mail /var/spool/mail
mail -u root                 # interactive; q to quit
cat /var/mail/root | tail -n 50

# Cron configuration
crontab -l
grep -r MAILTO /etc/cron* /var/spool/cron 2>/dev/null

# Force a test message
echo "test from $(hostname)" | mail -s "cron test" root
# or
echo "test" | /usr/sbin/sendmail -v root

# Postfix (most common)
postconf mydestination myorigin relayhost inet_interfaces
journalctl -u postfix -n 50 --no-pager

# Clear a stuck queue after you fix the relay (careful)
postsuper -d ALL deferred
```

Minimal null-client idea (postfix):

```
inet_interfaces = loopback-only
mydestination =
relayhost = [smtp.example.com]:587
# plus SASL if required
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Cron job “succeeds” but errors never appear | MAILTO="" or no MTA installed | crontab, `which sendmail`, mailq |
| `/var/mail/root` grows without bound | Local delivery, nobody reads it | `du -sh /var/mail`, set up relay or rotation |
| Mail queue fills disk | Relay down, DNS failure, auth failure | `mailq`, postfix logs, `df` |
| systemd timer failure invisible in mail | Timers do not mail | `journalctl -u the.service` |
| Duplicate alerts | Both cron *and* a timer + a monitoring agent | inventory of scheduled jobs |
| `sendmail: command not found` | No MTA or alternatives not configured | `dpkg -S /usr/sbin/sendmail` or rpm |
| Mail accepted locally but never leaves | relayhost unset, firewall, or TLS | postconf, journal, tcpdump if desperate |
| Root mail goes to a non-existent user | alias missing in `/etc/aliases` | `newaliases`, grep root /etc/aliases |

## Investigation Tips

- First question: is this a cron job or a systemd timer? The alerting path is different.
- `MAILTO=""` is a silent killer. If you suppress mail, the job must log explicitly (logger, journal, or a file that is monitored).
- A full mail queue is a disk-full incident waiting to happen. Alert on queue length and on `/var/spool` size.
- Prefer a relay (null client) over local mailboxes on servers. Local mailboxes are for workstations.
- After changing postfix, `postfix check` and a test message before you walk away.
- SELinux/AppArmor can block the MTA from writing the mailbox or from connecting outbound. Check the journal for AVC denials.
- If you migrate a job from cron to a timer, remove the cron entry *and* decide where the failure notification now lives (journal + monitoring, or an explicit mail in the script).

## Related Notes

- [[cron and anacron]]
- [[systemd Timers]]
- [[logrotate]]
- [[journalctl Deep Dive]]
- [[Alert Design]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A nightly backup script had been failing for three weeks. MAILTO pointed at a user that no longer existed and the local MTA was not installed, so cron discarded the output. The first sign was a restore test that found nothing.
- Postfix queue on a fleet of hosts filled `/var` after the central relay certificate expired. Queue-length alerts would have fired on day one; disk-full alerts fired on day four.
- Moving a job to a systemd timer without adding a failure notification was silent. The timer showed `failed` in `systemctl --failed` for a week before anyone looked.
