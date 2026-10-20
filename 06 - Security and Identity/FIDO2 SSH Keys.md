# FIDO2 SSH Keys

## Concept

FIDO2 (and U2F) security keys can hold SSH private keys that never leave the hardware. Authentication requires the key to be present and (usually) a touch or PIN. OpenSSH supports `ecdsa-sk` and `ed25519-sk` key types.

The private key is generated on the device. The host only stores a public key and a key handle.

## Why it matters

- A stolen laptop no longer yields a usable SSH private key.
- Phishing or malware that can read `~/.ssh` cannot exfiltrate a FIDO2 key.
- Hardware failure or lost key is an outage unless you have a second key or a break-glass method.
- Not every jump host, bastion, or old OpenSSH build accepts `-sk` keys. You discover this at 2 a.m.

Resident keys (discoverable credentials) can be used from any machine without a local private key file; non-resident keys still need the key handle file.

## Mental Model

```
ssh-keygen -t ed25519-sk
    → touches the FIDO2 device
    → writes id_ed25519_sk (key handle) + .pub
    → public key goes in authorized_keys as usual

Client offers the -sk key
    → sshd challenges
    → device signs (after touch/PIN)
    → session starts

Resident key: credential stored on device, usable via ssh-add -K or similar without the handle file.
```

The device is the private key. Losing it is equivalent to losing the key file, except you cannot copy it first.

## Key Commands

```bash
# Generate (will prompt for touch)
ssh-keygen -t ed25519-sk -O resident -O verify-required -C "user@host"

# Non-resident (default)
ssh-keygen -t ed25519-sk -C "user@host"

# List credentials on a resident key
ssh-keygen -K

# Add to agent (touch required on use)
ssh-add ~/.ssh/id_ed25519_sk

# Test
ssh -vvv -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_sk user@host

# Server side: confirm the key type is allowed
sshd -T | grep -E 'pubkeyacceptedalgorithms|pubkeyacceptedkeytypes'
```

`verify-required` forces a PIN in addition to presence. Useful for higher-assurance hosts.

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Permission denied (publickey) with -sk key | Server OpenSSH too old, or algorithm not accepted | `sshd -T`, client `-vvv` |
| Key works on one machine, not another | Non-resident key; handle file missing | presence of `id_ed25519_sk` |
| Touch prompt never appears | pcscd/libfido2 missing, or USB permissions | `pcsc_scan`, udev, journal |
| Agent offers key but auth fails | Agent does not support -sk, or no touch forwarded | `ssh-add -l`, `SSH_AUTH_SOCK` |
| Lost key, no access | No second factor or break-glass | authorized_keys, console, other keys |
| PIN lockout | Too many wrong PINs | device vendor tool, backup key |

## Investigation Tips

- `ssh -vvv` shows whether the client offered an `ed25519-sk` or `ecdsa-sk` key and what the server replied.
- Server must be OpenSSH 8.2+ for `-sk` keys. Older bastions need a different key type or an upgrade.
- Non-resident keys require the handle file (`id_ed25519_sk`) on every client. Resident keys can be re-downloaded with `ssh-keygen -K`.
- libfido2 and pcscd (or the equivalent) must be installed for the client to talk to the device. A missing library looks like "key not found".
- Keep a second FIDO2 key registered, or a carefully controlled break-glass key, before you remove all other authentication methods.
- `IdentitiesOnly yes` prevents the client from offering a dozen other keys and hitting MaxAuthTries before the hardware key.

## Related Notes

- [[SSH Hardening and Troubleshooting]]
- [[Certificates and PKI]]
- [[PAM]]
- [[Users Groups and Permissions]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The first time I required FIDO2, half the fleet's jump hosts were still on OpenSSH 7.x. The keys were fine; the servers rejected the algorithm. Version check is now part of the rollout.
- I generated a non-resident key, copied only the .pub, and then could not use it from the second laptop. The handle file is not optional for non-resident keys.
- A lost YubiKey with no backup meant console access and a temporary authorized_keys change. Two keys registered from day one is cheaper than that outage.
