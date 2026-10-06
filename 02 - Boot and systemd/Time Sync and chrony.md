# Time Sync and chrony

## Concept

chrony keeps the system clock close to a set of NTP sources. It can **step** (jump the clock) or **slew** (speed the clock up or down until the offset is gone). After the first few samples it prefers to slew, because a backwards step rewrites the past that every other subsystem already recorded.

`chronyd` is the daemon. `chronyc` is the client. On many distros it replaces `ntpd`. `systemd-timesyncd` is a simpler SNTP client — fine for a laptop, wrong as the only time source for Kerberos, databases, or anything you correlate in an incident.

## Why it matters

Clock skew is a silent dependency:

- TLS rejects certs that are “not yet valid” or already expired when the local clock is wrong. A host set in 2019 fails every handshake.
- Kerberos default tolerance is about five minutes. Skew past that is `Clock skew too great`, not a password bug.
- Log correlation across hosts is fiction if clocks disagree by minutes. “A happened before B” becomes an argument.
- Database replicas, leases, backups, and certificate renewals all compare timestamps. A step backwards can replay a window, stall a lease, or make a replica look like it is in the future.
- Distributed locks and consensus (etcd, Ceph monitors, Kafka) treat a large offset as a partition or a fencing event.

If the clock is wrong, fix the clock before you rotate credentials or “debug TLS”.

## Mental Model

```
sources (NTP servers, pool, PPS, local refclock)
    → chronyd estimates offset + frequency error
    → step if offset is large AND stepping is allowed
    → otherwise slew (adjtimex frequency)

makestep 1.0 3
    step only if |offset| > 1.0s
    and only on the first 3 clock updates
    after that, slew — even if the offset is ugly

iburst
    on the server line: burst of packets at startup
    so the first sync is seconds, not minutes
```

Two clocks people mix up:

- **RTC** (hardware clock) — used at boot, then usually left alone. `hwclock` is not the live clock.
- **system clock** — what `date`, TLS, and logs use. chrony disciplines this.

VM guests have a third liar: the hypervisor. Live migration, snapshot resume, and host overload (`%st`) all move the guest’s idea of time. `kvm-clock` tracks the host; a guest that also steps hard against public NTP will fight the hypervisor.

Leap seconds: NTP announces a leap. chrony can step or smear. A smear (often done at the stratum-1 or by `leapsecmode`) spreads the extra second so applications never see 23:59:60. Mixed smear and non-smear sources look like a 1s offset. Do not “fix” that by flapping sources mid-leap.

## Key Commands

```bash
# Is it even running, and is it allowed to step?
systemctl status chronyd --no-pager
chronyc tracking
# System time offset, RMS, frequency, leap status, stratum, "Leap status"

chronyc sources -v
# ^* selected, ^+ combined, ^- not combined, ^? unreachable
# Reach is an octal shift register; 377 means the last 8 polls succeeded

chronyc sourcestats -v
chronyc activity          # how many sources online / offline

timedatectl status
timedatectl show-timesync --all    # if timesyncd is the one actually running

# Force a step now (incident only — say so in the ticket)
chronyc makestep
# equivalent older form: chronyc -a makestep

# Config that should already be there
grep -E '^(server|pool|makestep|rtcsync|leapsectz|bindaddress|allow)' /etc/chrony.conf /etc/chrony/chrony.conf

# Who is serving time to the fleet (on the NTP server)
chronyc clients
ss -ulpn | grep ':123'
```

Typical client lines:

```
pool 2.pool.ntp.org iburst
server ntp1.internal.example iburst
makestep 1.0 3
rtcsync
```

Serving time (internal NTP host only — do not open this to the world by accident):

```
allow 10.0.0.0/8
local stratum 10          # orphan/local only if every upstream is dead
bindcmdaddress 127.0.0.1 # chronyc must not be reachable off-box
```

`local stratum` is a last resort so clients still have *a* clock. It does not mean the time is correct.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| TLS `not yet valid` / sudden expiry | Clock far ahead or behind | `chronyc tracking`, `date -u`, cert `-dates` |
| Kerberos `Clock skew too great` | Offset > ~5 min | `chronyc tracking`; compare to KDC |
| Logs from two hosts do not line up | One slew, one free-running | `tracking` on both; NTP source |
| `chronyc sources` all `^?` | UDP/123 blocked, DNS, or wrong server | `sources -v`, firewall, `dig` the peer |
| Reach stuck at 0 after boot | No `iburst`, or firewall established-only | server line, nft/sg, `ss -ulpn` |
| Offset jumps after VM resume | Guest slept; host clock moved | `tracking`, `%st`, hypervisor time |
| Time steps every few minutes | makestep with no limit, or two disciplining daemons | `ps` for chronyd *and* ntpd/timesyncd |
| Replica “in the future” after step | Clock stepped backwards across a commit timestamp | DB logs, `tracking` history |
| Leap day-of pages | Smear vs step mismatch | source stratum, leap status in `tracking` |
| `System clock wrong` only until reboot | RTC not synced (`rtcsync` missing) | `timedatectl`, `hwclock --show` |

## Investigation Tips

- `chronyc tracking` first. “System time” offset under ~10 ms and a selected source (`^*`) means stop blaming NTP.
- Confirm only one daemon is disciplining the clock. chronyd + timesyncd + a guest agent that sets time is a fight. `timedatectl` shows which NTP client it thinks is active.
- Large offset on a VM: check steal (`vmstat` `st`) and whether the host itself is synced before you `makestep` the guest. Stepping a guest whose host is wrong just copies the bug.
- `makestep` during business hours moves “now” under running transactions. Prefer it at boot (`makestep 1.0 3`) and slew afterwards. If you must step in prod, note the old and new UTC in the ticket so log reviewers can splice the timeline.
- A stratum-10 `local` source that becomes selected means you lost upstream. Clients will agree with each other and still be wrong. Alert on stratum and on “no selectable source”.
- Cloud images often ship timesyncd. Replacing it means disable timesyncd, enable chronyd, and do not also enable the hypervisor guest agent’s time sync.
- UDP/123 outbound is enough for a client. Serving time needs inbound 123 and an `allow` line. `chronyc` protocol should stay on localhost.
- After a step, re-check TLS and Kerberos immediately. Certs and tickets that were “fine” on the wrong clock may now fail, or the reverse.

## Related Notes

- [[TLS Troubleshooting]]
- [[Certificates and PKI]]
- [[journalctl Deep Dive]]
- [[systemctl Deep Dive]]
- [[Linux Boot Process]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A fleet-wide TLS outage was a golden image whose clock started in 2015 and whose chrony unit was disabled. Certs were valid. `date -u` would have ended the call in a minute.
- I stepped a database host by 40 seconds during a replica lag incident. The lag number got worse because commit timestamps jumped. Slewing would have been boring and correct.
- Two VMs “randomly” failed Kerberos after snapshot restore. The guest chrony had `makestep 1 -1` (step forever) and the hypervisor guest agent also set the clock. One discipliner, `makestep` limited to the first updates.
