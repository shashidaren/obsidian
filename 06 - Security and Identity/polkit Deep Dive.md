# polkit Deep Dive

## Concept

polkit (PolicyKit) is the authorization framework that decides whether an unprivileged process may perform a privileged action. It is not sudo. systemd, udisks, NetworkManager, and many desktop and service tools ask polkit instead of (or in addition to) traditional UNIX permissions.

A rule is a JavaScript file under `/etc/polkit-1/rules.d/` (or the vendor path) that returns `YES`, `NO`, or `AUTH_ADMIN`. The subject (UID, group, session) and the action ID decide the result.

## Why it matters

- `systemctl` as a normal user, disk mounting, and many GUI tools fail or prompt because of polkit, not because of sudoers or file modes.
- A missing or overly broad rule is how a service account gains (or loses) the ability to restart units, manage networks, or mount devices.
- Logs of denials live in the journal under the `polkit` unit or as `pkexec` / action messages; they are easy to miss if you only look at sudo.
- Cloud images and minimal containers often lack a working polkit agent, so actions that expect a password prompt simply fail.

## Mental Model

```
Unprivileged process
  → D-Bus call or pkexec
    → polkitd
      → evaluates rules in lexical order (10-*.rules before 50-*.rules)
        → subject (user, group, seat, session)
        → action.id (org.freedesktop.systemd1.manage-units, etc.)
        → returns YES / NO / AUTH_ADMIN
```

`AUTH_ADMIN` means “ask for a password of an admin user.” Without a polkit agent (or in a non-interactive session) that becomes an immediate denial.

Action IDs are the real interface. `pkaction` lists them. Vendor files live under `/usr/share/polkit-1/actions/`.

## Key Commands

```bash
# What actions exist
pkaction | grep -E 'systemd|network|udisks'

# Current rules (lexical)
ls -l /etc/polkit-1/rules.d/ /usr/share/polkit-1/rules.d/

# Test a subject against an action (needs polkit)
pkcheck --action-id org.freedesktop.systemd1.manage-units --process $$ 

# Logs
journalctl -u polkit -S "1 hour ago" --no-pager
journalctl -t polkit --no-pager | tail

# List local admin groups polkit considers
getent group wheel admin sudo
```

Typical rule shape (place in `/etc/polkit-1/rules.d/10-appops.rules`):

```javascript
polkit.addRule(function(action, subject) {
  if (action.id == "org.freedesktop.systemd1.manage-units" &&
      subject.isInGroup("appops")) {
    return polkit.Result.YES;
  }
});
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| `systemctl restart foo` asks for password or fails for a service account | No matching YES rule; AUTH_ADMIN with no agent | `pkaction`, rules.d, journal for the action id |
| Works for wheel, fails for a custom group | Rule checks the wrong group name | `id` of the user; exact group string in the .rules file |
| Rule file ignored | Syntax error, wrong extension, or not readable | `ls -l`, journal on polkit start, `.rules` not `.conf` |
| Non-interactive CI/script denied | AUTH_ADMIN and no tty/agent | Force YES for that subject, or use a dedicated rule |
| `pkexec` hangs or fails | No authentication agent running | `ps aux | grep polkit`; minimal images |
| Action succeeds as root, fails as user | Expected; the call is going through polkit | Confirm the D-Bus path, not only the binary |
| After package update the behaviour changed | Vendor rule or action ID shifted | diff the action XML; re-check rules |

## Investigation Tips

- Find the exact action ID from the denial in the journal or from `pkaction`. Guessing “systemd” is not enough.
- Rules are evaluated in filename order. A later `NO` can override an earlier `YES`. Use numeric prefixes.
- `subject.isInGroup` is exact. “sudo” on Debian vs “wheel” on RHEL is a common mismatch.
- For automation prefer a narrow YES rule for the specific action over granting a full admin group.
- Containers and cloud-init images frequently ship without a polkit agent. Interactive password prompts will never appear; design the rule for non-interactive YES or NO.
- polkit is not a replacement for sudoers when the operator needs a full shell. Keep the two policies separate and review both.

## Related Notes

- [[sudo]]
- [[systemd Service Hardening]]
- [[Users Groups and Permissions]]
- [[systemd Units]]
- [[PAM]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A deployment user could restart only one unit via a carefully written polkit rule. The same user still could not `systemctl daemon-reload` because that is a different action ID. Listing the exact IDs first would have saved the second change window.
- On a minimal Ubuntu cloud image the rule returned AUTH_ADMIN. With no agent the CI job failed immediately. Changing the rule to YES for that group fixed it; adding an agent would have been the wrong fix for non-interactive use.
- A vendor package dropped a `50-` rule that denied an action we had allowed in `10-`. Lexical order matters; we now pin our overrides at `00-` or `10-` and check the full rules.d directory after every major update.
