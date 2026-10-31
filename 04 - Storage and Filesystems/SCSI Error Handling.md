# SCSI Error Handling

## Concept

SCSI error handling is the kernel path that recovers from command failures, timeouts, and transport errors on block devices (SATA, SAS, FC, iSCSI, NVMe-oF via SCSI). The mid-layer retries, aborts, or resets the device/target/bus according to the error and the configured timeouts.

A single slow disk or path can stall the entire request queue if error recovery takes the device offline or if the timeout is longer than the application’s patience.

## Why it matters

- Default SCSI timeouts are often 30–60 s. An application that expects 2 s I/O will already have failed or timed out before the kernel finishes recovery.
- A failing path in multipath without proper `fail_if_no_path` or checker settings can black-hole I/O instead of failing over.
- Repeated aborts and bus resets show up as latency spikes long before SMART predicts failure.
- Virtual and cloud disks inherit the same mid-layer behaviour; the hypervisor timeout and the guest timeout must be aligned.

## Mental Model

```
Block layer request
  → SCSI mid-layer
       → low-level driver (sd, iscsi, lpfc, …)
       → transport

On error / timeout:
  retry (up to allowed)
  → abort task
  → device reset
  → target reset
  → bus reset
  → host reset
  → offline the device

Key knobs:
  /sys/block/sdX/device/timeout     command timeout (seconds)
  /sys/block/sdX/device/eh_timeout  error-handler timeout
  queue_depth, nr_requests
```

dmesg lines containing “SCSI error”, “abort”, “reset”, or “offline” are the primary signal.

## Key Commands

```bash
# Current timeouts and state
cat /sys/block/sda/device/timeout
cat /sys/block/sda/device/state
lsscsi -l

# Recent SCSI errors
dmesg -T | grep -iE 'scsi|abort|reset|offline|medium error'
journalctl -k -g 'SCSI|abort|reset' --since "-1h"

# Multipath path status (if used)
multipath -ll
multipathd show paths

# Per-device stats
cat /sys/block/sda/stat
iostat -x 1 5

# Change timeout (temporary; persist via udev or multipath)
echo 10 > /sys/block/sda/device/timeout
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| 30–60 s I/O stalls, then recovery | Default SCSI timeout + retry | dmesg abort/reset, `timeout` sysfs |
| Device goes offline, I/O fails | Too many errors, EH gave up | `state` file, dmesg “offline” |
| Multipath does not fail over | Path checker or no_path_retry wrong | `multipath -ll`, path state |
| Latency spikes, no SMART fail | Transport errors / CRC | dmesg, `ethtool` or FC stats |
| After SAN path flap, queue stuck | Error handler serialises recovery | eh_timeout, concurrent resets |
| Cloud disk “hangs” under load | Guest timeout > hypervisor timeout | align both sides |
| Medium error on read | Bad sector | SMART, `dd` rescue, replace disk |

## Investigation Tips

- Always capture dmesg with timestamps around the stall. The SCSI mid-layer messages name the exact recovery step.
- Lowering `timeout` makes failover faster but increases the chance of false failovers on a momentarily slow path. Test the value.
- In multipath environments the path checker and `no_path_retry` matter more than the per-device timeout once the path is marked failed.
- Medium errors are usually disk problems; transport resets are usually cable, HBA, switch, or target problems. Do not treat them the same.
- After a device is offlined, a rescan (`echo 1 > /sys/class/scsi_host/hostN/scan` or `rescan-scsi-bus.sh`) is often required before it reappears.
- Correlate with `iostat` await and `%util`. A device that is 100 % util with high await and SCSI resets is the one to isolate.

## Related Notes

- [[Disk I/O and Latency]]
- [[SMART and Disk Health]]
- [[Device Mapper Multipath]]
- [[iSCSI Operations]]
- [[I/O Schedulers and blk-mq]]
- [[NVMe Operations]]

## Personal Lessons Learned

- An iSCSI LUN with the default 30 s timeout turned a brief target pause into a 90 s application outage (timeout + retries + EH). Dropping the timeout to 10 s and fixing `no_path_retry` made the same pause invisible.
- We replaced a disk because of “SCSI errors”. The errors were bus resets caused by a flaky SAS expander. SMART was clean. Reading the full dmesg line (abort vs medium error) would have pointed at the expander first.
- After a storage controller failover the guest still showed the device offline until we rescanned the SCSI host. The multipath layer recovered; the mid-layer needed an explicit scan.
