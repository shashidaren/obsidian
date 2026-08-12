---
tags:
  - bash
  - scripting
  - automation
  - beginner
topic: Bash Scripting
---

# 🐚 Bash Scripting — Basics

> Bash is the default shell on most Linux systems and the foundation of all sysadmin automation.

---

## 📌 Anatomy of a Bash Script

```bash
#!/bin/bash
# Description: What this script does
# Author: Shashi
# Date: 2025-01-15

set -euo pipefail  # Safety: exit on error, undefined vars, pipe failures

# Your code here
echo "Hello, World!"
```

### The Magic First Line — Shebang

- `#!/bin/bash` — tells the system to use bash
- Always the **first line**, no spaces before `#`

### The Safety Line — `set -euo pipefail`

- `-e` = exit if any command fails
- `-u` = error if using undefined variables
- `-o pipefail` = catch errors in pipes (`cmd1 | cmd2`)

⚠️ **Always include this in production scripts.** It prevents silent failures.

## Making a Script Executable

```
chmod +x myscript.sh
./myscript.sh
```

Or run without executable bit:

Bash

```
bash myscript.sh
```

## 📦 Variables

Bash

```
# Assignment (NO spaces around =)
name="Shashi"
count=10

# Using variables
echo "Hello, $name"
echo "Count is: ${count}"

# Command substitution
current_date=$(date +%Y-%m-%d)
disk_usage=$(df -h / | awk 'NR==2 {print $5}')

echo "Today is $current_date"
echo "Root disk usage: $disk_usage"
```

## 🔀 Conditionals

Bash

```
# Basic if
if [ "$USER" = "root" ]; then
    echo "Running as root"
else
    echo "Not root"
fi

# Check if file exists
if [ -f "/etc/passwd" ]; then
    echo "File exists"
fi

# Check if directory exists
if [ -d "/var/log" ]; then
    echo "Directory exists"
fi

# Numeric comparison
if [ "$count" -gt 5 ]; then
    echo "Count is greater than 5"
fi
```

### Common Test Operators

|Operator|Meaning|
|---|---|
|`-f file`|File exists|
|`-d dir`|Directory exists|
|`-e path`|Path exists (file or dir)|
|`-r file`|File is readable|
|`-w file`|File is writable|
|`-x file`|File is executable|
|`-z string`|String is empty|
|`-n string`|String is NOT empty|
|`-eq`|Equal (numbers)|
|`-ne`|Not equal (numbers)|
|`-gt`|Greater than|
|`-lt`|Less than|
|`=`|Equal (strings)|
|`!=`|Not equal (strings)|

## 🔁 Loops

### For Loop

Bash

```
# Loop through a list
for user in alice bob charlie; do
    echo "Processing user: $user"
done

# Loop through files
for file in /var/log/*.log; do
    echo "Found log: $file"
done

# C-style loop
for ((i=1; i<=5; i++)); do
    echo "Iteration $i"
done
```



### While Loop

Bash

```
# Read file line by line
while read -r line; do
    echo "Line: $line"
done < /etc/hostname

# Infinite loop with condition
count=0
while [ $count -lt 5 ]; do
    echo "Count: $count"
    count=$((count + 1))
done
```

## 🎯 Functions

Bash

```
# Define a function
check_service() {
    local service=$1
    if systemctl is-active --quiet "$service"; then
        echo "✅ $service is running"
    else
        echo "❌ $service is NOT running"
    fi
}

# Call the function
check_service "nginx"
check_service "sshd"
```

⚠️ **Use `local`** for variables inside functions to avoid polluting global scope.

## 📥 Arguments to Scripts

Bash

```
#!/bin/bash
# Usage: ./script.sh <username> <email>

echo "Script name: $0"
echo "First arg: $1"
echo "Second arg: $2"
echo "All args: $@"
echo "Number of args: $#"

# Validation
if [ $# -ne 2 ]; then
    echo "Usage: $0 <username> <email>"
    exit 1
fi

username=$1
email=$2
echo "Creating user $username with email $email"
```

## 🛡️ Error Handling

Bash

```
#!/bin/bash
set -euo pipefail

# Exit codes
# 0 = success, anything else = failure

if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed" >&2
    exit 1
fi

# Trap errors
cleanup() {
    echo "Cleaning up temporary files..."
    rm -f /tmp/mytemp.*
}
trap cleanup EXIT
```


## Real-World Example: Backup Script

Bash

```
#!/bin/bash
# Simple backup script
set -euo pipefail

# Configuration
SOURCE="/home/shashi/documents"
BACKUP_DIR="/backups"
DATE=$(date +%Y-%m-%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup-$DATE.tar.gz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create backup
echo "🔄 Starting backup of $SOURCE..."
tar -czf "$BACKUP_FILE" "$SOURCE"

# Verify
if [ -f "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Backup complete: $BACKUP_FILE ($SIZE)"
else
    echo "❌ Backup failed!" >&2
    exit 1
fi

# Delete backups older than 7 days
find "$BACKUP_DIR" -name "backup-*.tar.gz" -mtime +7 -delete
echo "🧹 Old backups cleaned up"
```

---
## 📚 External References

- [Bash Manual](https://www.gnu.org/software/bash/manual/)
- [ShellCheck](https://www.shellcheck.net/) — Online bash linter (USE THIS!)
- [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
- Book: _"The Linux Command Line" by William Shotts_ (free PDF online)