# Cloud Networking

## Concept

Cloud networking is the same packet path you already know (interface → subnet → route → security policy → gateway), implemented as API objects: VPCs/VNets, route tables, security groups / NSGs, NACLs, peering, endpoints, and load balancers.

The trap is assuming “the VM is up” means “the packet can leave and return”. In the cloud, a healthy guest kernel can still be isolated by a route, a SG, a NACL, an NSG, a firewall appliance, or a missing return path.

## Why it matters

- Most “app down after migrate to cloud” tickets are path or policy, not CPU.
- Security groups are **stateful**; NACLs are often **stateless**. Mixing them without that model produces “outbound works, inbound fragments fail” puzzles.
- Peering and transit gateways do not automatically give you routes *or* SG allowances. You must configure both.
- Public vs private subnet is a route-table property (default route to IGW vs NAT), not a checkbox on the VM.
- Managed load balancers and PrivateLink hide extra hops. Timeouts need a hop-by-hop check, not another app restart.

## Mental Model

Walk the path in this order. Stop at the first NO.

```
1. Guest: IP, route, listening socket          (ss, ip route)
2. Hypervisor ENI / NIC: correct subnet, SG    (describe-instance)
3. Subnet route table: dest → local / peer / NAT / IGW / firewall
4. Network ACL on the subnet (stateless in AWS)
5. Peer / TGW / VPN / ExpressRoute / interconnect
6. Destination SG / NSG / firewall + listener
7. Return path — asymmetric routing is the classic outage
```

Policy objects:

- **Security group / NSG** — attached to the interface (or LB). Stateful: allow inbound 443 implies allow established reply.
- **NACL** — attached to the subnet. If stateless, you must allow ephemeral ports on the return.
- **Route table** — longest prefix wins. A more-specific RFC1918 route to a blackhole or wrong appliance wins over `0.0.0.0/0`.
- **Public IP** — destination NAT on the way in; source NAT on the way out. Packet captures inside the guest show the *private* address.

Always ask: *which identity is this packet evaluated as?* SG rules that reference another SG use membership, not CIDR.

## Key Commands

Guest (same as on-prem — do these first):

```bash
ip -br addr
ip route
ip route get 1.1.1.1
ss -tulpn
curl -v --max-time 5 https://example.com
```

AWS-shaped checks (translate names for Azure/GCP):

```bash
# Where does this instance live?
aws ec2 describe-instances --instance-ids i-0abc \
  --query 'Reservations[].Instances[].{Subnet:SubnetId,Vpc:VpcId,SGs:SecurityGroups,Priv:PrivateIpAddress,Pub:PublicIpAddress}'

# Routes for that subnet
aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0abc

# SG rules actually attached
aws ec2 describe-security-groups --group-ids sg-0abc

# NACL on the subnet
aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-0abc

# Reachability helpers when enabled
aws ec2 create-network-insights-path --source i-0abc --destination i-0def --destination-port 443 --protocol tcp
```

Azure / GCP analogues: `az network nsg rule list`, `az network vnet subnet show`, `gcloud compute networks subnets describe`, `gcloud compute firewall-rules list`.

Packet proof:

```bash
# On the guest
tcpdump -ni any host <peer> and port 443

# Flow logs / VPC logs in the cloud console when the packet never hits the guest
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| Timeout, no SYN on guest `tcpdump` | SG, NACL, route, or LB target health — packet never arrived | Walk hops from source ENI outward |
| SYN on guest, no app accept | Process not listening, or bound to localhost | [[ss Deep Dive]] |
| Outbound HTTP works, inbound fails | Missing inbound SG; or public IP / LB not attached | Check SG + target group health |
| Works from bastion in same subnet, fails from office | Path through IGW/VPN/NAT or source SG not allowed | Compare route tables and source CIDR |
| Works then dies after 30–350s | Idle timeout on LB / NAT / stateful firewall | Look at connection age, not CPU |
| Cross-VPC timeout after peering | Routes missing on **both** sides, or SG still uses old CIDR | Peer + routes + SG together |
| ICMP works, TCP does not | SG allows ICMP only; or NACL ephemeral ports | Do not debug TCP with ping alone |
| “Public subnet” VM has no inbound | No public IP, or route is still to NAT | EIP/public IP + IGW route |
| DNS name resolves to wrong IP | Private vs public zone split-horizon | Resolve from the same network as the client |
| Only IPv6 or only IPv4 fails | Dual-stack SG / route incomplete | Check both address families |

## Investigation Tips

- Start in the guest with `ip route get` and `ss -tulpn`. If the socket and the local route are wrong, cloud policy will not save you.
- Then prove whether the SYN arrives. No SYN on the guest means the problem is *outside* the OS.
- Draw the return path. NAT gateways and firewall appliances that see only one direction drop established traffic later, which looks like “random timeouts”.
- Security group “allow from sg-app” requires the **source ENI to be in that SG**. A peered VPC CIDR is not the same thing.
- Load balancer healthy-host count is a network test. 0 healthy hosts is often SG on the instance, wrong port, or health check path, not “Kubernetes is broken”.
- Flow logs answer “was the packet evaluated and what was the action?”. Enable them on the suspect ENI or subnet before the next incident if you can.
- Do not open `0.0.0.0/0` to “test”. Use a /32 of your current source, time-box it, and revert. Drift detectors should catch leftovers.
- Cloud “internet” for private subnets is a NAT gateway with a route. No NAT + no IGW = blackhole, which looks like DNS failure if you test with hostnames.

## Related Notes

- [[Routing]]
- [[Firewall and NAT]]
- [[TCP IP Troubleshooting Model]]
- [[ss Deep Dive]]
- [[ip Command Deep Dive]]
- [[Identity in Cloud]]
- [[Terraform Concepts]]
- [[IaC Drift]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I spent an hour in `tcpdump` on a VM whose subnet NACL denied ephemeral return ports. Ping had worked the whole time.
- Peering was “up” while both route tables still pointed `10.0.0.0/8` at the local IGW. Status green is not a path.
- An ALB idle timeout of 60s plus a chatty WebSocket with no pings produced customer “disconnects” we blamed on the app.
- The fastest cloud network question is still: *does the SYN reach the NIC?* Everything else is commentary until you know that.
