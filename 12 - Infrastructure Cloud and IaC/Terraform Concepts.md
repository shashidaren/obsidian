# Terraform Concepts

## Concept

Terraform is a desired-state tool. You declare resources in HCL; Terraform reads remote **state**, compares it to the code, then calls provider APIs to create, update, or destroy until reality matches the plan.

The three objects that matter operationally are **code**, **state**, and **the live API**. Most Terraform incidents are a mismatch among those three, not a mysterious HCL syntax problem.

## Why it matters

- State is the map of “which real object this resource block owns”. Lose or corrupt it and apply becomes guesswork or double-create.
- A plan that looks small can still replace a database, security group, or load balancer if a force-new attribute changed.
- Locking, backend permissions, and provider credentials fail more often than the language itself.
- Drift that is not in state will be *ignored* until you refresh or import — then it shows up as a surprise destroy.
- CI that auto-applies without a human reading the plan is how production networks get rewritten at 02:00.

Treat the state backend like a production database: access control, encryption, backup, and a clear owner.

## Mental Model

```
*.tf / modules     = desired config
terraform.tfstate  = last known mapping of addresses → real IDs
provider API       = truth of the cloud *right now*

plan  = (code + state + refresh) → graph of create/update/destroy
apply = execute that graph, then write new state
```

Resource address (`aws_instance.web[0]`) is Terraform’s name. The provider ID (`i-0abc…`) is the cloud’s name. State is the join table.

Lifecycle facts to keep in your head:

- **Force-new**: changing some attributes deletes and recreates the object. Read the plan column `-/+` or `must be replaced`.
- **Refresh**: Terraform asks the API what exists. If someone deleted a VM in the console, refresh marks it for create (or errors).
- **Lock**: remote backends take a lock for the whole state. A crashed CI job holding the lock blocks everyone.
- **Workspaces / separate states**: isolation boundaries. One giant state for “the company” is an outage amplifier.

## Key Commands

```bash
# Identity of this checkout
terraform version
terraform fmt -check
terraform validate

# Providers and modules
terraform init
terraform init -upgrade          # bump provider/module constraints carefully
terraform providers

# See what would change (always from a clean init + correct workspace)
terraform workspace show
terraform workspace list
terraform plan -out=tfplan
terraform show tfplan

# Apply only what was reviewed
terraform apply tfplan

# Targeted surgery (use sparingly; hides graph side effects)
terraform plan  -target=aws_security_group.app
terraform apply -target=aws_security_group.app

# State archaeology
terraform state list
terraform state show 'aws_instance.web[0]'
terraform state pull > state-backup.json

# Move / remove without touching the API
terraform state mv aws_instance.old aws_instance.web
terraform state rm aws_instance.orphan

# Attach an existing cloud object to an address
terraform import aws_instance.web i-0abc123

# Unlock only after proving no other apply is running
terraform force-unlock <LOCK_ID>

# Destroy is irreversible at the API layer
terraform plan -destroy
```

Backend / CI checks that are not optional:

```bash
# Confirm you are talking to the intended state (account, bucket, key, workspace)
terraform init -reconfigure
env | grep -E 'AWS_|GOOGLE_|ARM_|TF_'
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| `Error acquiring the state lock` | Another apply, or a dead CI runner | Identify the holder; wait; `force-unlock` only if proven stale |
| `Resource already exists` on apply | Object created outside Terraform, or state lost then re-applied | Import or adopt; do not keep creating siblings |
| Plan wants to **replace** a stateful resource | Force-new attribute (subnet, engine version, name, AZ) | Stop. Diff the attribute. Change via blue/green if needed |
| Plan empty but console looks different | Drift never refreshed, or wrong workspace/state key | `plan` with refresh; verify backend key |
| 403 / unauthorized from provider | Wrong identity, missing IAM, org SCP, expired OIDC | Whoami at the cloud API, not `terraform version` |
| Provider checksum / “unauthenticated plugins” | Mirror, lock file, or air-gap install mismatch | Check `.terraform.lock.hcl`, `init` logs |
| Module source 404 / ref not found | Tag moved, private git creds, wrong version constraint | Pin modules; do not float `main` in prod |
| State after a partial apply | Crash mid-graph; some resources created, state half-written | `state list` vs API; import or rm; never hand-edit blindly |
| `Cycle` / dependency error | Implicit deps missing, or `depends_on` abuse | Draw the graph; add explicit references |
| Sensitive values in plan logs | Secrets in attributes, or debug logging in CI | Mark sensitive; scrub CI artifacts |

## Investigation Tips

- Print **backend, workspace, and cloud account** before reading the plan. The most expensive applies are the correct plan against the wrong state.
- Read every `-/+` and `must be replaced`. Updates are usually safe; replacements of RDS, NAT, or IAM policies are not.
- `terraform state pull` to a file and grep resource IDs when the console and code disagree. Do not “fix” by deleting live objects first.
- Partial apply after a CI kill is common. Inventory the API for the IDs in state, then decide import vs destroy leftover orphans.
- `-target` hides descendants. After a targeted fix, run a full plan before you walk away.
- Provider auth in CI should be short-lived (OIDC / instance profile). Long-lived access keys in the runner are an incident waiting for a log scrape.
- Split state by blast radius: network, data stores, and app compute should not share one lock and one `destroy`.
- Code review the **plan output**, not only the HCL diff. Reviewers who only read `.tf` miss replacements caused by computed values.

## Related Notes

- [[IaC Drift]]
- [[Identity in Cloud]]
- [[Cloud Networking]]
- [[Change Management]]
- [[Backup Strategy]]
- [[Secrets Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have watched a one-line `name` change replace a load balancer because the attribute was force-new. The plan said so; nobody scrolled that far.
- A leftover state lock from a cancelled GitHub Action blocked a Friday rollback. We now expire runners aggressively and document who may `force-unlock`.
- Importing by guess-ID created a second resource that Terraform then wanted to destroy on the next apply. Always `state show` the ID after import.
- Remote state without versioning on the bucket is a restore fantasy. Turn versioning on before the first production apply.
