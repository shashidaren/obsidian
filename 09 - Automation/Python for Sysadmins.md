# Python for Sysadmins

## Concept

Python is the default “bigger than Bash” language on Linux estates. Use it when the job needs structure: JSON, HTTP APIs, retries, tests, or any logic you would be ashamed to paste into a one-liner at 03:00.

For operations work, the standard library plus a few well-known tools (`subprocess`, `pathlib`, `argparse`, `json`, `urllib`) beats a pile of pip packages that will not be there on the next minimal image.

## Why it matters

- Parsers and error handling that are painful in Bash are ordinary in Python
- Cloud, Kubernetes, and backup APIs speak JSON/HTTP — shell-scraping those CLIs is how automation rots
- A script that runs under systemd or cron needs a stable interpreter, explicit exits, and logs to stdout
- Unpinned `pip install` on production hosts is a supply-chain and reproducibility problem

Write operational Python like you write runbooks: obvious control flow, no hidden network calls, fail loudly.

## Mental Model

```
Choose the language by shape of the problem:

  1-15 lines, existing CLI, files as text     → Bash
  Fields / counts on a stream                 → awk
  JSON, HTTP, inventories, retries, tests     → Python
  Multi-host desired state                    → Ansible

Runtime facts that bite:
  python vs python3          (RHEL / Debian disagree)
  system Python vs venv      (dnf/apt vs pip)
  shebang                    #!/usr/bin/env python3
  exit codes                 sys.exit(0|1|2) for systemd/cron
  buffering                  python -u  or  PYTHONUNBUFFERED=1
```

Prefer calling a well-tested CLI (`ss`, `ip`, `kubectl`) and parsing *structured* output over reimplementing the kernel in ctypes.

## Key Commands

```bash
# Which interpreter will actually run?
command -v python3
python3 -V
head -1 /usr/local/bin/my-tool

# Run unbuffered under systemd
python3 -u /usr/local/sbin/check_disks.py
# or Environment=PYTHONUNBUFFERED=1

# Syntax / compile check without executing
python3 -m py_compile /usr/local/sbin/check_disks.py

# Isolated deps when you truly need them
python3 -m venv /opt/venv-mytool
/opt/venv-mytool/bin/pip install -r requirements.txt

# JSON from the shell when you are not ready to write a file
python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'
```

Minimal patterns worth copying:

```python
#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys

def run(cmd):
    p = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return p.stdout

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        data = json.loads(run(["somecli", "--output=json"]))
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if args.json:
        json.dump(data, sys.stdout)
        sys.stdout.write("\n")
    else:
        print(data.get("status", "unknown"))
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

HTTP without extra packages:

```python
from urllib.request import urlopen, Request
req = Request("https://example.internal/health", method="GET")
with urlopen(req, timeout=5) as resp:
    body = resp.read()
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| `python: command not found` | Only `python3` is installed | Shebang `python3`; never assume `python` |
| Works in venv, dies in cron | Different interpreter or `PYTHONPATH` | Absolute path to venv binary in the unit/cron |
| “Success” in journal, no output | Buffered stdout + short-lived process | `python3 -u` / `flush=True` |
| `ModuleNotFoundError` after patching | Dep installed with `pip` into a different prefix | Use distro packages or a dedicated venv |
| SSL / proxy errors only on some hosts | Corporate MITM CA not in this interpreter’s store | Compare `ssl.get_default_verify_paths()` |
| Script hangs until timeout | Blocking `urlopen` / subprocess without timeout | Always set timeouts |
| Silent data corruption | `subprocess` + `shell=True` + unquoted input | Pass a list argv; never `shell=True` on untrusted data |

## Investigation Tips

- Log to stderr, metrics/status to stdout (or the other way around — pick one and document it). systemd captures both.
- Pin the interpreter in the unit: `ExecStart=/opt/venv-mytool/bin/python /opt/venv-mytool/bin/mytool`.
- Prefer distro packages (`python3-requests`, `python3-yaml`) on long-lived servers if you must have deps. Random `pip install` as root on the system Python will fight the next `dnf update`.
- For one-off parsing at a prompt, `python3 -c` plus `json` is safer than a 200-character `awk`.
- Timezone and locale: parse timestamps as UTC explicitly. `datetime.now()` without `timezone.utc` is how reports disagree with Grafana.
- Test the failure path. A check that only prints “ok” and never returns 2 is not a check.
- If the program must talk to AWS/GCP/k8s, use the official CLI or SDK with credentials from the environment — do not embed keys.

## Related Notes

- [[Bash Deep Dive]]
- [[grep awk and sed]]
- [[Ansible Architecture]]
- [[systemd Units]]
- [[Secrets Management]]
- [[Logging Architecture]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- The most reliable Python tools I still run are 80-line standard-library scripts with no `requirements.txt`. The ones that died were “helpful” frameworks plus an expired virtualenv.
- `shell=True` plus a hostname from an API turned a cleanup job into a metacharacter festival. List-form `subprocess.run` is non-negotiable.
- I now put `timeout=` on every network and subprocess call the first time I write it, not after the first hung cron pile-up.
- When a vendor CLI already emits JSON, wrapping it in Python is faster and more honest than re-implementing their pagination.
