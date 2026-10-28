# NVMe Operations

## Concept

NVMe is the protocol and Linux driver stack for PCIe solid-state devices (and NVMe-over-Fabrics). Controllers appear as `/dev/nvmeX`; namespaces as `/dev/nvmeXnY`; partitions as `/dev/nvmeXnYpZ`. Management is done with the `nvme` CLI and, for health data, also `smartctl`.

## Why it matters

- Almost all current bare-metal and many cloud volumes present as NVMe. Tools and mental models from the SCSI (`sdX`) world miss counters, namespaces, and thermal behavior.
- A single controller can expose multiple namespaces. Destroying the wrong one is immediate data loss.
- Latency and temperature matter more than classic `%util` because of deep multi-queue hardware.

## Mental Model

```
PCIe endpoint
  → NVMe controller (/dev/nvme0)
      → namespace(s) (/dev/nvme0n1, /dev/nvme0n2, ...)
          → partition(s) (/dev/nvme0n1p1)
              → LVM / filesystem / raw device
```

Identity is the serial and the NVMe WWN/NGUID, not the `nvme0n1` name (which can change with PCIe bus order).

## Key Commands

```bash
# Inventory
nvme list
lsblk -o NAME,SIZE,MODEL,SERIAL,TRAN,ROTA | grep -E 'nvme|NAME'

# Health
nvme smart-log /dev/nvme0
nvme smart-log /dev/nvme0n1
smartctl -a /dev/nvme0          # also works via the nvme driver

# Errors and identity
nvme error-log /dev/nvme0
nvme id-ctrl /dev/nvme0
nvme id-ns /dev/nvme0n1

# Firmware log (read-only)
nvme fw-log /dev/nvme0

# Controller reset (disruptive)
nvme reset /dev/nvme0
# or
echo 1 > /sys/class/nvme/nvme0/reset_controller
```

Persistent device names live under `/dev/disk/by-id/nvme-*`.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Device missing after boot or hot-add | PCIe link down, missing rescan, firmware hang | `dmesg`, `lspci`, `nvme list`, PCIe rescan |
| Sudden latency increase, low `%util` | Thermal throttle, internal garbage collection, noisy neighbor | `nvme smart-log` temperature and critical warning, `iostat` await |
| I/O errors / "critical medium error" | Media errors, worn spare | `nvme error-log`, smart-log Critical Warning, available spare |
| Namespace smaller than expected | Not all capacity allocated, or thin provisioning at controller | `nvme id-ns`, controller identify |
| SMART critical warning bit set | Spare below threshold, temperature, reliability | Plan replacement; do not ignore |
| After firmware update, device gone | Bad firmware or incomplete activation | Vendor tool + OOB; avoid blind `nvme fw-download` on prod |

## Investigation Tips

- Read the Critical Warning field in `nvme smart-log` first on any storage incident involving an NVMe device. It is the drive telling you it is unhappy.
- Temperature is a first-class metric. Many enterprise NVMe drives start throttling well before they hit the absolute thermal limit.
- Identify by serial (`nvme list` or `lsblk -o SERIAL`) before any destructive command (`nvme format`, namespace delete, sanitize). Names are not stable.
- Cloud NVMe (instance store or some EBS presentations) may hide or virtualize counters. Still check guest `dmesg` and smart-log; the hypervisor metrics are the other half of the picture.
- `nvme list` + `lsblk -f` is the minimum paste for any NVMe ticket.
- Do not experiment with `nvme format` or namespace management on a system that still has data you care about. The commands are immediate.

## Related Notes

- [[Block Devices and Partitions]]
- [[SMART and Disk Health]]
- [[Disk I/O and Latency]]
- [[lsblk]]
- [[iostat Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Latency alerts on an NVMe data volume turned out to be thermal throttling at 76 °C in a dense 1U. `nvme smart-log` showed the temperature and the throttle; improving airflow removed the problem without a drive replacement.
- A namespace-delete command aimed at "the spare" hit the only namespace on a single-namespace boot drive. Recovery was a re-image. Serial number confirmation and a second person reading the command back are now mandatory for any `nvme` subcommand that can destroy data.
