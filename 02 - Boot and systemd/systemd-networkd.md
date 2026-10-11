# systemd-networkd

## Concept

systemd-networkd is the network configuration daemon that ships with systemd. It reads `.network`, `.netdev`, and `.link` files and applies addresses, routes, bonds, bridges, and VLANs. It is the default on many cloud images, CoreOS, and minimal server installs that do not want NetworkManager.

`networkctl` is the status tool. The files live in `/etc/systemd/network/` (and `/usr/lib/systemd/network/` for vendor defaults).

## Why it matters

- A host that “lost its IP after reboot” often has a `.network` file that never matched the interface name.
- networkd and NetworkManager both trying to manage the same NIC produce flapping or “unmanaged” devices.
- Bonds, VLANs, and bridges are declared in `.netdev` files and referenced from `.network` files; a missing reference leaves the virtual device down.
- `systemd-networkd-wait-online.service` can delay boot the same way NetworkManager-wait-online does.

## Mental Model

```
.link   → rename / MAC / MTU policy (udev-like)
.netdev → create virtual devices (bond, bridge, vlan, veth, …)
.network → match a device and apply config (DHCP, static, routes, DNS)

networkctl status   → what networkd thinks is happening
ip addr / ip route   → what the kernel has
```

Matching is by name, MAC, driver, or path. The first matching `.network` file wins. A catch-all `Name=*` later in the directory can steal an interface you thought was static.

## Key Commands

```bash
# Status
networkctl
networkctl status
networkctl status eth0
networkctl list

# Reload after file changes
networkctl reload
# or
systemctl restart systemd-networkd

# Logs
journalctl -u systemd-networkd -n 50 --no-pager

# Files
ls /etc/systemd/network/
ls /usr/lib/systemd/network/
```

Example static `.network`:

```
[Match]
Name=eth0

[Network]
Address=192.0.2.10/24
Gateway=192.0.2.1
DNS=1.1.1.1
```

Example DHCP:

```
[Match]
Name=en*

[Network]
DHCP=yes
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| No address after reboot | `.network` Match failed (name changed) | `networkctl status`, `ip link`, file Match |
| Device “unmanaged” or missing | NetworkManager also active, or no matching file | `networkctl`, `nmcli device status` |
| Bond/bridge exists but slaves down | `.netdev` not referenced or slaves not matched | `networkctl status bond0`, file contents |
| Boot hangs on network-online | wait-online waiting for a device that never appears | `systemctl status systemd-networkd-wait-online` |
| DNS changes ignored | networkd writing resolv.conf, or resolved | `resolvectl`, `/etc/resolv.conf` |
| Config “applied” but routes missing | Gateway in wrong section, or policy routing | `ip route`, `networkctl status` |
| Works until package update | Vendor file in `/usr/lib` overrode yours | compare `/etc` vs `/usr/lib` |

## Investigation Tips

- `networkctl status <iface>` shows the file that matched and the current state. Start there.
- After editing a file, `networkctl reload` is usually enough. A full restart is needed for some `.netdev` changes.
- If both networkd and NetworkManager are enabled, pick one. Mixed management is a reliable source of “it worked until the next boot.”
- Interface names that change (cloud, USB, udev) need a Match on MAC or a `.link` file that pins the name.
- `systemd-networkd-wait-online` can be told to ignore specific interfaces or to use a shorter timeout. A 90-second boot delay is often this unit.
- Vendor defaults in `/usr/lib/systemd/network/` are overridden by files of the same name in `/etc/systemd/network/`.

## Related Notes

- [[NetworkManager Deep Dive]]
- [[ip Command Deep Dive]]
- [[Routing]]
- [[Bonds Bridges VLANs and ethtool]]
- [[systemd Units]]
- [[cloud-init]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A cloud image switched from ens3 to eth0 after a kernel update. The `.network` file matched `ens3` only. `networkctl status` showed “no matching network file.” Adding a MAC Match fixed the fleet.
- networkd and NetworkManager were both enabled. After a link flap the address disappeared because NM took the device and had no profile. Masking NetworkManager ended the race.
- `systemd-networkd-wait-online` waited for a VLAN interface that was intentionally down. Setting `RequiredForOnline=no` on that `.network` file removed a 60-second boot delay.
