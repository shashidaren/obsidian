# Virtualization Troubleshooting

## Concept

A virtual machine is a guest OS plus virtual hardware, scheduled on a hypervisor that shares real CPU, memory, disk, and NIC with other guests.

Symptoms inside the guest are often *host contention, storage latency, or virtual NIC/offload issues* leaking downward. Snapshots, ballooning, and live migration add failure modes that bare metal does not have.

## Why it matters

- “The app is slow” on a VM is frequently noisy-neighbor I/O or CPU steal, not the application
- Snapshots silently grow and then punish both backup windows and guest disk latency
- Live migration and host maintenance produce brief pauses that look like network blips
- Tools run *inside* the guest cannot see host p99 latency; you need hypervisor metrics too
- Cloud burst credits and oversized vCPU counts create problems that look like application regressions

Treat guest and host as two layers. Fixing the wrong layer wastes the incident.

## Mental Model

```
Application
  → Guest kernel (vCPU, ballooned RAM, virtio disk/NIC)
      → Hypervisor scheduler / I/O queue / virtual switch
          → Physical CPU, RAM, datastore, pNIC
```

Questions, in order:

1. Is the guest healthy *on its own terms* (load, iowait, network)?
2. Is the hypervisor stealing time or queueing I/O for this VM?
3. Is the datastore / volume hitting latency or snapshot overhead?
4. Did placement, migration, or a snapshot start when the symptom started?

`steal` time (`st` in `top`/`vmstat`) is the guest-visible signature of host CPU contention. High `wa` with a calm CPU is usually the datastore, not the JVM.

## Key Commands

### Inside the guest

```bash
# CPU: look at steal and iowait, not just %user
top                 # st column
vmstat 1 10         # 'st' and 'wa'
mpstat -P ALL 1 5

# Disk latency from the guest's point of view
iostat -xz 1 10

# virtio / xen / hv devices present?
lsblk -o NAME,SIZE,TYPE,TRAN,ROTA,MODEL
lspci | grep -i -E 'virtio|vmware|xen|hyperv|amazon'
dmesg -T | grep -iE 'balloon|steal|virtio|timeout|reset'

# Timekeeping (NTP fights with VM clock if mis-set)
timedatectl
chronyc tracking
```

### On the hypervisor / platform (adapt to KVM/VMware/cloud)

```bash
# KVM/libvirt examples
virsh list --all
virsh dominfo <name>
virsh vcpuinfo <name>
virsh qemu-monitor-command <name> --hmp info balloon
virsh qemu-monitor-command <name> --hmp info block

# Host view of contention
vmstat 1 5
iostat -xz 1 5
systemctl status machine.slice

# Cloud: steal, disk queue, burst credits
# AWS: CPUCreditBalance, EBSBurstBalance / volume idle time
# Same idea exists under other names on other clouds — graph credits, not only IOPS
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| High `st` (steal) in guest `top` | Host CPU overcommit / another noisy VM | Host load, vCPU count vs pCPU, placement |
| High `wa`, guest `%util` ~100, app timeouts | Datastore latency or snapshot I/O tax | Guest `iostat` await, hypervisor disk latency |
| Memory reclaimed, guest swapping | Balloon driver + host memory pressure | `free -h` vs balloon stats, host RAM |
| Sudden pause, TCP blip, clocks jump | Live migration or host stun | Hypervisor events at that timestamp |
| Disk unexpectedly full on datastore | Snapshots / delta disks left behind | Snapshot list, datastore usage vs guest `df` |
| Network throughput capped, odd latency | Virtio offload, security groups, noisy pNIC | ethtool offloads, hypervisor net metrics |
| Guest fine after reboot, degrades over days | Snapshot chain, memory leak, balloon | Snapshot age, guest memory trend |
| Clock drift, TLS/kerberos failures | VM clock vs NTP after pause | `chronyc tracking`, hypervisor time sync |
| Fast in a 30s test, dies under load | Burst-credit volume emptied | Credit metric vs sustained IOPS |

## Investigation Tips

- Always record **guest steal, iowait, and hypervisor event times** before restarting the VM. A reboot clears the evidence and often “fixes” a noisy neighbor until it comes back.
- Compare two VMs on the same host vs the same VM after a migrate. That split tells you guest vs host vs storage.
- Snapshots are not backups. A week-old snapshot can add random write penalty that no amount of guest tuning will hide.
- Burst-credit disks look fast in a 30-second test and collapse under sustained write. Graph credits, not just IOPS.
- If `iostat` await is high *and* the hypervisor reports high datastore latency, do not rebuild the application first.
- Disable or document extra time sync (guest agent + chrony + hypervisor) so only one source steps the clock.
- Capacity: vCPU count ≠ faster VM. Over-allocating vCPUs increases steal and ready time.
- Ask “when did this VM last migrate or snapshot?” before you rewrite the app config.

## Related Notes

- [[CPU Scheduling and Load Average]]
- [[vmstat Deep Dive]]
- [[iostat Deep Dive]]
- [[Disk I/O and Latency]]
- [[Capacity Planning]]
- [[Cloud Networking]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first time I saw 40% steal on a “dedicated” VM, the host was running an unthrottled batch job from another team. Guest APM was a dead end until someone opened the hypervisor CPU chart.
- A “disk full on the guest” ticket was a 2 TB snapshot left from a backup test. Guest `df` was fine; the datastore was not. Always compare both numbers.
- We doubled vCPUs on a latency-sensitive VM and made steal worse. Ready time on the host went up. Fewer vCPUs, pinned or reserved, was the actual fix.
- Clock jumps after maintenance windows broke Kerberos and TLS more often than the brief pause itself. One time source, documented.
