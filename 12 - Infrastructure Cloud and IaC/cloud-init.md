# cloud-init

## Concept

cloud-init is the first-boot (and sometimes every-boot) agent on cloud and cloned images. It reads datasource metadata and user-data, then sets hostname, users, SSH keys, network, mounts, packages, and arbitrary runcmd.

It runs from systemd generators and units early in boot. If it hangs, `multi-user.target` hangs. If it "succeeds" with the wrong data, the host comes up as the wrong machine.

## Why it matters

- A clone that still has the parent SSH host keys, hostname, or instance-id is an identity incident, not a cosmetic bug
- User-data is often the only place root keys and `runcmd` live. Losing the datasource looks like "SSH never came up"
- Network config from cloud-init fights NetworkManager, netplan, and systemd-networkd. The last writer wins, usually after you thought you fixed it
- `cloud-init status --wait` in a provisioning script will block until the module that is stuck gives up. Know the timeout before you call it from automation
- Logs in `/var/log/cloud-init.log` are the boot record image factories forget to collect

## Mental Model

```
datasource (EC2, Azure, GCP, OpenStack, NoCloud, ConfigDrive, VMware)
  → instance-id + user-data + vendor-data + network-config
    → /var/lib/cloud/instance  (this boot's copy)
      → modules by stage:
         init      (locale, seed, growpart)
         config    (users, ssh, hostname, mounts, write_files)
         final     (packages, runcmd, scripts-user)
      → status: running | done | error
```

Frequency:

- **Per-instance** modules run when instance-id changes (new VM, or a deliberately re-seeded clone).
- **Per-boot** modules run every boot (`runcmd` is usually per-instance; `bootcmd` is per-boot — check the module docs before you rely on either).
- A cloned disk keeps the old instance-id. cloud-init then skips user setup and you inherit the parent's keys. `cloud-init clean` plus a new datasource is the supported reset, not deleting random files under `/etc`.

Datasource failure mode is often "wait for metadata link-local". On a network that blocks 169.254.169.254, boot waits until the datasource timeout.

## Key Commands

```bash
cloud-init status --long
cloud-init status --wait          # provisioning scripts; can block
cloud-init analyze show
cloud-init analyze blame

# What did it think it was?
cloud-id
cat /var/lib/cloud/data/instance-id
cat /var/lib/cloud/instance/datasource
ls /var/lib/cloud/instances

# Logs, in order
less /var/log/cloud-init.log
less /var/log/cloud-init-output.log
journalctl -u cloud-init -u cloud-init-local -u cloud-config -u cloud-final --no-pager

# Rendered config (no secrets in the ticket)
cloud-init query userdata
cloud-init schema --system

# After a clone, only when you mean it
cloud-init clean --logs --seed
# then reboot so the new datasource can run
```

Useful user-data shape (cloud-config, not a shell script, unless the first line is `#!`):

```yaml
#cloud-config
hostname: app-01
users:
  - name: alice
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA... alice
write_files:
  - path: /etc/motd
    content: managed by cloud-init
runcmd:
  - [ systemctl, enable, --now, myapp ]
```

The `#cloud-config` first line is required. A YAML file without it is treated as a script and fails in a way that looks like a blank boot.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Boot hangs at cloud-init | Metadata IP unreachable, or DHCP not up yet | serial console; datasource timeout; link-local route |
| SSH key from the old image | Clone did not change instance-id | `instance-id`; `cloud-init clean` on the template workflow |
| Hostname flips back after reboot | cloud-init manages hostname | `preserve_hostname`; user-data vs `/etc/hostname` |
| Static netplan overwritten | cloud-init network module every boot | `network: config: disabled` if the image should not touch NICs |
| `runcmd` did not run | Not `#cloud-config`, or module already ran for this instance-id | output log; instance-id vs previous boot |
| Package install failed, boot still "done" | `runcmd` failure is not always fatal | `cloud-init status --long`; output log exit codes |
| Wrong DNS after first boot | cloud-init wrote `resolv.conf` | symlink vs file; see [[systemd-resolved]] |
| User exists, no sudo | cloud-config sudo string, or group missing | `/etc/sudoers.d`; `id alice` |
| Secrets in user-data world-readable | metadata service or log copy | permissions on `/var/lib/cloud`; do not paste logs raw |

## Investigation Tips

- Serial console first when SSH is the thing cloud-init was supposed to enable. The output log is also on disk if you can mount the volume elsewhere.
- `cloud-init analyze blame` before you raise datasource timeouts. One slow module (package mirror) is a different fix from a blackholed metadata IP.
- Read `cloud-init-output.log` for `runcmd` and package errors. `cloud-init.log` is the framework; the output log is the payload.
- If status is `error`, the host may still be up. Treat error as "identity or config is partial", not as "retry SSH harder".
- Disabling cloud-init (`cloud-init.disabled` or `datasource_list: [ None ]`) is correct for an image that will never see a datasource. It is wrong for an image that still needs keys injected.
- Template workflow: sysprep with `cloud-init clean --logs --seed` and remove `/etc/ssh/ssh_host_*` so the next boot regenerates host keys. Cloning a running VM's disk does none of that.
- User-data is untrusted input from the perspective of the guest only after the cloud API has accepted it. Anyone who can set user-data is root on the next boot. Lock the API, not just sshd.

## Related Notes

- [[Linux Boot Process]]
- [[systemd Units]]
- [[systemctl Deep Dive]]
- [[Cloud Networking]]
- [[Virtualization Troubleshooting]]
- [[IaC Drift]]
- [[SSH Hardening and Troubleshooting]]
- [[systemd-resolved]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A golden image cloned in the lab kept the build host's SSH host keys. Clients warned on every new VM, and one automation job pinned the wrong key and failed closed. `cloud-init clean` was not in the template pipeline.
- Boot stuck for 10 minutes on `cloud-init-local` because the subnet ACL blocked the metadata address. The guest was fine; the path to 169.254.169.254 was not.
- I edited netplan by hand. The next reboot, cloud-init wrote it back from user-data. The permanent fix was user-data, or `network: {config: disabled}`, not another hand edit.
