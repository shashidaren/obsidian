---
tags: [python, automation, scripting, sysadmin, essential]
created: 2025-01-15
topic: Python for System Administration
---

# 🐍 Python for Sysadmins

> When bash gets too complex, Python takes over. It's readable, powerful, and has libraries for everything a sysadmin needs.

---

## 🎯 Why Python for Sysadmins?

- ✅ **Pre-installed** on almost every Linux distro
- ✅ **Readable** — easier to maintain than 500-line bash scripts
- ✅ **Powerful libraries** — HTTP, JSON, SSH, cloud APIs, databases
- ✅ **Cross-platform** — same script works on Linux, Mac, Windows
- ✅ **Industry standard** for DevOps, cloud, and automation
- ✅ **Better error handling** than bash

**When to use Python vs Bash:**
| Use Bash When | Use Python When |
|---------------|-----------------|
| Simple command chaining | Complex logic |
| < 50 lines | > 50 lines |
| Shell commands are primary | Data manipulation is primary |
| One-liner tasks | Need error handling |
| Piping commands | Working with APIs/JSON |

---

## 🚀 Getting Started

### Check Python Version
```
python3 --version
which python3
```

### Basic Script Template

Python

```
#!/usr/bin/env python3
"""
Script:      myscript.py
Description: What this script does
Author:      Shashi
Date:        2025-01-15
"""

import sys
import os

def main():
    print("Hello, sysadmin world!")

if __name__ == "__main__":
    main()
```

### Make it Executable

Bash

```
chmod +x myscript.py
./myscript.py
```

---

## 📦 Essential Standard Library Modules

You don't need to install these — they come with Python.

|Module|Purpose|
|---|---|
|`os`|Operating system operations|
|`sys`|System-specific parameters|
|`subprocess`|Run shell commands|
|`shutil`|High-level file operations|
|`pathlib`|Modern file path handling|
|`json`|Parse/write JSON|
|`csv`|Read/write CSV files|
|`argparse`|Command-line arguments|
|`logging`|Proper logging|
|`datetime`|Date/time handling|
|`re`|Regular expressions|
|`socket`|Network operations|
|`smtplib`|Send emails|
|`urllib`|HTTP requests (basic)|

---

## 💥 Running Shell Commands

### The Modern Way: `subprocess.run()`

Python

```
import subprocess

# Simple: run and wait
result = subprocess.run(['ls', '-la', '/tmp'], capture_output=True, text=True)
print(result.stdout)
print(f"Exit code: {result.returncode}")

# With error handling
try:
    result = subprocess.run(
        ['systemctl', 'status', 'nginx'],
        capture_output=True,
        text=True,
        check=True,  # Raises exception on non-zero exit
        timeout=10
    )
    print(result.stdout)
except subprocess.CalledProcessError as e:
    print(f"Command failed: {e.stderr}")
except subprocess.TimeoutExpired:
    print("Command timed out")

# Pipe commands (like ps aux | grep nginx)
ps = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
grep = subprocess.run(['grep', 'nginx'], input=ps.stdout, capture_output=True, text=True)
print(grep.stdout)

# Run with shell (careful with untrusted input!)
result = subprocess.run('df -h | grep /var', shell=True, capture_output=True, text=True)
```

⚠️ **Avoid `shell=True`** with user input (security risk). Prefer the list form.

---

## 📁 File & Directory Operations

### Using `pathlib` (modern, recommended)

Python

```
from pathlib import Path

# Create Path object
log_dir = Path("/var/log/myapp")

# Check existence
if log_dir.exists():
    print("Exists!")

if log_dir.is_dir():
    print("It's a directory")

# Create directory
log_dir.mkdir(parents=True, exist_ok=True)

# List files
for file in log_dir.iterdir():
    print(file.name)

# Find files by pattern
for log_file in Path("/var/log").glob("*.log"):
    print(log_file)

# Recursive search
for py_file in Path("/opt").rglob("*.py"):
    print(py_file)

# Read file
content = Path("/etc/hostname").read_text()
print(content.strip())

# Write file
Path("/tmp/test.txt").write_text("Hello!")

# File info
file = Path("/var/log/syslog")
print(f"Size: {file.stat().st_size} bytes")
print(f"Modified: {file.stat().st_mtime}")
```

### Using `os` and `shutil`

Python

```
import os
import shutil

# Environment variables
home = os.environ.get('HOME')
os.environ['MY_VAR'] = 'value'

# Current directory
print(os.getcwd())
os.chdir('/tmp')

# Copy file
shutil.copy('/etc/hostname', '/tmp/hostname.bak')

# Copy directory recursively
shutil.copytree('/etc/nginx', '/backup/nginx-backup')

# Move/rename
shutil.move('/tmp/old.txt', '/tmp/new.txt')

# Remove
os.remove('/tmp/file.txt')
shutil.rmtree('/tmp/directory')  # Recursive

# Disk usage
usage = shutil.disk_usage('/')
print(f"Free: {usage.free / (1024**3):.2f} GB")
```

---

## 📝 Reading & Writing Files

### Reading

Python

```
# Read entire file
with open('/etc/hostname', 'r') as f:
    content = f.read()

# Read line by line (memory efficient for big files)
with open('/var/log/syslog', 'r') as f:
    for line in f:
        if 'ERROR' in line:
            print(line.strip())

# Read all lines into list
with open('/etc/passwd', 'r') as f:
    lines = f.readlines()
```

### Writing

Python

```
# Write (overwrites!)
with open('/tmp/output.txt', 'w') as f:
    f.write("Hello\n")
    f.write("World\n")

# Append
with open('/var/log/myapp.log', 'a') as f:
    f.write("New log entry\n")

# Write list of lines
lines = ["line1\n", "line2\n", "line3\n"]
with open('/tmp/list.txt', 'w') as f:
    f.writelines(lines)
```

---

## 🎯 Command-Line Arguments with `argparse`

Python

```
#!/usr/bin/env python3
import argparse

def main():
    parser = argparse.ArgumentParser(
        description="Backup script for important files",
        epilog="Example: %(prog)s -s /data -d /backup --verbose"
    )
    
    parser.add_argument('-s', '--source', required=True, help='Source directory')
    parser.add_argument('-d', '--destination', required=True, help='Backup destination')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    parser.add_argument('-n', '--dry-run', action='store_true', help='Simulate only')
    parser.add_argument('--retention', type=int, default=7, help='Days to keep (default: 7)')
    parser.add_argument('files', nargs='*', help='Optional file list')
    
    args = parser.parse_args()
    
    print(f"Source: {args.source}")
    print(f"Destination: {args.destination}")
    print(f"Verbose: {args.verbose}")
    print(f"Retention: {args.retention} days")

if __name__ == "__main__":
    main()
```

**Auto-generates `--help`:**

Bash

```
./backup.py --help
./backup.py -s /data -d /backup --verbose --retention 30
```

---

## 📊 Logging (Do This Instead of `print`)

Python

```
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/myscript.log'),
        logging.StreamHandler()  # Also print to console
    ]
)

logger = logging.getLogger(__name__)

# Use it
logger.debug("Detailed debug info")
logger.info("Normal operation")
logger.warning("Something unexpected")
logger.error("An error occurred")
logger.critical("System is on fire!")

# With variables
logger.info(f"Processing {filename}")
logger.error(f"Failed to connect: {error}")
```

---

## 🌐 Making HTTP Requests

### Standard Library: `urllib`

Python

```
from urllib.request import urlopen
from urllib.error import HTTPError
import json

try:
    with urlopen('https://api.github.com/users/torvalds', timeout=10) as response:
        data = json.loads(response.read())
        print(data['name'])
except HTTPError as e:
    print(f"HTTP error: {e.code}")
```

### Better: `requests` library (pip install requests)

Python

```
import requests

# GET request
response = requests.get('https://api.example.com/status', timeout=10)
response.raise_for_status()  # Raises on 4xx/5xx
data = response.json()

# POST with JSON
payload = {"name": "server01", "status": "up"}
headers = {"Authorization": "Bearer TOKEN"}
response = requests.post(
    'https://api.example.com/register',
    json=payload,
    headers=headers,
    timeout=10
)

# Download file
r = requests.get('https://example.com/file.tar.gz', stream=True)
with open('/tmp/file.tar.gz', 'wb') as f:
    for chunk in r.iter_content(chunk_size=8192):
        f.write(chunk)
```

---

## 📧 Sending Emails

Python

```
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_email(subject, body, to_email):
    msg = MIMEMultipart()
    msg['From'] = 'alerts@example.com'
    msg['To'] = to_email
    msg['Subject'] = subject
    
    msg.attach(MIMEText(body, 'plain'))
    
    with smtplib.SMTP('smtp.example.com', 587) as server:
        server.starttls()
        server.login('user', 'password')
        server.send_message(msg)

# Usage
send_email(
    subject="🚨 Server Alert",
    body="Disk usage on server01 is 95%",
    to_email="admin@example.com"
)
```

---

## 🕐 Date & Time

Python

```
from datetime import datetime, timedelta

# Current time
now = datetime.now()
print(now)  # 2025-01-15 14:30:00

# Formatting
print(now.strftime('%Y-%m-%d %H:%M:%S'))
print(now.strftime('%A, %B %d %Y'))

# Parsing
date_str = "2025-01-15"
date_obj = datetime.strptime(date_str, '%Y-%m-%d')

# Math with dates
tomorrow = now + timedelta(days=1)
last_week = now - timedelta(weeks=1)

# For filenames
timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
backup_file = f"backup-{timestamp}.tar.gz"
```

---

## 🔍 Working with JSON

Python

```
import json

# Parse JSON string
json_str = '{"name": "server01", "cpu": 45, "memory": 78}'
data = json.loads(json_str)
print(data['name'])

# Read from file
with open('/etc/config.json', 'r') as f:
    config = json.load(f)

# Write to file
data = {"servers": ["web1", "web2"], "port": 8080}
with open('/tmp/config.json', 'w') as f:
    json.dump(data, f, indent=2)

# Pretty print
print(json.dumps(data, indent=2))
```

---

## 📊 Working with CSV

Python

```
import csv

# Read CSV
with open('/data/servers.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(f"{row['hostname']}: {row['ip']}")

# Write CSV
data = [
    {'hostname': 'web1', 'ip': '10.0.0.1', 'status': 'up'},
    {'hostname': 'web2', 'ip': '10.0.0.2', 'status': 'down'},
]

with open('/tmp/report.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['hostname', 'ip', 'status'])
    writer.writeheader()
    writer.writerows(data)
```

---

## 🔐 SSH & Remote Execution with `paramiko`

Bash

```
pip install paramiko
```

Python

```
import paramiko

def ssh_command(host, user, command, key_file='~/.ssh/id_rsa'):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(host, username=user, key_filename=key_file, timeout=10)
        stdin, stdout, stderr = client.exec_command(command)
        output = stdout.read().decode()
        error = stderr.read().decode()
        return output, error
    finally:
        client.close()

# Usage
output, error = ssh_command('web1.example.com', 'admin', 'uptime')
print(output)
```

---

## 🎯 Real-World Examples

### Example 1: Disk Usage Monitor

Python

```
#!/usr/bin/env python3
"""Alert if any partition is over 80% full."""

import shutil
import subprocess

THRESHOLD = 80

def check_disk_usage():
    result = subprocess.run(['df', '-h'], capture_output=True, text=True)
    lines = result.stdout.strip().split('\n')[1:]  # Skip header
    
    alerts = []
    for line in lines:
        parts = line.split()
        if len(parts) < 5:
            continue
        
        filesystem = parts[0]
        usage_str = parts[4].rstrip('%')
        mount = parts[5]
        
        if not usage_str.isdigit():
            continue
        
        usage = int(usage_str)
        if usage >= THRESHOLD:
            alerts.append(f"⚠️  {mount} ({filesystem}): {usage}%")
    
    return alerts

if __name__ == "__main__":
    alerts = check_disk_usage()
    if alerts:
        print("DISK USAGE ALERTS:")
        for alert in alerts:
            print(alert)
    else:
        print("✅ All partitions under threshold")
```

### Example 2: Log Analyzer

Python

```
#!/usr/bin/env python3
"""Find top 10 IPs hitting nginx access log."""

from collections import Counter
from pathlib import Path
import re

def analyze_access_log(log_file):
    ip_pattern = re.compile(r'^(\d+\.\d+\.\d+\.\d+)')
    ip_counter = Counter()
    
    with open(log_file, 'r') as f:
        for line in f:
            match = ip_pattern.match(line)
            if match:
                ip_counter[match.group(1)] += 1
    
    return ip_counter.most_common(10)

if __name__ == "__main__":
    log = "/var/log/nginx/access.log"
    top_ips = analyze_access_log(log)
    
    print(f"Top 10 IPs hitting {log}:")
    for ip, count in top_ips:
        print(f"  {ip:20s} {count} requests")
```

### Example 3: Service Health Checker

Python

```
#!/usr/bin/env python3
"""Check if services are running and alert if not."""

import subprocess
import sys
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

SERVICES = ['nginx', 'sshd', 'cron', 'systemd-journald']

def is_service_active(service):
    result = subprocess.run(
        ['systemctl', 'is-active', service],
        capture_output=True,
        text=True
    )
    return result.stdout.strip() == 'active'

def check_services():
    failed = []
    for service in SERVICES:
        if is_service_active(service):
            logger.info(f"✅ {service} is running")
        else:
            logger.error(f"❌ {service} is NOT running")
            failed.append(service)
    return failed

if __name__ == "__main__":
    failed = check_services()
    if failed:
        logger.critical(f"Failed services: {', '.join(failed)}")
        sys.exit(1)
    logger.info("All services healthy")
    sys.exit(0)
```

### Example 4: Backup Script with Rotation

Python

```
#!/usr/bin/env python3
"""Backup a directory and keep last N backups."""

import argparse
import logging
import shutil
import tarfile
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

def create_backup(source, dest_dir):
    source = Path(source)
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_file = dest_dir / f"backup-{timestamp}.tar.gz"
    
    logger.info(f"Creating backup: {backup_file}")
    with tarfile.open(backup_file, 'w:gz') as tar:
        tar.add(source, arcname=source.name)
    
    size_mb = backup_file.stat().st_size / (1024 * 1024)
    logger.info(f"✅ Backup complete: {backup_file} ({size_mb:.2f} MB)")
    return backup_file

def cleanup_old_backups(dest_dir, keep=7):
    dest_dir = Path(dest_dir)
    backups = sorted(dest_dir.glob("backup-*.tar.gz"), key=lambda x: x.stat().st_mtime)
    
    if len(backups) > keep:
        to_delete = backups[:-keep]
        for old_backup in to_delete:
            logger.info(f"🗑️  Removing old backup: {old_backup}")
            old_backup.unlink()

def main():
    parser = argparse.ArgumentParser(description="Backup with rotation")
    parser.add_argument('-s', '--source', required=True)
    parser.add_argument('-d', '--dest', required=True)
    parser.add_argument('-k', '--keep', type=int, default=7)
    args = parser.parse_args()
    
    try:
        create_backup(args.source, args.dest)
        cleanup_old_backups(args.dest, args.keep)
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        exit(1)

if __name__ == "__main__":
    main()
```

---

## 🛠️ Virtual Environments (Best Practice)

Never install packages system-wide. Use virtual environments:

Bash

```
# Create a venv
python3 -m venv ~/venvs/sysadmin

# Activate it
source ~/venvs/sysadmin/bin/activate

# Install packages
pip install requests paramiko psutil

# Freeze dependencies
pip freeze > requirements.txt

# Restore elsewhere
pip install -r requirements.txt

# Deactivate
deactivate
```

---

## 📦 Essential Third-Party Libraries

Install with `pip install <name>`:

|Library|Use Case|
|---|---|
|**requests**|HTTP requests (much better than urllib)|
|**paramiko**|SSH connections|
|**psutil**|System info (CPU, memory, processes)|
|**pyyaml**|Parse YAML files|
|**click**|Better CLI than argparse|
|**rich**|Beautiful terminal output|
|**fabric**|SSH task automation|
|**boto3**|AWS SDK|
|**kubernetes**|Kubernetes API|
|**docker**|Docker API|

### Quick psutil Example

Python

```
import psutil

# CPU
print(f"CPU: {psutil.cpu_percent(interval=1)}%")
print(f"Cores: {psutil.cpu_count()}")

# Memory
mem = psutil.virtual_memory()
print(f"Memory: {mem.percent}% used")

# Disk
disk = psutil.disk_usage('/')
print(f"Disk: {disk.percent}% used")

# Processes
for proc in psutil.process_iter(['pid', 'name', 'cpu_percent']):
    print(proc.info)

# Network
print(psutil.net_io_counters())
```

---

## ⚠️ Common Pitfalls

- ❌ Using `os.system()` — use `subprocess.run()` instead
- ❌ Using `shell=True` with user input (security risk)
- ❌ Not using `with open()` — file leaks
- ❌ Catching bare `except:` — hides bugs
- ❌ Using Python 2 (dead since 2020) — always Python 3
- ❌ Installing packages globally — use virtual environments
- ❌ Not using `pathlib` — old `os.path` is verbose
- ❌ Using `print` instead of `logging` — no timestamps, no levels
- ❌ Not adding `#!/usr/bin/env python3` shebang
- ❌ Ignoring exit codes — always `sys.exit(1)` on failure

---

## 🎯 Best Practices

1. **Always use Python 3** — never `python` (ambiguous)
2. **Use virtual environments** for every project
3. **Use `pathlib`** over `os.path`
4. **Use `logging`** over `print`
5. **Handle exceptions** properly
6. **Use type hints** for readability:
    
    Python
    
    ```
    def check_disk(mount: str, threshold: int = 80) -> bool:
        ...
    ```
    
7. **Follow PEP 8** — use `black` to auto-format:
    
    Bash
    
    ```
    pip install black
    black myscript.py
    ```
    
8. **Lint your code** with `pylint` or `flake8`
9. **Add docstrings** to functions
10. **Keep it Pythonic** — readability counts

---

## 📚 External References

- 🌐 [Python Official Docs](https://docs.python.org/3/)
- 🌐 [Real Python](https://realpython.com/) — best tutorials
- 🌐 [Python Package Index (PyPI)](https://pypi.org/)
- 📖 Book: _"Automate the Boring Stuff with Python" by Al Sweigart_ (free online!)
- 📖 Book: _"Python for DevOps" by Noah Gift_
- 📺 YouTube: _Corey Schafer's Python tutorials_

## 💡 Pro Tips

1. **Learn `argparse` inside out** — every good tool uses it
2. **Use `f-strings`** — cleaner than `.format()` or `%`:
    
    Python
    
    ```
    name = "Shashi"
    print(f"Hello, {name}!")  # Best
    ```
    
3. **List comprehensions** are Pythonic:
    
    Python
    
    ```
    # Instead of:
    result = []
    for x in items:
        if x > 5:
            result.append(x * 2)
    
    # Do:
    result = [x * 2 for x in items if x > 5]
    ```
    
4. **Use `pathlib`** — modern and cross-platform
5. **Try `rich` library** for beautiful CLI output — game changer!
6. **Read PEP 8** — the Python style guide
7. **Practice on real problems** — automate something you do manually today

text