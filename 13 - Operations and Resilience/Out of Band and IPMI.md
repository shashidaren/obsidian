# Out of Band and IPMI

## Concept

Out-of-band (OOB) management reaches a host when the OS, network stack, or even the power state is broken. IPMI (and its successors iLO, iDRAC, IMM, OpenBMC) is the usual implementation: a small dedicated controller (BMC) with its own NIC, power control, virtual media, and serial console.

The BMC is a computer that can turn the main computer off.

## Why it matters

- Kernel panic, hung boot, full disk, or bad network config leave you blind on the production interface.
- Power cycling a remote host without OOB requires a data-center visit or a smart PDU you may not have.
- Virtual media lets you boot an installer or rescue image when the local disk is dead.
- Serial-over-LAN (SOL) captures early boot messages that never reach the journal.
- Compromised or exposed BMCs are a well-known lateral-movement path. Treat them as production critical systems.

If you cannot reach the BMC, you do not have a remote console. You have a hope.

## Mental Model

```
Production NICs  → OS network stack  → sshd / web / whatever
BMC NIC          → independent controller  → power, SOL, virtual KVM, virtual media

Shared-NIC mode (some boards) : BMC and host share one physical port
Dedicated NIC mode (preferred): BMC has its own port, ideally on a management VLAN
```

Common operations:

- Power status / on / off / cycle / soft / hard
- SOL session (like a serial console)
- Sensor reading (temperature, fan, power supply, voltage)
- SEL (System Event Log) — the BMC’s own log
- User management and channel authentication

The BMC stays up when the host is off. It does not need the host OS.

## Key Commands

```bash
# Local (when the OS is still alive)
ipmitool mc info
ipmitool chassis status
ipmitool chassis power status
ipmitool sensor list
ipmitool sel list
ipmitool sel elist          # event list with descriptions
ipmitool user list 1
ipmitool lan print 1

# Remote (from a jump host that can reach the BMC)
ipmitool -I lanplus -H bmc.example -U admin -P 'secret' chassis status
ipmitool -I lanplus -H bmc.example -U admin -P 'secret' chassis power cycle
ipmitool -I lanplus -H bmc.example -U admin -P 'secret' sol activate
# exit SOL with ~.  (tilde-dot) after a newline

# Prefer env or file for passwords in automation
export IPMI_PASSWORD=...
ipmitool -I lanplus -H bmc.example -U admin -E chassis power status
```

Vendor tools (iDRAC racadm, HPE iLO, Redfish) are richer. `ipmitool` is the lowest common denominator that still works on most hardware.

Redfish (HTTPS REST) is the modern replacement; many BMCs speak both.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Unable to establish IPMI v2 / RMCP+ session` | Wrong password, cipher suite, or BMC hung | lan print, reset BMC (vendor button or ipmitool mc reset cold) |
| Connection refused / timeout | BMC NIC down, wrong VLAN, firewall, or shared-NIC mode with host off | Physical link light, management VLAN, arp |
| SOL shows nothing | SOL not enabled, wrong baud, or redirected to another port | `sol info`, BIOS serial settings |
| Power cycle does nothing | BMC firmware bug or power supply failure | sensor list, SEL, physical PSU |
| Local `ipmitool` fails, remote works | ipmi_devintf / ipmi_si module missing or permission | `lsmod`, group membership (ipmi) |
| After firmware update, auth fails | Default password reset or user wiped | Vendor recovery, physical presence |
| BMC reachable from anywhere | Management network not isolated | VLAN, ACLs, no default route to production |
| `Command not supported in present state` | Host in certain power or firmware states | chassis status first |

## Investigation Tips

- Always try local `ipmitool` before declaring the BMC dead. If local works and remote does not, the problem is the management network.
- Dedicated BMC NIC on a management VLAN with no route to the internet is the sane default. Shared-NIC mode surprises people when the host is powered off.
- Record the BMC MAC and IP in the same place as the host inventory. When the host is down you cannot `ip addr` it.
- SEL fills up. `ipmitool sel clear` after you have captured it; a full SEL can stop new events on some firmware.
- BMC firmware is its own patch cycle. An unpatched BMC is a remote root equivalent.
- Virtual media + SOL is how you recover a host whose disk is unbootable without a truck roll.
- Never leave default passwords. Never put BMC credentials in the same password store as the host root without marking them privileged.
- After a power cycle via IPMI, watch the host come up (SOL or serial) before you declare success. A cycle that does not complete is still an outage.

## Related Notes

- [[High Availability]]
- [[Disaster Recovery]]
- [[Keepalived and VRRP]]
- [[Linux Boot Process]]
- [[GRUB and Kernel Parameters]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A host hung so hard that even the local console was dead. IPMI power cycle brought it back in four minutes. The alternative was a two-hour drive. OOB paid for itself that night.
- Shared-NIC BMC mode + host powered off = no remote console. We learned that only after the first real hardware failure in a remote POP.
- An exposed BMC with the default password was used as a foothold. Management networks are not “just for convenience”; they are attack surface.
