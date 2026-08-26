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

## Key Commands

```bash
# Find likely secret material on a host (use carefully, noise is high)
grep -rE '(password|secret|api[_-]?key|token)\s*[=:]' /etc /opt /home 2>/dev/null | head
find / -name '*.pem' -o -name '*id_rsa*' -o -name '*.key' 2>/dev/null | head

# Process environment can expose secrets
ps eww -p <PID> | tr ' ' '\n' | grep -iE 'pass|key|token|secret'
cat /proc/<PID>/environ | tr '\0' '\n' | grep -iE 'pass|key|token'

# File permissions on secret files
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
```

## Common Failure Modes & Symptoms

| Symptom                              | Typical cause                              | First checks                                      |
|--------------------------------------|--------------------------------------------|---------------------------------------------------|
| App fails after secret rotation      | Service not reloaded / old value cached    | Process env, config reload, app logs              |
| Secret visible in process list       | Passed as CLI arg or plain env             | `ps eww`, `/proc/<pid>/environ`                   |
| Git history contains credentials     | Committed .env / config                    | `git log -p --all -S 'password'` (and rotate)     |
| World-readable key file              | Wrong permissions or umask                 | `ls -l`, `namei -l`                               |
| Sudden auth failures after deploy    | Wrong secret version or namespace           | Vault/path version, K8s secret data, timestamps   |
| Backup or image contains secrets     | Secrets baked into artefact                | Image layers, backup contents, secret scanning    |

## Investigation Tips

- Assume any secret that has ever been in git, a ticket, or a chat is compromised; rotate it.
- Check both the secret store *and* the injection path (env, file mount, sidecar). A correct value in Vault does not help if the app still reads an old file.
- After rotation, verify the *running* process or connection, not only the file on disk.
- Prefer `LoadCredential=` / sealed secrets / runtime fetch over plain text files in `/etc`.
- For emergency access, have a break-glass procedure that is itself audited and time-limited.
- Secret scanning in CI and periodic host scans catch the easy leaks; they do not replace good design.

## Related Notes

- [[Certificates and PKI]]
- [[SSH Hardening and Troubleshooting]]
- [[PAM]]
- [[sudo]]
- [[Backup Strategy]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
