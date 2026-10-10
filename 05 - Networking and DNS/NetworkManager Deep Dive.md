# NetworkManager Deep Dive

## Concept

NetworkManager (NM) is the userspace daemon that owns interface configuration on most desktop and many server distributions (RHEL, Fedora, Ubuntu desktop, some cloud images). It reads connection profiles, applies them to devices, and reacts to link events, DHCP, and dispatcher scripts.

`nmcli` / `nmtui` are the control plane. `ip` shows the result. They are not the same thing.

## Why it matters

- A change made with `ip` disappears on the next NM reconnect or reboot.
- Cloud-init, installer, and some orchestration tools write NM profiles (or keyfiles). Editing the wrong file loses the fight.
- Dispatcher scripts (`/etc/NetworkManager/dispatcher.d`) run on state changes and can race with services that expect the network to be fully up.
- Multiple connection profiles for the same device produce “it works until reboot” or “it flaps between two configs”.

If NM is active, it is the source of truth for persistent network config.

## Mental Model

```
connection profile (keyfile / ifcfg)
    → NetworkManager daemon
         → device (eth0, ens3, …)
              → addresses, routes, DNS, firewall zone

nmcli connection  → the profile (what *should* be)
nmcli device      → the live device (what *is*)
ip / resolvectl   → kernel and resolver view
```

Key states: disconnected, connecting, connected, unavailable.

`NetworkManager-wait-online.service` is what `network-online.target` waits for. A profile that never reaches “connected” delays boot.

## Key Commands

```bash
# Overview
nmcli general status
nmcli device status
nmcli connection show
nmcli connection show --active

# Detail on one device / profile
nmcli device show eth0
nmcli connection show "System eth0"
nmcli -f all connection show "System eth0"

# Bring up / down (profile, not just device)
nmcli connection up "System eth0"
nmcli connection down "System eth0"
nmcli device disconnect eth0

# Modify (persistent)
nmcli connection modify "System eth0" ipv4.method manual ipv4.addresses 192.0.2.10/24 ipv4.gateway 192.0.2.1
nmcli connection modify "System eth0" ipv4.dns "1.1.1.1 8.8.8.8"
nmcli connection up "System eth0"     # apply

# Create a new profile
nmcli connection add type ethernet ifname eth1 con-name "eth1-static" \
  ipv4.method manual ipv4.addresses 10.0.0.10/24

# Logs
journalctl -u NetworkManager -n 100 --no-pager

# Keyfiles live here (RHEL-style)
ls /etc/NetworkManager/system-connections/
```

`ipv4.method`: auto (DHCP), manual, link-local, shared, disabled.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Address present, gone after reboot | Changed with `ip` only | `nmcli connection show`, keyfile |
| Device stuck “connecting” | DHCP timeout, 802.1X, wrong profile | journal, `nmcli device show` |
| Two profiles fight over one NIC | Both set to autoconnect | `nmcli connection show`, autoconnect priority |
| Boot delayed on network-online | Profile never fully activates | `systemctl status NetworkManager-wait-online` |
| DNS changes ignored | NM overwriting resolv.conf | `nmcli`, `/etc/resolv.conf` symlink, resolvectl |
| Dispatcher script fails silently | Non-zero exit or slow script | journal, script permissions (+x) |
| Cloud instance loses metadata route | Profile missing or wrong | connection show, cloud-init logs |
| `nmcli` says unmanaged | device explicitly unmanaged or in a container | `nmcli device status`, udev, conf.d |

## Investigation Tips

- `nmcli device status` and `nmcli connection show --active` first. If the device is unmanaged, NM is not your problem (or you made it unmanaged on purpose).
- After any `nmcli connection modify`, you must `connection up` (or reboot) for it to apply. Modify alone only writes the profile.
- Compare the profile (`nmcli connection show`) with live state (`ip addr`, `ip route`). Divergence means something else (cloud-init, a script, a bond) is also touching the interface.
- `NetworkManager-wait-online` failures at boot are often a DHCP server that is slow or a profile bound to a MAC that changed.
- Dispatcher scripts must be fast and idempotent. A dispatcher that starts a heavy service will delay every network event.
- On servers that should not have NM, confirm it is masked or the device is unmanaged before you fight it. Mixed management (NM + networkd + ifupdown) is a source of races.
- Keyfiles are mode 600 and owned by root. A world-readable keyfile with a Wi-Fi password is a finding; on a server it is usually just Ethernet.

## Related Notes

- [[ip Command Deep Dive]]
- [[Routing]]
- [[DNS Resolution]]
- [[systemd-resolved]]
- [[cloud-init]]
- [[Bonds Bridges VLANs and ethtool]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- An engineer “fixed” a missing route with `ip route add`. It worked until the next DHCP renew, which NM applied from the profile that did not contain the route. The ticket came back at 02:00.
- Two connection profiles both had `autoconnect=yes` for the same interface. After a link flap the host alternated between the static management address and a DHCP address. Setting autoconnect-priority and disabling the unused profile ended it.
- `NetworkManager-wait-online` held boot for 90 seconds because the profile waited for IPv6 router advertisements that never arrived. Setting `ipv6.method ignore` (when IPv6 was not required) removed the delay.
