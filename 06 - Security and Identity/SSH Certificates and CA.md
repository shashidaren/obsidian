# SSH Certificates and CA

## Concept

SSH certificates are short-lived signed public keys. A Certificate Authority (CA) signs a user or host public key with a validity window and optional principals. The server trusts the CA public key instead of a growing `authorized_keys` file; the client trusts the host CA instead of accumulating host keys in `known_hosts`.

OpenSSH has supported this since 5.6. It is not X.509. It is a simple certificate format with principals, validity, and critical options.

## Why it matters

- Key sprawl and stale `authorized_keys` entries disappear. Revocation is “the cert expired” or a KRL (Key Revocation List).
- Host key rotation no longer triggers “WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED” on every client.
- Temporary access for contractors or automation is a cert that dies at the end of the shift instead of a key that lives forever.
- A compromised CA is catastrophic; a compromised user key is bounded by the cert lifetime.

If you already run a secrets system or an identity provider, SSH certificates are the clean way to turn that into short-lived SSH access.

## Mental Model

```
User keypair (ed25519)
    → user requests cert (or automation signs it)
    → CA signs: principals, valid-from, valid-to, extensions
    → client presents cert + private key
    → sshd checks signature against TrustedUserCAKeys
    → principals match the requested user (or AuthorizedPrincipalsFile)

Host side is the mirror:
    host key signed by host CA
    clients have @cert-authority in known_hosts
```

Principals are not usernames by default. You map them. Validity is absolute time — clock skew breaks certs the same way it breaks Kerberos. See [[Time Sync and chrony]].

## Key Commands

```bash
# Create a CA (do this once, offline if possible)
ssh-keygen -t ed25519 -f user_ca -C "user-ca"
# user_ca.pub is what you distribute; user_ca is the private key

# Sign a user key (valid 8 hours, principal “alice”)
ssh-keygen -s user_ca -I alice-laptop -n alice -V +8h ~/.ssh/id_ed25519.pub

# Inspect
ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub

# Server: trust the CA
echo "TrustedUserCAKeys /etc/ssh/user_ca.pub" >> /etc/ssh/sshd_config
# optional: AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u

# Client: trust host CA (in known_hosts)
echo "@cert-authority *.example.com $(cat host_ca.pub)" >> ~/.ssh/known_hosts

# Sign a host key
ssh-keygen -s host_ca -I host.example.com -h -n host.example.com,host \
  -V +52w /etc/ssh/ssh_host_ed25519_key.pub
```

Force a cert on the client:

```
CertificateFile ~/.ssh/id_ed25519-cert.pub
IdentityFile ~/.ssh/id_ed25519
IdentitiesOnly yes
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `Certificate invalid: expired` | validity window passed or clock skew | `ssh-keygen -L`, `date -u`, [[Time Sync and chrony]] |
| `Certificate invalid: not yet valid` | clock behind or valid-from in future | same |
| `principal "alice" not authorized` | no mapping to the login user | AuthorizedPrincipalsFile or `AuthorizedPrincipalsCommand` |
| Server rejects cert, accepts raw key | TrustedUserCAKeys not loaded or wrong file | `sshd -T \| grep trusted`, restart sshd |
| Client still warns about host key | @cert-authority line missing or wrong CA | known_hosts, `ssh -vvv` |
| Cert works on one host, not another | different CA or principals file | compare `/etc/ssh/user_ca.pub` |
| Automation fails at midnight | cert lifetime crossed a day boundary | sign with enough validity or renew before expiry |

## Investigation Tips

- `ssh -vvv` shows “Offering public key … certificate” and the exact rejection reason from the server.
- On the server, `journalctl -u sshd` or auth.log will say “certificate invalid” with the reason (expired, principal, signature).
- Always check the clock on both sides before you declare the CA broken. A 10-minute skew is enough.
- Principals are case-sensitive and must match exactly what the server expects. A missing `AuthorizedPrincipalsFile` line means the cert is useless even if the signature is perfect.
- Keep the CA private key offline or in an HSM/secrets store. Signing should be a deliberate, audited step, not a script on a jump host that anyone can run.
- Test a new cert from a second session. A bad `TrustedUserCAKeys` path will lock out cert users while raw keys still work — or the reverse if you also set `PubkeyAcceptedAlgorithms`.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[Certificates and PKI]]
- [[FIDO2 SSH Keys]]
- [[Time Sync and chrony]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A contractor cert signed for 8 hours was rejected at 09:00 because the CA host was 6 minutes behind and the valid-from was “now”. Fixed the clock, re-signed, and added a note to sign with `-V -5m:+8h` so a little skew is tolerated.
- Host CA rollout: half the fleet still had the old host key in known_hosts and half trusted the CA. Clients that had both worked; clients that only had the old key warned. The @cert-authority line has to be pushed before you rotate the host key.
- I once left a user CA private key on a jump host “temporarily”. It was still there six months later. The cert lifetime limited the damage of a stolen user key, but a stolen CA key is a different incident. Treat the CA key like a root password.
