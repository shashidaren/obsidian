# systemd-timesyncd

## Concept

`systemd-timesyncd` is a simple SNTP client that ships with systemd. It can set the clock from one or more NTP servers and that is all. It does not serve time, does not support reference clocks, and does not offer the step/slew control or monitoring that chrony provides.

On many cloud images and minimal installs it is the default NTP client. It is adequate for a laptop or a host that only needs “roughly correct” time. It is the wrong sole source for Kerberos, databases, or multi-host log correlation.

## Why it matters

- Clock skew still breaks TLS, Kerberos, and log correlation whether the client is timesyncd or chrony.
- Two NTP clients fighting (timesyncd + chronyd, or timesyncd + a guest agent) produce oscillating offsets.
- Cloud images often enable timesyncd by default. Replacing it requires disabling the unit, not only installing chrony.
- `timedatectl` shows which client systemd believes is active.

If you need reliable time under load, leap handling, or serving time, use chrony.

## Mental Model

```
NTP servers (from timesyncd.conf or DHCP)
    → systemd-timesyncd
        → steps or slews the system clock
        → no serving, no chronyc equivalent
```

Configuration is `/etc/systemd/timesyncd.conf` (or drop-ins). The unit is `systemd-timesyncd.service`. Status is visible through `timedatectl` and the journal.

## Key Commands

```bash
systemctl status systemd-timesyncd
timedatectl status
timedatectl show-timesync --all

# Config
cat /etc/systemd/timesyncd.conf
systemctl cat systemd-timesyncd

# Restart after config change
systemctl restart systemd-timesyncd

# Disable in favour of chrony
systemctl disable --now systemd-timesyncd
systemctl enable --now chronyd
```

Typical config:

```
[Time]
NTP=ntp1.internal.example ntp2.internal.example
FallbackNTP=0.pool.ntp.org 1.pool.ntp.org
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Time wrong after boot | No reachable NTP, or unit masked | `timedatectl`, journal |
| Oscillating offset | timesyncd + chronyd both running | `systemctl status` both |
| Kerberos failures after migration | Large step, or skew vs KDC | `timedatectl`, compare to KDC |
| Cloud image ignores local NTP | DHCP NTP or vendor agent overrides | timesyncd.conf, guest agent |
| `timedatectl` says NTP inactive | Unit not started or failed | journal, network to UDP/123 |

## Investigation Tips

- `timedatectl status` first. It shows whether NTP is active and which service is providing it.
- Confirm only one client is running. `ps` for chronyd and timesyncd.
- For anything that needs sub-second accuracy, leap handling, or serving time, migrate to chrony and disable timesyncd.
- After disabling timesyncd, verify with `timedatectl` that chrony is the active client.
- UDP/123 outbound is required. A security group or nft rule that drops it leaves the clock free-running.

## Related Notes

- [[Time Sync and chrony]]
- [[TLS Troubleshooting]]
- [[systemctl Deep Dive]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A golden image had both timesyncd and chrony enabled. The clock stepped every few minutes. Disabling timesyncd and leaving chrony with a limited `makestep` stopped the oscillation.
- Cloud images that “just work” for time often use timesyncd plus the hypervisor guest agent. Document which one owns the clock before you add a third.
- For Kerberos and database hosts I now treat timesyncd as a temporary bootstrap, not the permanent solution.
