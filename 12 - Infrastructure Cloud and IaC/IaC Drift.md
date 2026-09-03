# IaC Drift

## Concept

**Drift** is any difference between what the IaC repo + state *think* exists and what the platform APIs actually have. Click-ops, emergency hotfixes, other pipelines, and failed applies all create it.

Terraform (and similar tools) only manage objects that are in state. An SG rule added in the console is invisible until refresh; an object deleted in the console looks like “I need to create it again” on the next plan.

## Why it matters

- The next apply may undo a 3 a.m. hotfix you needed, or recreate something security deleted on purpose.
- Drift in IAM, routes, and security groups is a silent policy change.
- Two sources of truth (console + repo) guarantee the next incident has no reliable rollback.
- Detecting drift in CI is cheaper than discovering it when a replacement plan hits production.
- Not all drift should be “corrected to code”. Sometimes code is stale and the live change is the new desired state — that is a PR, not a blind apply.

## Mental Model

```
Desired  = git (reviewed)
Recorded = state file
Actual   = cloud / hypervisor / DNS / IdP APIs

Drift = Actual ≠ Recorded    (and often Actual ≠ Desired)
```

Three different problems get called “drift”:

1. **Out-of-band change** — human or other tool mutated the object.
2. **State hole** — object exists in the cloud but was never imported (or was `state rm`’d).
3. **Orphan in state** — state still points at an ID the API no longer has.

Reconciliation choices, in order of safety:

- Update **code** to match actual (document the emergency change).
- Apply **code** to revert actual (only if the live change was wrong).
- **Import** / `state mv` so Terraform adopts the live object.
- **Ignore** specific attributes (`lifecycle.ignore_changes`) when a managed service mutates them on purpose.

Never invent a fourth source of truth in a wiki.

## Key Commands

```bash
# Terraform: refresh + plan is the drift detector
terraform plan -refresh=true
terraform plan -detailed-exitcode   # 0 none, 1 error, 2 changes

# Inspect one address vs API
terraform state show aws_security_group.app
# then compare in console / CLI
aws ec2 describe-security-groups --group-ids sg-0123

# Adopt something born in the console
terraform import aws_security_group.app sg-0123

# Drop state linkage without deleting the API object
terraform state rm aws_security_group.temp

# Snapshot state before any surgery
terraform state pull > state-$(date +%F).json

# AWS CloudControl / config as a second opinion (where enabled)
aws configservice describe-compliance-by-config-rule

# Kubernetes analogue
kubectl diff -f deploy.yaml
helm get manifest <release> | kubectl diff -f -
```

Cheap CI pattern:

```bash
terraform plan -detailed-exitcode -out=tfplan
# exit 2 → open a drift ticket or fail the “no unexpected changes” gate
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| Plan wants to remove a rule / tag you do not remember adding | Console or other pipeline changed it | Decide: encode it or revert it |
| Plan wants to **create** an object that already exists | Not in this state (wrong workspace or never imported) | Import; do not apply create |
| Plan wants to **destroy** something still serving traffic | State ID stale, or resource was recreated out of band | Match IDs before apply |
| Every plan is noisy on one attribute | Provider default, AWS auto-tag, or ASG desired capacity | `ignore_changes` or stop fighting the control loop |
| “Hotfix in console, fix Terraform later” never happens | Process gap | Ticket with the exact `aws`/`gcloud` change + owner |
| Two repos manage the same SG / DNS zone | Dual control | Pick one owner; import; delete the other |
| Drift detector always red after autoscaling | Capacity is owned by a controller, not by static IaC | Do not put ephemeral counts in desired state |
| Apply “fixes” prod during business hours | Unreviewed drift reconciliation | Plan in PR; apply in the change window |

## Investigation Tips

- Ask “who is allowed to change this object?” before asking “how do I apply”. Ownership first, tool second.
- Compare **IDs**, not names. Cloud objects get replaced under the same name constantly.
- If drift appeared right after an incident, assume the on-call made a console change. That is not malice; capture it in git the same day.
- `ignore_changes` is a sharp tool. Use it for fields a vendor mutates (last-modified timestamps, attached ENI IDs). Do not use it to hide unmanaged firewall holes.
- Separate **detect** from **enforce**. A nightly plan that posts the diff is safer than a nightly apply that “cleans” production.
- Kubernetes and cloud IaC drift independently. A Terraform-managed node group plus a hand-edited aws-auth ConfigMap is a classic split-brain.
- Record the decision in the PR: “live wins” vs “code wins”. Future you will not remember.

## Related Notes

- [[Terraform Concepts]]
- [[Change Management]]
- [[Identity in Cloud]]
- [[Cloud Networking]]
- [[Root Cause Analysis]]
- [[Documentation and Runbooks]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The worst apply I reviewed “only fixed tags” and also reverted an emergency NACL rule that was keeping a bad deploy isolated.
- We started requiring a drift plan in the same ticket as any console hotfix. Compliance improved more than any scanning tool did.
- Autoscaling groups taught me that not every live number belongs in git. Desired count owned by two controllers is flapping, not “drift”.
- Import without `state show` afterwards is how you attach the wrong SG and destroy the right one next week.
