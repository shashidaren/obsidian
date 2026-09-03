# Identity in Cloud

## Concept

Cloud IAM decides **who** may call **which API** on **which resource**, under which conditions. Humans, CI jobs, VMs, pods, and serverless functions are all principals. Authorization is almost never the Linux user on the box; it is the cloud identity attached to the session.

If a CLI command returns `AccessDenied` / `403`, the next question is “which principal was this?” — not “is the network down?”

## Why it matters

- Static access keys in home directories, CI variables, and AMIs outlive the people who created them.
- Over-broad roles (`*:*` on `*`) turn every app CVE into a cloud-account CVE.
- Missing permissions look like product bugs: empty lists, silent skips, terraform 403 mid-apply.
- Cross-account roles, OIDC, and workload identity replace SSH keys and long-lived JSON keys — when configured correctly.
- Privilege escalation is usually “role can pass a fatter role” or “lambda can attach policies”, not a kernel exploit.

Prefer **short-lived, scoped, named identities** over shared keys.

## Mental Model

```
Principal  = who  (user, role, service account, workload identity)
Action     = API verb  (s3:GetObject, compute.instances.create)
Resource   = which object  (arn / project / subscription scope)
Condition  = extra gates  (MFA, source IP, org tag, time)
Decision   = allow or deny  (explicit deny wins)
```

How a workload gets a principal:

- **Instance / VM profile** — metadata service hands out temporary creds for an attached role.
- **Pod / GKE Workload Identity / IRSA** — projected token exchanged for a cloud role.
- **CI OIDC** — GitHub/GitLab token federated to a role; no stored key.
- **User SSO** — human assumes a role via IdP; session lasts minutes to hours.

Evaluation order to remember:

1. Explicit **deny** in any applicable policy.
2. SCP / org / management-group guardrails (can block even admins).
3. Identity policy + resource policy (S3 bucket policy, key policy) — both may be required.
4. Permission boundaries and session policies can only **narrow**, never widen.

`aws sts get-caller-identity` (or `az account show` / `gcloud auth list`) is the `whoami` of the cloud.

## Key Commands

```bash
# Who am I *right now*?
aws sts get-caller-identity
az account show
gcloud auth list
gcloud config list

# Human / CI assumed role?
echo "$AWS_ACCESS_KEY_ID"
echo "$AWS_SESSION_TOKEN" | wc -c    # empty token ⇒ long-lived key smell

# AWS: simulate before arguing about docs
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123:role/app \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::bucket/key

# What role is on this instance?
curl -s -H 'X-aws-ec2-metadata-token: '$TOKEN \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Kubernetes → cloud
kubectl get sa -n app app -o yaml
kubectl describe pod -n app <pod> | grep -i account

# Audit trail (names vary)
aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=app-role
```

Terraform / CI hygiene:

```bash
# Fail closed if the runner identity is unexpected
aws sts get-caller-identity --query Account --output text
# compare to the account the state backend lives in
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| `AccessDenied` / `403` on one API | Missing action, wrong resource ARN, or explicit deny | Decode the error’s principal + action; simulate |
| Works in console, fails in CLI | Console role ≠ CLI keys / wrong profile | `get-caller-identity` on both |
| Works on laptop, fails in CI | Different account, missing OIDC trust, or narrower role | Print identity in the pipeline |
| Terraform 403 halfway through apply | Role can create but not tag / describe / pass role | Least-privilege hole; add the specific verb |
| `AssumeRole` denied | Trust policy does not include this principal or ExternalId | Read the **role trust**, not the permission policy |
| Keys work after employee left | IAM user key never rotated / disabled | Disable user; inventory keys; move to SSO |
| Pod cannot reach S3 | IRSA annotation / federated SA missing | Check SA annotation + trust policy oidc |
| Intermittent 403 | Expired session, clock skew, or metadata hop blocked | Token age, chrony, IMDS hop limit |
| Everything denied including for admins | SCP / org policy / management group | Look one level above the account |
| “Anonymous” access succeeded | Resource policy allows `*` | Treat as incident; tighten resource policy |

## Investigation Tips

- Print the principal **before** editing policies. Half of IAM tickets are the wrong profile in `~/.aws/credentials`.
- Read the error body. AWS often names the denied action and the principal. Believe it over tribal memory of “this role can do everything”.
- Resource policies (bucket, KMS, key vault) are a second gate. Identity allow + resource deny = deny.
- Trust policies are how roles are *assumed*. Permission policies are what the role can *do*. People edit the wrong one constantly.
- IMDS from a container without restriction is credential theft. Require IMDSv2 and a hop limit of 1 on VMs that run untrusted pods.
- Scope CI roles to `terraform plan` vs `apply` separately if the blast radius is large. Plan can still leak data; apply can destroy it.
- Inventory access keys on a schedule. Any key older than your rotation policy is already an incident, just unopened.
- When debugging Kubernetes + cloud, check the **service account token** projected into the pod, not the node role. Node roles should not be what apps use.

## Related Notes

- [[Terraform Concepts]]
- [[Secrets Management]]
- [[SSH Hardening and Troubleshooting]]
- [[Certificates and PKI]]
- [[PAM]]
- [[Change Management]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “broken S3 integration” was an IRSA annotation on the wrong ServiceAccount name. The node role still had S3 access in staging, so it only failed in production.
- I have revoked the wrong access key because two humans shared an IAM user. Shared IAM users are just shared passwords with extra steps.
- SCP “Deny leave-org” and similar guardrails explain 403s that no amount of attaching `AdministratorAccess` will fix.
- `get-caller-identity` at the top of every runbook step that talks to a cloud API has saved more time than any IAM visualizer.
