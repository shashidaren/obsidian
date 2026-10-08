# sar and sysstat

## Concept

`sysstat` is the package that records and reports machine counters over time: `sadc` samples, `sa1`/`sa2` (or `sysstat-collect.timer`) write daily files under `/var/log/sa`, and `sar` reads them. `iostat`, `mpstat`, and `pidstat` are the live cousins; `sar` is how you ask what the host looked like at 02:14 when nobody was attached.

The file is already an average over the collector interval (often 10 minutes). It will not show a 15-second spike.

## Why it matters

- The bridge starts after the symptom is gone. Live `vmstat` is calm; `sar -f` is the only local history
- CPU, run queue, memory, swap, disk, and NIC are in one binary file — no agent required
- “It was fine until the backup” is a time window. `sar -s` / `-e` answers it without a metrics stack
- A host with the package installed but the timer disabled has a blank incident record

If `sar` has no file for yesterday, you do not have a local baseline. Fix the collector before the next page.

## Mental Model

```
cron.d/sysstat  or  sysstat-collect.timer
        │
        ▼
sadc / sa1  →  /var/log/sa/saDD     (binary, local time, one day)
sa2         →  /var/log/sa/sarDD    (text summary, optional)
        │
        ▼
sar -f /var/log/sa/saDD  -s START -e END
   -u CPU    -q load/runq    -r memory    -S swap
   -b overall I/O   -d devices    -n DEV|EDEV|TCP|ETCP
   -w switches    -P ALL
```

Interval is whatever `sa1` was given (`1 1` every minute is better for incidents than the distro default of 10). `sadf` converts the same file to CSV for a ticket.

First activity line in a live `sar 1 5` is since boot, same trap as `vmstat`. Historical files do not have that boot line; they have gaps where the collector was dead.

## Key Commands

```bash
# Is collection actually running?
systemctl status sysstat sysstat-collect.timer 2>/dev/null
ls -l /var/log/sa
grep -E 'ENABLED|HISTORY|SA_DIR' /etc/default/sysstat /etc/sysconfig/sysstat 2>/dev/null

# Yesterday’s CPU and load (sa file uses day-of-month)
sar -u -f /var/log/sa/sa$(date -d yesterday +%d)
sar -q -f /var/log/sa/sa$(date -d yesterday +%d)

# Incident window (times are local to the host)
sar -u -s 02:00:00 -e 02:40:00 -f /var/log/sa/sa08
sar -q -s 02:00:00 -e 02:40:00 -f /var/log/sa/sa08
sar -r -S -s 02:00:00 -e 02:40:00 -f /var/log/sa/sa08

# Disk and NIC
sar -d -p -f /var/log/sa/sa08          # -p pretty device names
sar -n DEV,EDEV -f /var/log/sa/sa08
sar -n TCP,ETCP -f /var/log/sa/sa08    # retransmits live in ETCP

# Live sample when you are still on the box
sar -u -P ALL 1 5
sar -n DEV 1 5

# CSV for the ticket
sadf -d -s 02:00:00 -e 02:40:00 /var/log/sa/sa08 -- -u -q > /tmp/sa08.csv
```

Debian/Ubuntu: `ENABLED="true"` in `/etc/default/sysstat`, then `systemctl enable --now sysstat`. RHEL: `sysstat-collect.timer` must be enabled. History retention is `HISTORY=` (days).

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `sar` says “Cannot open /var/log/sa/saDD” | Collector never started, or day not written yet | timer/cron, `ENABLED`, disk space on `/var` |
| Flat 10-minute bars, spike “missing” | Default interval too coarse | `sa1` interval; you needed 1-minute collection |
| Numbers look impossible vs `top` | Compared boot average, or wrong day file | `-f` explicit file; ignore live line 1 |
| `%util` 100% all night, app was fine | Multi-queue device, busy-not-slow | Pair with `await` via `sar -d`; see [[iostat Deep Dive]] |
| NIC “idle” during packet loss | You read `DEV` rxkB only | `-n EDEV` (errors, drops), not just throughput |
| Retransmit mystery | Looked at TCP segments, not errors | `sar -n ETCP` (`retrans/s`) |
| After reboot, file continues | Same day-of-month file, boot counter resets inside it | `sar -b` boot field, or `sadf -j` |
| “No data” on a container host | `sar` inside the container has no sadc | Run on the host, or ship node_exporter |

## Investigation Tips

- Pin the host timezone before you quote a window. `sar` stamps are local. Grafana is often UTC. Write both in the ticket.
- Start with `-q` and `-u`. Run queue high and `%idle` high means uninterruptible sleep or steal, not “need more CPU”. Then `-d` or `-S`.
- `%steal` in `sar -u` is the VM noisy-neighbour column. Do not retune the app until that is near zero.
- Device names in old `sa` files can be `dev8-0` after a rename. `-p` helps only if sysstat can still map major:minor.
- A gap in the file is evidence: collector died, host was down, or `/var` filled. Do not interpolate across it.
- Tighten interval *after* an incident if this host is paged often (`*/1` via timer). Do not edit history files.
- `pidstat` is not in the `sa` file unless you configured process accounting. Historical per-PID needs auditd, atop, or your metrics stack — not default `sar`.

## Related Notes

- [[iostat Deep Dive]]
- [[vmstat Deep Dive]]
- [[pidstat Deep Dive]]
- [[top Deep Dive]]
- [[CPU Scheduling and Load Average]]
- [[High CPU Runbook]]
- [[Disk I/O and Latency]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A 10-minute `sa1` average hid a 90-second fsync storm that timed out the checkout path. I now treat default sysstat as a coarse alibi, not a latency tool. If the incident is sub-minute, I need the live capture or a 1-minute collector *before* the next one.
- Package “installed” on a golden image is not “enabled”. The first thing I check on a new fleet is `ls /var/log/sa` age, not `rpm -q sysstat`.
- Quoting `sar` CPU without `-q` made me add vCPU to a box that was blocked on NFS. Run queue plus `%iowait` would have sent me to storage.
