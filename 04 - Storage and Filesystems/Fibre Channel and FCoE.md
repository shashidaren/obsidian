# Fibre Channel and FCoE

## Concept

Fibre Channel (FC) is a dedicated storage fabric protocol. Hosts (initiators) and arrays (targets) are identified by World Wide Names (WWNs). Zoning on the fabric switches controls who can talk to whom. FCoE carries FC frames over lossless Ethernet (DCB). Linux sees FC LUNs as `/dev/sdX` (or multipath maps) exactly like iSCSI or local disks once the HBA has logged into the fabric.

## Why it matters

- A zoning change or a failed HBA port looks identical to “the disk disappeared”.
- FCoE requires Priority Flow Control and a lossless network; a misconfigured switch drops frames and the host sees SCSI errors.
- WWNs are burned into the HBA (or set in the BIOS). A replacement HBA has a new WWN and is invisible until the zone and LUN mask are updated.
- Multipath is mandatory; single-path FC is a planned outage waiting to happen.

## Mental Model

```
HBA port (WWPN)
  → fabric login (FLOGI / PLOGI)
    → zone allows initiator WWPN ↔ target WWPN
      → LUN mask on the array
        → /dev/sdX appears
          → multipath
            → LVM / filesystem

FCoE adds: CNA + DCB (PFC, ETS) on the Ethernet switches.
```

## Key Commands

```bash
# HBA and ports
lspci | grep -i fibre
systool -c fc_host -v
ls /sys/class/fc_host/

# Current logins and LUNs
cat /sys/class/fc_remote_ports/*/port_name
lsscsi
multipath -ll

# Rescan after a zoning change
echo "- - -" > /sys/class/scsi_host/hostN/scan
# or
rescan-scsi-bus.sh

# Errors
dmesg | grep -iE 'fc|fcoe|scsi'
cat /sys/class/fc_host/hostN/statistics/error_frames
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No LUNs after reboot | zone or LUN mask missing new WWPN | HBA WWPN, switch zone, array mask |
| Intermittent I/O errors | fabric congestion or failing SFP | switch port errors, HBA statistics |
| FCoE only | PFC not enabled, or pause mismatch | switch DCB config, ethtool -S |
| One path missing | HBA port down or zone single-initiator | multipath -ll, fc_host state |
| Works until HBA firmware upgrade | WWPN or driver change | new WWPN vs old zone |
| High latency, low error count | slow drain or credit starvation | fabric switch stats, not just host |

## Investigation Tips

- Record the WWPN of every HBA port before you touch zoning. `cat /sys/class/fc_host/host*/port_name`.
- After any fabric or array change, rescan and then check multipath. Do not assume the old `/dev/sdX` is still the same LUN.
- FCoE problems are usually Ethernet problems first: lossy links, missing PFC, or MTU. Treat the CNA like a storage NIC.
- See [[Device Mapper Multipath]] and [[SCSI Error Handling]]. A path failure should be invisible to the filesystem.
- Vendor tools (emulex, qlogic, broadcom) often give better port statistics than the generic sysfs entries.

## Related Notes

- [[Device Mapper Multipath]]
- [[iSCSI Operations]]
- [[SCSI Error Handling]]
- [[Block Devices and Partitions]]
- [[Disk I/O and Latency]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- We replaced an HBA during a maintenance window. The new WWPN was never added to the zone. The host booted, multipath showed zero paths, and the application refused to start. Five minutes with `cat port_name` and a zone update fixed it.
- An FCoE “random SCSI abort” turned out to be a switch port that had PFC disabled after a config rollback. The host saw timeouts; the switch saw pause-frame drops. The storage team and the network team each swore their side was clean until we looked at both.
