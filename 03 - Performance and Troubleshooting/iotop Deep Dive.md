# iotop Deep Dive

## Concept

iotop shows disk I/O by process the same way top shows CPU. It reads `/proc/PID/io` and the block layer accounting. It answers “who is writing the disk right now?” when `iostat` only shows the device is busy.

## Why it matters

A saturated disk with low CPU is a common page. `iostat` tells you the device. iotop tells you the process so you can kill, throttle, or reschedule the offender instead of rebooting. Without it you guess which container or backup is responsible.

## Mental Model

```
process → write() / fsync()
    → page cache or direct I/O
    → block layer
    → device (iostat sees this)

iotop samples the delta in /proc/PID/io (read_bytes, write_bytes, cancelled_write_bytes)
and attributes it back to the PID.
```

`cancelled_write_bytes` is dirty pages that were freed before they hit disk (common with short-lived temp files). High cancelled writes often mean the workload is thrashing the page cache, not the disk itself.

## Key Commands

```bash
# Live view, sorted by total I/O, only processes with I/O
iotop -o -b -n 3 -d 2

# Accumulated I/O since process start (useful after the fact)
iotop -a -o -b -n 1

# Per-thread (find the worker inside a multi-threaded daemon)
iotop -p $(pgrep -d, postgres) -a

# One-shot for a script or ticket
iotop -b -n 1 -o -P
```

Install if missing: `dnf install iotop` / `apt install iotop`. Needs `CAP_NET_ADMIN` or root for the netlink accounting on older kernels; modern kernels allow unprivileged reads of `/proc/PID/io` for processes you own.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Disk 100 % util, no obvious process | iotop not installed or run without -o | `iotop -o`, `ps` for backup/rsync/dd |
| High write_bytes, low cancelled | Real dirty data hitting disk | `iostat -x`, application logs |
| High cancelled_write_bytes | Temp files or page cache pressure | `vmstat`, `/proc/meminfo` Dirty |
| iotop shows nothing but iostat is busy | I/O from kernel threads or a different namespace | `iotop -a`, check containers |
| Process disappears mid-sample | Short-lived process (common with cron) | `iotop -a` or auditd/execve logging |

## Investigation Tips

- Run `iotop -o` first. If the top process is a backup, log shipper, or `updatedb`, you have the answer.
- Compare `write_bytes` vs `cancelled_write_bytes`. The latter is often free to ignore.
- For containers, run iotop on the host; it sees the host PIDs. Inside the container you only see the container’s view.
- Pair with `pidstat -d` if you need a scriptable sample without the interactive UI.
- After you identify the process, check its unit (`systemctl status $(ps -o unit= -p PID)`) before you kill it.

## Related Notes

- [[iostat Deep Dive]]
- [[Disk I/O and Latency]]
- [[Performance Investigation Framework]]
- [[top Deep Dive]]
- [[lsof Deep Dive]]

## Personal Lessons Learned

- A “disk full and slow” ticket was a log shipper writing 200 MB/s of cancelled writes because the remote was down and it kept retrying temp files. iotop showed it in one sample; iostat only showed the device busy.
- I killed the wrong process once because I sorted by total instead of current I/O. Use `-o` and watch for a few seconds.
