# Bash Deep Dive

## Concept

Bash is the default interactive and scripting shell on most Linux servers. It is excellent for glue: chaining commands, wrapping one-off operations, and driving tools that already exist. It is a poor place to hide complex data structures, error handling, or parsers.

Defensive Bash is a small set of habits: quote expansions, fail on unexpected errors when that is safe, and never treat untrusted text as code.

## Why it matters

- Almost every incident involves a shell at some point — live triage, a cron, a systemd `ExecStart`, or a “temporary” script that lived five years
- Quoting bugs turn filenames with spaces into extra arguments, and `$()` / eval surprises into accidental code execution
- Cron and systemd run a *different* environment than your login shell (PATH, locale, tty, umask)
- A script that “worked on my prompt” can wipe a tree when `set -e` is missing *or* when `set -e` is present and a pipeline’s last command succeeds

Treat production Bash as operational software: readable, tested on a copy of real data, and logged.

## Mental Model

```
Interactive shell  ≠  cron / systemd / ansible raw
  login:     profile + rc + aliases + functions + tty
  non-login: often only a tiny PATH and no aliases

Expansion order (simplified):
  brace  →  tilde  →  parameter/command/arithmetic
         →  word-split  →  pathname  →  quote removal

Word-splitting uses IFS (default: space, tab, newline).
Unquoted $var is how you lose arguments and invent new ones.

set -euo pipefail
  -e  exit on command failure (with many exceptions)
  -u  unset variables are errors
  -o pipefail  pipeline fails if any stage fails
These help. They do not make Bash safe by themselves.
```

Rule of thumb: if you need arrays of records, JSON, retries with backoff, or unit tests, graduate to [[Python for Sysadmins]].

## Key Commands

```bash
# Safer script header (still review every command)
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# See what the shell will actually run
set -x                         # trace
bash -n script.sh              # syntax only
bash -x script.sh              # trace a run

# Quoting that you should type by reflex
cp -- "$src" "$dst"
rm -f -- "$file"
ssh "$host" -- "systemctl status $unit"

# Arrays instead of unquoted lists
files=(/var/log/app/*.log)
printf '%s\n' "${files[@]}"

# Last pipeline status without pipefail
cmd1 | cmd2
echo "${PIPESTATUS[*]}"

# Useful parameter expansions
"${var:-default}"
"${var:?must be set}"
"${path##*/}"                  # basename
"${path%/*}"                   # dirname

# Find the shell that will run a unit / cron
systemctl cat myjob.service | sed -n '1,80p'
crontab -l
tr '\0' '\n' < /proc/$(pgrep -n myjob)/environ | sort

# Check whether a command is alias / function / binary
type -a grep
command -v python3
```

Patterns that belong in ops scripts:

```bash
# Lock so two crons do not overlap
exec 9>/run/myjob.lock
flock -n 9 || { echo "already running"; exit 0; }

# Timeout a hanging remote
timeout 30 ssh -o BatchMode=yes "$host" -- uptime

# Fail closed on empty glob (bash)
shopt -s failglob
shopt -s nullglob              # opposite: expand to nothing
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| Script works interactively, fails in cron | PATH / cwd / tty / env differ | `env -i`, log `id`, `pwd`, `echo "$PATH"` inside the job |
| “Too many arguments” or odd extra files | Unquoted expansion / glob | Quote `"$var"`; use arrays or `find -print0` |
| Pipeline “succeeded” but middle stage died | Default pipeline status is last command | `set -o pipefail` or inspect `${PIPESTATUS[@]}` |
| `set -e` skipped a failure | Contexts where `-e` is disabled (`if`, `&&`, `||`) | Explicit check, or `|| exit` |
| Destroyed unexpected paths | `rm $var` with spaces, or `cd $dir` then `rm -rf *` | `set -u`, quote, never `rm -rf` relative without `cd --` check |
| `source` / `.` changed production config | Script assumed a login profile | Use absolute paths; do not depend on aliases |
| `[[ $a == $b ]]` matched too much | Right side treated as pattern | Quote: `[[ "$a" == "$b" ]]` |
| Locale-dependent sort/compare | `LC_ALL` differs across hosts | Set `LC_ALL=C` for machine output |

## Investigation Tips

- Print the exact invocation: `ps -ww -p $pid -o args=` and the unit’s `ExecStart=`. Arguments you typed are not always arguments that ran.
- When a cleanup job “ate production”, recover the command line from shell history, auditd, or the wrapper’s log *before* re-running anything.
- Prefer `[[ ]]` over `[ ]` in Bash, and `printf` over `echo` when the data can start with `-`.
- `read -r` and `IFS=` while reading lines. Default `read` eats backslashes and splits on IFS.
- For JSON or CSV, do not invent a parser in Bash. Use `jq`, `python3 -c`, or a real program.
- systemd `Type=oneshot` scripts should exit non-zero on failure and write to stdout/stderr; `journalctl -u` is then your log.
- Test destructive scripts with `echo` in front of the dangerous command, or a `--dry-run` flag you actually implement.

## Related Notes

- [[Python for Sysadmins]]
- [[grep awk and sed]]
- [[find Deep Dive]]
- [[systemd Units]]
- [[systemd Timers]]
- [[Ansible Troubleshooting]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- Most of my “Bash is broken” incidents were environment differences: cron `PATH=/usr/bin:/bin` missing a vendor tool that my interactive shell found in `/usr/local/bin`.
- `set -euo pipefail` would have saved a bad deploy script — except the one time a pipeline was *supposed* to tolerate `grep` finding nothing. Know when to disable `-e` around a checked command.
- I no longer put `rm -rf "$dir"/*` in anything that can run with `dir` empty and `nullglob` off. `dir` empty plus unquoted glob is a classic root-filesystem near-miss.
- If the script needs more than two pages, it is cheaper to rewrite in Python than to keep adding `|| true`.
