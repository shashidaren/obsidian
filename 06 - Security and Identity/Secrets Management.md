# Secrets Management

## Concept

Secrets management is the practice of storing, distributing, rotating, and auditing credentials (passwords, API keys, certificates, tokens, private keys) so that applications and operators can use them without embedding them in code, config files, or long-lived environment variables.

## Why it matters

- Hard-coded or file-based secrets leak through backups, git history, process lists, and core dumps
- Rotation without coordinated reload causes outages; no rotation leaves compromised credentials usable forever
- Audit requirements and breach response depend on knowing who accessed what secret and when
- Cloud and container environments make static secret files especially fragile

A secret that is never rotated and lives in a world-readable file is not a secret for long.

## Mental Model

```
Secret lifecycle:
  create → store (vault / KMS / sealed) → distribute (least privilege)
       → use (short-lived if possible) → rotate → revoke / audit

Layers:
- Storage: Vault, cloud secret managers, sealed files, HSMs
- Access control: identity + policy (who/what can read)
- Injection: env vars, files, sidecars, CSI drivers, runtime fetch
- Rotation: automated where possible; always test the reload path
```

Prefer dynamic, short-lived credentials over long-lived static ones. Prefer retrieval at runtime over baking secrets into images or config management.

Treat three classes differently:

| Class | Examples | Default handling |
|-------|----------|------------------|
| Machine identity | instance role, workload identity | Prefer cloud/K8s identity; no static key |
| Application secrets | DB password, API token | Vault / SM + rotation + reload |
| Human break-glass | root, domain admin | Offline / hardware, audited, rare |

A "secret" in a ticket or a chat log is already burned. Rotate it; do not argue about how trusted the channel felt.

## Key Commands

```bash
# Find likely secret material on a host (use carefully, noise is high)
grep -rE '(password|secret|api[_-]?key|token)\s*[=:]' /etc /opt /home 2>/dev/null | head
find / -name '*.pem' -o -name '*id_rsa*' -o -name '*.key' 2>/dev/null | head

# Process environment can expose secrets
ps eww -p <PID> | tr ' ' '\n' | grep -iE 'pass|key|token|secret'
cat /proc/<PID>/environ | tr '\0' '\n' | grep -iE 'pass|key|token'

# File permissions on secret files — including parent directories
ls -la /etc/ssl/private/ /etc/secrets/ 2>/dev/null
namei -l /path/to/secretfile

# HashiCorp Vault examples (if in use)
vault status
vault kv get secret/myapp/db
vault lease revoke <lease-id>

# systemd credentials (modern alternative to plain env files)
systemctl show myapp.service -p LoadCredential -p SetCredential
# Drop-ins under /etc/credstore/ or via LoadCredential=

# Kubernetes (when relevant)
kubectl get secrets -n <ns>
kubectl describe secret <name> -n <ns>
# Prefer external secret operators / CSI over long-lived Secret objects when possible

# After rotation: what is the *running* process actually using?
tr '\0' '\n' < /proc/<PID>/environ | grep -iE 'pass|key|token'
ls -l /proc/<PID>/fd | grep secret
```

## Common Failure Modes & Symptoms

| Symptom | Typical cause | First checks |
|---------|---------------|--------------|
| App fails after secret rotation | Service not reloaded / old value cached | Process env, config reload, app logs |
| Secret visible in process list | Passed as CLI arg or plain env | `ps eww`, `/proc/<pid>/environ` |
| Git history contains credentials | Committed .env / config | Search history; rotate; rewrite only with a plan |
| World-readable key file | Wrong permissions or umask | `ls -l`, `namei -l` |
| Sudden auth failures after deploy | Wrong secret version or namespace | Store version, K8s secret timestamps |
| Backup or image contains secrets | Secrets baked into artefact | Image layers, backup contents, scanning |
| Rotation outage every quarter | No dual-value window, no reload hook | Overlap old+new; bounce from the runbook |
| Vault up, app still stale | Sidecar / file inject not refreshed | Check the injection path, not only the store |

## Investigation Tips

- Assume any secret that has ever been in git, a ticket, or a chat is compromised; rotate it.
- Check both the secret store *and* the injection path (env, file mount, sidecar). A correct value in Vault does not help if the app still reads an old file.
- After rotation, verify the *running* process or connection, not only the file on disk.
- Prefer `LoadCredential=` / sealed secrets / runtime fetch over plain text files in `/etc`.
- For emergency access, have a break-glass procedure that is itself audited and time-limited.
- Secret scanning in CI and periodic host scans catch the easy leaks; they do not replace good design.
- Do not put secrets on the process command line. `ps` is a broadcast.
- Include secrets in DR scope *separately* from data backups, with a different identity. A backup that contains the production vault unseal keys is a single package for an attacker.
- When a leak is confirmed: rotate, revoke, inventory every consumer, then decide about history rewrite. Rotation first; archaeology second.

## Related Notes

- [[Certificates and PKI]]
- [[SSH Hardening and Troubleshooting]]
- [[PAM]]
- [[sudo]]
- [[Backup Strategy]]
- [[Disaster Recovery]]
- [[Auditing]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The password was rotated in Vault at 10:00. The app kept the old value in an env file bind-mounted from an init container that only ran on create. Half the pods were fine (recreated), half were not. Rotation is not done until every running consumer is checked.
- A deploy script passed `--db-password=$DBPASS` so it showed up in `ps` and in the audit host's process accounting. Use stdin, a file descriptor, or a vault agent. argv is public.
- We found a cloud access key in an AMI from two years ago, still valid. Image builds must pull secrets at boot or use instance roles. Anything baked in an image layer is immortal until you revoke it.
- Break-glass domain-admin password lived in the same password manager folder as the app secrets, with the same sharing list. Separate the human nuclear keys from the application vault, and log every use.
