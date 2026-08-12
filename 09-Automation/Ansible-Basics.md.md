---
tags: [ansible, automation, configuration-management, devops, essential]
created: 2025-01-15
topic: Ansible Configuration Management
---

# 🤖 Ansible — Basics

> Ansible is an agentless automation tool for configuration management, application deployment, and orchestration. If you manage more than 2 servers, you need Ansible.

---

## 🎯 Why Ansible?

- 🚫 **Agentless** — no software to install on managed servers (just SSH + Python)
- 📝 **Declarative** — describe the desired state, Ansible figures out how
- 🔄 **Idempotent** — run it 100 times, same result. Safe to re-run.
- 📖 **Human-readable** — YAML syntax anyone can understand
- 🆓 **Free & open source** — backed by Red Hat

**Real-world use cases:**
- Configure 50 web servers identically
- Deploy an application to production
- Patch 200 servers at once
- Onboard new employees (create users, set permissions)
- Set up a brand new server from scratch

---

## 🏗️ How Ansible Works

[Control Node] ─── SSH ───> [Managed Node 1]  
(your PC) ─── SSH ───> [Managed Node 2]  
─── SSH ───> [Managed Node 3]



1. You write **playbooks** (YAML files) on your control machine
2. Ansible connects via **SSH** to target servers
3. It pushes and executes **Python modules** on those servers
4. Reports back results

**Requirements:**
- Control node: Linux/Mac with Ansible installed
- Managed nodes: SSH access + Python installed (usually pre-installed)

⚠️ **No agent needed on managed servers.** This is Ansible's superpower.

---

## 📦 Installation

### Ubuntu/Debian
```
sudo apt update
sudo apt install ansible -y

```

### RHEL/CentOS/Fedora

Bash

```
sudo dnf install ansible -y
```

### Via pip (latest version)

Bash

```
pip install ansible
```

### Verify

Bash

```
ansible --version
```

---

## 🗂️ Key Concepts

|Concept|What It Is|
|---|---|
|**Inventory**|List of servers to manage|
|**Playbook**|YAML file describing tasks to run|
|**Task**|A single action (install package, copy file, etc.)|
|**Module**|Pre-built tool (e.g., `apt`, `copy`, `service`)|
|**Role**|Reusable bundle of tasks, files, and vars|
|**Handler**|Task triggered by another task (e.g., restart service after config change)|
|**Variable**|Reusable value (like $var in bash)|
|**Facts**|Auto-gathered info about a server (OS, IP, memory, etc.)|

---

## 📋 The Inventory File

Lists all your servers. Default location: `/etc/ansible/hosts`

### Simple Inventory (INI format)

ini

```
# /etc/ansible/hosts or ./inventory.ini

[webservers]
web1.example.com
web2.example.com
192.168.1.10

[dbservers]
db1.example.com
db2.example.com

[production:children]
webservers
dbservers
```

### YAML Inventory

YAML

```
# inventory.yml
all:
  children:
    webservers:
      hosts:
        web1.example.com:
        web2.example.com:
    dbservers:
      hosts:
        db1.example.com:
          ansible_user: dbadmin
          ansible_port: 2222
```

### With Variables

ini

```
[webservers]
web1.example.com ansible_user=ubuntu ansible_port=22
web2.example.com ansible_user=root

[webservers:vars]
http_port=80
max_clients=200
```

---

## ⚡ Ad-Hoc Commands (Quick Wins)

Run one-off commands without writing a playbook:

### Basic Syntax

Bash

```
ansible <target> -m <module> -a "<arguments>"
```

### Common Examples

Bash

```
# Ping all servers (test connectivity)
ansible all -m ping

# Run a shell command
ansible webservers -m shell -a "uptime"

# Check disk space
ansible all -m shell -a "df -h"

# Install a package (needs sudo)
ansible webservers -m apt -a "name=nginx state=present" --become

# Copy a file
ansible webservers -m copy -a "src=./index.html dest=/var/www/html/"

# Restart a service
ansible webservers -m service -a "name=nginx state=restarted" --become

# Check who's logged in
ansible all -m command -a "who"

# Get system info (facts)
ansible web1 -m setup
```

**Common flags:**

- `-i inventory.ini` — specify inventory file
- `-u username` — SSH as user
- `-k` — ask for SSH password
- `-K` — ask for sudo password
- `--become` or `-b` — run as sudo
- `-v`, `-vv`, `-vvv` — verbose output

---

## 📝 Your First Playbook

Playbooks are YAML files that describe what to do.

### Example 1: Install and Start Nginx

YAML

```
# nginx-setup.yml
---
- name: Install and configure nginx
  hosts: webservers
  become: yes  # run tasks as root
  
  tasks:
    - name: Install nginx
      apt:
        name: nginx
        state: present
        update_cache: yes
    
    - name: Start and enable nginx
      service:
        name: nginx
        state: started
        enabled: yes
    
    - name: Copy custom index page
      copy:
        src: ./files/index.html
        dest: /var/www/html/index.html
        owner: www-data
        group: www-data
        mode: '0644'
```

### Run it:

Bash

```
ansible-playbook -i inventory.ini nginx-setup.yml
```

### Dry run (test without changes):

Bash

```
ansible-playbook -i inventory.ini nginx-setup.yml --check
```

---

## 🧩 Anatomy of a Playbook

YAML

```
---                              # YAML file starts with ---
- name: Play name (description)  # Human-readable
  hosts: webservers              # Which servers?
  become: yes                    # Run as sudo
  gather_facts: yes              # Auto-collect server info (default: yes)
  
  vars:                          # Variables for this play
    package_name: nginx
    port: 80
  
  tasks:                         # Actions to perform
    - name: Install package      # Task description
      apt:                       # Module name
        name: "{{ package_name }}"  # Using variable
        state: present
    
    - name: Ensure service running
      service:
        name: "{{ package_name }}"
        state: started
      notify: Restart nginx      # Trigger a handler
  
  handlers:                      # Run only when notified
    - name: Restart nginx
      service:
        name: nginx
        state: restarted
```

---

## 🔧 Most Common Modules

### Package Management

YAML

```
# Debian/Ubuntu
- name: Install package
  apt:
    name: nginx
    state: present    # present, absent, latest
    update_cache: yes

# RHEL/CentOS
- name: Install package
  dnf:
    name: httpd
    state: latest

# Generic (auto-detects)
- name: Install package
  package:
    name: git
    state: present
```

### File Operations

YAML

```
# Copy file from control node to server
- name: Copy config file
  copy:
    src: files/nginx.conf
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: '0644'
    backup: yes  # Backup existing file

# Create directory
- name: Create directory
  file:
    path: /opt/myapp
    state: directory
    owner: myuser
    mode: '0755'

# Delete file
- name: Remove old config
  file:
    path: /etc/nginx/old.conf
    state: absent

# Create symlink
- name: Create symlink
  file:
    src: /opt/myapp/current
    dest: /opt/myapp/link
    state: link
```

### Templates (Files with Variables)

YAML

```
- name: Deploy config from template
  template:
    src: templates/nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    mode: '0644'
  notify: Restart nginx
```

Template file `nginx.conf.j2`:

jinja

```
server {
    listen {{ port }};
    server_name {{ inventory_hostname }};
    root /var/www/{{ app_name }};
}
```

### Services

YAML

```
- name: Start and enable service
  service:
    name: nginx
    state: started      # started, stopped, restarted, reloaded
    enabled: yes        # start at boot
```

### Users

YAML

```
- name: Create user
  user:
    name: shashi
    groups: sudo,docker
    shell: /bin/bash
    state: present
    password: "{{ 'mypassword' | password_hash('sha512') }}"

- name: Add SSH key
  authorized_key:
    user: shashi
    state: present
    key: "{{ lookup('file', '~/.ssh/id_rsa.pub') }}"
```

### Command Execution

YAML

```
# Run a command (NOT idempotent!)
- name: Run a script
  command: /opt/scripts/setup.sh
  
# Run in shell (with pipes, variables, etc.)
- name: Check something
  shell: ps aux | grep nginx | wc -l
  register: nginx_count

# Only run if condition
- name: Do something conditionally
  shell: echo "hello"
  when: ansible_os_family == "Debian"
```

### Git

YAML

```
- name: Clone repository
  git:
    repo: https://github.com/user/repo.git
    dest: /opt/myapp
    version: main
```

### Cron

YAML

```
- name: Add cron job
  cron:
    name: "Daily backup"
    minute: "0"
    hour: "2"
    job: "/usr/local/bin/backup.sh"
    user: root
```

---

## 🎯 Variables

### Define in Playbook

YAML

```
vars:
  app_name: myapp
  app_port: 8080
  packages:
    - nginx
    - git
    - vim
```

### Use in Tasks

YAML

```
- name: Install packages
  apt:
    name: "{{ packages }}"
    state: present

- name: Print info
  debug:
    msg: "App {{ app_name }} runs on port {{ app_port }}"
```

### External Variables File

YAML

```
# vars/main.yml
app_name: myapp
app_port: 8080
db_host: db.example.com
```

YAML

```
# playbook.yml
- hosts: webservers
  vars_files:
    - vars/main.yml
  tasks:
    - debug: msg="{{ app_name }}"
```

### Command Line Variables

Bash

```
ansible-playbook playbook.yml -e "app_name=newname app_port=9090"
```

### Ansible Facts (Auto-Collected)

YAML

```
- name: Show OS info
  debug:
    msg: "Running on {{ ansible_distribution }} {{ ansible_distribution_version }}"

# Common facts:
# ansible_hostname
# ansible_os_family (Debian, RedHat)
# ansible_distribution (Ubuntu, CentOS)
# ansible_memtotal_mb
# ansible_processor_cores
# ansible_default_ipv4.address
```

---

## 🔀 Conditionals (`when`)

YAML

```
- name: Install apache on Debian
  apt:
    name: apache2
    state: present
  when: ansible_os_family == "Debian"

- name: Install apache on RHEL
  dnf:
    name: httpd
    state: present
  when: ansible_os_family == "RedHat"

- name: Only run on production
  shell: /opt/deploy.sh
  when: 
    - inventory_hostname in groups['production']
    - ansible_memtotal_mb > 2000
```

---

## 🔁 Loops

YAML

```
# Simple loop
- name: Install multiple packages
  apt:
    name: "{{ item }}"
    state: present
  loop:
    - nginx
    - git
    - vim
    - htop

# Loop with dictionaries
- name: Create multiple users
  user:
    name: "{{ item.name }}"
    groups: "{{ item.group }}"
  loop:
    - { name: 'alice', group: 'admin' }
    - { name: 'bob', group: 'developers' }
    - { name: 'carol', group: 'developers' }
```

---

## 🎬 Handlers

Handlers run **only if triggered** by `notify`, and **only once** at the end of the play.

YAML

```
tasks:
  - name: Copy nginx config
    copy:
      src: nginx.conf
      dest: /etc/nginx/nginx.conf
    notify: Restart nginx     # Trigger handler
  
  - name: Copy SSL cert
    copy:
      src: cert.pem
      dest: /etc/nginx/ssl/
    notify: Restart nginx     # Same handler, still only runs once

handlers:
  - name: Restart nginx
    service:
      name: nginx
      state: restarted
```

**Why handlers?** If you change 5 nginx files, you want to restart nginx **once**, not 5 times.

---

## 🎨 Templates (Jinja2)

Templates let you create dynamic config files.

### Template File: `templates/nginx.conf.j2`

jinja

```
# Managed by Ansible - do not edit manually!
worker_processes {{ ansible_processor_cores }};

server {
    listen {{ http_port | default(80) }};
    server_name {{ inventory_hostname }};
    
    {% if ssl_enabled %}
    listen 443 ssl;
    ssl_certificate /etc/ssl/{{ inventory_hostname }}.crt;
    {% endif %}
    
    {% for domain in extra_domains %}
    server_alias {{ domain }};
    {% endfor %}
}
```

### Playbook Task

YAML

```
- name: Deploy nginx config
  template:
    src: templates/nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  vars:
    http_port: 8080
    ssl_enabled: true
    extra_domains:
      - www.example.com
      - api.example.com
  notify: Restart nginx
```

---

## 🗂️ Ansible Roles (Reusable Bundles)

Once your playbooks grow, organize them into **roles**.

### Standard Role Structure

text

```
roles/
└── nginx/
    ├── tasks/
    │   └── main.yml       # Main tasks
    ├── handlers/
    │   └── main.yml       # Handlers
    ├── templates/
    │   └── nginx.conf.j2  # Jinja2 templates
    ├── files/
    │   └── index.html     # Static files
    ├── vars/
    │   └── main.yml       # Role variables
    ├── defaults/
    │   └── main.yml       # Default variables (lowest priority)
    └── meta/
        └── main.yml       # Role dependencies
```

### Create Role Skeleton

Bash

```
ansible-galaxy init roles/nginx
```

### Use Role in Playbook

YAML

```
- hosts: webservers
  become: yes
  roles:
    - nginx
    - firewall
    - monitoring
```

---

## 🔐 Ansible Vault (Encrypting Secrets)

Never put passwords in plaintext! Use vault.

### Create Encrypted File

Bash

```
ansible-vault create secrets.yml
# Opens editor, save with secrets
```

### Edit Encrypted File

Bash

```
ansible-vault edit secrets.yml
```

### Encrypt Existing File

Bash

```
ansible-vault encrypt vars/passwords.yml
```

### Decrypt

Bash

```
ansible-vault decrypt secrets.yml
```

### Run Playbook with Vault

Bash

```
# Prompt for password
ansible-playbook playbook.yml --ask-vault-pass

# Password from file
ansible-playbook playbook.yml --vault-password-file ~/.vault_pass
```

---

## 🚀 Complete Real-World Example

**Deploy a simple web app on Ubuntu:**

YAML

```
# webapp-deploy.yml
---
- name: Deploy web application
  hosts: webservers
  become: yes
  vars:
    app_name: mywebapp
    app_user: webapp
    app_port: 8080
    repo_url: https://github.com/example/webapp.git
    packages:
      - nginx
      - git
      - python3-pip
  
  tasks:
    - name: Update apt cache
      apt:
        update_cache: yes
        cache_valid_time: 3600
    
    - name: Install required packages
      apt:
        name: "{{ packages }}"
        state: present
    
    - name: Create application user
      user:
        name: "{{ app_user }}"
        shell: /bin/bash
        state: present
    
    - name: Create app directory
      file:
        path: "/opt/{{ app_name }}"
        state: directory
        owner: "{{ app_user }}"
        mode: '0755'
    
    - name: Clone application repo
      git:
        repo: "{{ repo_url }}"
        dest: "/opt/{{ app_name }}"
        version: main
      become_user: "{{ app_user }}"
      notify: Restart app
    
    - name: Install Python dependencies
      pip:
        requirements: "/opt/{{ app_name }}/requirements.txt"
    
    - name: Deploy nginx config
      template:
        src: templates/nginx-app.conf.j2
        dest: "/etc/nginx/sites-available/{{ app_name }}"
      notify: Restart nginx
    
    - name: Enable nginx site
      file:
        src: "/etc/nginx/sites-available/{{ app_name }}"
        dest: "/etc/nginx/sites-enabled/{{ app_name }}"
        state: link
      notify: Restart nginx
    
    - name: Ensure nginx is running
      service:
        name: nginx
        state: started
        enabled: yes
    
    - name: Ensure app is running
      service:
        name: "{{ app_name }}"
        state: started
        enabled: yes
  
  handlers:
    - name: Restart nginx
      service:
        name: nginx
        state: restarted
    
    - name: Restart app
      service:
        name: "{{ app_name }}"
        state: restarted
```

---

## ⚠️ Common Pitfalls

- ❌ Not using `--check` before running in production
- ❌ Forgetting `become: yes` when tasks need root
- ❌ Using `shell` or `command` when a proper module exists (breaks idempotency!)
- ❌ Hardcoding secrets — always use `ansible-vault`
- ❌ Not organizing into roles once you have 5+ playbooks
- ❌ Skipping `gather_facts: no` on huge inventories (slows things down)
- ❌ Not versioning playbooks in Git
- ❌ Forgetting YAML is indent-sensitive (2 spaces, no tabs!)

---

## 🎯 Best Practices

1. **Version control everything** — playbooks belong in Git
2. **Use roles** for anything reusable
3. **Test with `--check`** before real runs
4. **Use `--diff`** to see what will change:
    
    Bash
    
    ```
    ansible-playbook playbook.yml --check --diff
    ```
    
5. **Tag tasks** for selective runs:
    
    YAML
    
    ```
    - name: Install nginx
      apt: name=nginx state=present
      tags: [install, webserver]
    ```
    
    Bash
    
    ```
    ansible-playbook playbook.yml --tags install
    ```
    
6. **Use `ansible-lint`** to catch mistakes:
    
    Bash
    
    ```
    pip install ansible-lint
    ansible-lint playbook.yml
    ```
    
7. **Separate variables** from playbooks (`group_vars/`, `host_vars/`)
8. **Document your playbooks** — comments and READMEs

---

## 🛠️ Useful Commands Cheat Sheet

Bash

```
# Test connectivity to all hosts
ansible all -m ping

# List hosts that would be targeted
ansible-playbook playbook.yml --list-hosts

# List tasks in a playbook
ansible-playbook playbook.yml --list-tasks

# Run specific tags only
ansible-playbook playbook.yml --tags "install,config"

# Skip specific tags
ansible-playbook playbook.yml --skip-tags "restart"

# Run on limited hosts
ansible-playbook playbook.yml --limit webservers

# Verbose output for debugging
ansible-playbook playbook.yml -vvv

# Syntax check only
ansible-playbook playbook.yml --syntax-check

# Show what would change (dry run)
ansible-playbook playbook.yml --check --diff

# Start at specific task
ansible-playbook playbook.yml --start-at-task="Install nginx"

# View all gathered facts
ansible hostname -m setup

# Install a role from Galaxy
ansible-galaxy install geerlingguy.nginx
```

---

## 🔗 Related Notes

- [[_Automation-Index|🤖 Automation Index]]
- [[Bash-Basics|🐚 Bash Basics]]
- [[Bash-Scripting-Patterns|🎯 Bash Patterns]]
- [[Cron-Guide|⏰ Cron Guide]]
- [[Systemd Commands|⚙️ Systemd Commands]]

---

## 📚 External References

- 🌐 [Official Ansible Docs](https://docs.ansible.com/)
- 🌐 [Ansible Galaxy](https://galaxy.ansible.com/) — Community roles
- 🌐 [Jeff Geerling's Blog](https://www.jeffgeerling.com/) — Best Ansible tutorials
- 📖 Book: _"Ansible for DevOps" by Jeff Geerling_
- 📺 YouTube: _"Ansible 101" series by Jeff Geerling_ (free!)
