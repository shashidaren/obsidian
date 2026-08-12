---
tags: [bash, scripting, patterns, automation, advanced]
created: 2025-01-15
topic: Advanced Bash Patterns
---

# 🎯 Bash Scripting Patterns

> Production-grade patterns and templates for real-world sysadmin scripts.
> These are the techniques that separate hobbyist scripts from professional ones.

---

## 🏗️ The "Perfect" Script Template

Every serious script should start with this skeleton:

```bash
#!/bin/bash
#
# Script:      myscript.sh
# Description: What this script does
# Author:      Shashi
# 
# Version:     1.0
# Usage:       ./myscript.sh [options] <arguments>
#

# --- Safety settings ---
set -euo pipefail
IFS=$'\n\t'

# --- Constants ---
readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly LOG_FILE="/var/log/${SCRIPT_NAME%.sh}.log"

# --- Colors for output ---
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

# --- Functions ---
log()   { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
info()  { log "${GREEN}[INFO]${NC} $*"; }
warn()  { log "${YELLOW}[WARN]${NC} $*"; }
error() { log "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$*"; exit 1; }

# --- Main logic ---
main() {
    info "Script started"
    # Your code here
    info "Script completed successfully"
}

# --- Entry point ---
main "$@"
```

**  This script has:**

- ✅ Locking (no concurrent runs)
- ✅ Logging (to file + terminal)
- ✅ Colored output
- ✅ Slack notifications on success/failure
- ✅ Pre-flight checks
- ✅ Automatic cleanup of old backups
- ✅ Cleanup traps for interruption
- ✅ Exit codes for cron/monitoring

---

## ⚠️ Common Pitfalls to Avoid

- ❌ Not quoting variables: `rm $file` breaks with spaces → use `rm "$file"`
- ❌ Using `[ ]` instead of `[[ ]]` — the latter is safer and more powerful
- ❌ Not using `set -euo pipefail` — silent failures kill production
- ❌ Ignoring `shellcheck` warnings — always run scripts through it
- ❌ Hardcoding paths — use constants at the top
- ❌ Not logging — you can't debug what you can't see
- ❌ Using `sudo` inside scripts — require the script to be run as root instead

---

## 🛠️ Essential Tools

|Tool|Purpose|Install|
|---|---|---|
|**shellcheck**|Bash linter (find bugs)|`apt install shellcheck`|
|**shfmt**|Bash formatter|`apt install shfmt`|
|**bats**|Bash testing framework|`apt install bats`|
|**jq**|JSON parsing|`apt install jq`|
|**yq**|YAML parsing|Download from GitHub|

**Always run shellcheck:**

Bash

```
shellcheck myscript.sh
```

---

## 📚 External References

- 🌐 [ShellCheck online](https://www.shellcheck.net/)
- 🌐 [Bash Hackers Wiki](https://wiki.bash-hackers.org/)
- 📖 [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
- 📖 [Advanced Bash Scripting Guide](https://tldp.org/LDP/abs/html/)
- 📖 Book: _"Classic Shell Scripting" by Robbins & Beebe_