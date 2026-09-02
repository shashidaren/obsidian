# grep awk and sed

## Concept

`grep`, `awk`, and `sed` are the classic Unix text tools:

- `grep` — select lines that match a pattern
- `sed` — stream-edit lines (substitute, delete, print a range)
- `awk` — field-oriented programs (columns, aggregates, small reports)

They operate on *lines of text*. They are not parsers for JSON, YAML, or HTML, even when a lucky regex appears to work.

## Why it matters

- Live incidents are mostly “find the error in this 2 GB log and count how often it happens”
- Fragile one-liners become monitoring checks and then page people on format changes
- Word-splitting and locale turn “simple” column extraction into wrong numbers
- Choosing the *wrong* tool wastes time: `grep` for presence, `awk` for fields, `sed` for in-stream rewrite, `jq` for structured data

A senior habit is: extract once into a stable representation, then compute. Do not stack four regexes on `journalctl` output that will change next Tuesday.

## Mental Model

```
Input stream
    → grep  filters lines (regex or fixed string)
    → sed   rewrites lines (address + command)
    → awk   splits into fields ($1…$NF), then programs

grep:  match / not-match / count / files-with-matches
sed:   s/old/new/  d  p  plus addresses (line numbers or regex)
awk:   pattern { action }   BEGIN / END   variables, arrays

Default field separator in awk is any run of whitespace.
Change it with -F or FS= for CSV-ish data (still not a CSV parser).
```

Use `-F` / `--fixed-strings` in grep when the pattern is a literal error string. Regex metacharacters in IPs and versions are a frequent self-own.

## Key Commands

```bash
# grep — start here
grep -RIn --exclude-dir=.git 'OutOfMemory' /var/log
grep -F 'ERROR 1040' /var/log/mysql/error.log
grep -E 'status=(5[0-9]{2}|timeout)' app.log
grep -c 'ERROR' app.log
grep -l 'ERROR' /var/log/app/*.log
journalctl -u nginx --since '1 hour ago' | grep -F 'upstream timed out'

# Context and binary safety
grep -n -C3 'segfault' /var/log/messages

# awk — columns and counts
awk '{print $1}' access.log | sort | uniq -c | sort -nr | head
awk '$9 >= 500 {c++} END {print c+0}' access.log
awk -F: '{print $1}' /etc/passwd
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c | sort -nr

# Field that is not $1 — use a real separator
awk -F: '{print $1}' /etc/passwd

# sed — small, explicit edits
sed -n '100,140p' app.log
sed 's/[[:space:]]*$//'
sed -i.bak 's/Listen 80/Listen 8080/' /etc/httpd/conf/httpd.conf   # keep the .bak

# Combined pipeline that stays readable
journalctl -u myapp --since today --no-pager \
  | grep -F 'ERROR' \
  | awk '{print $5}' \
  | sort | uniq -c | sort -nr
```

When names can contain spaces or the format is JSON:

```bash
# Prefer structured output over scraping human columns
journalctl -u myapp -o json | jq -r 'select(.PRIORITY=="3") | .MESSAGE'
ps -eo pid,rss,comm --no-headers
```

## Common Failure Modes & Symptoms

| What you see | Likely meaning | Next step |
|---|---|---|
| No matches, but you can see the line | Regex metacharacters, wrong encoding, or journal pager | `grep -F`, `LC_ALL=C`, `--no-pager` |
| Counts change with `LANG` | Locale collation / character classes | `LC_ALL=C grep` / `LC_ALL=C sort` |
| `awk '{print $7}'` is garbage | Variable-width fields, IPv6, or quoted strings | Use the application’s JSON / CSV interface |
| `sed -i` without backup on a shared file | In-place edit raced or was wrong | Always `-i.bak`; then diff |
| Script broke after a package update | Log format or `ps` column changed | Pin to `journalctl -o json` or a documented API |
| `grep -R` hammered a network FS | Walked NFS / bind mounts | Restrict path; exclude `/proc` `/sys` mounts |
| Binary “matches” and a “Binary file matches” warning | grep treated a binary as text | `-I` to skip, or `strings` |

## Investigation Tips

- Start with a *literal* needle (`grep -F`) copied from a known bad line. Add a regex only after that hits.
- Cap the data: `--since`, `tail -n`, or a time-bounded `journalctl` before you `grep -R /`.
- `uniq -c` is only meaningful after `sort`. `sort | uniq -c | sort -nr` is the sysadmin histogram.
- For multi-line patterns (Java stack traces), `grep` alone is the wrong shape; use `awk` with a state flag, `pcregrep -M`, or parse structured logs.
- `sed` is a poor XML/JSON editor. One successful substitute does not mean the file is still valid.
- When a one-liner is about to become a cron, rewrite it with comments, `set -euo pipefail`, and an explicit input file — or move it to Python.
- Compare two hosts with the *same* command and `LC_ALL=C`. Hidden locale differences look like “prod is special”.

## Related Notes

- [[Bash Deep Dive]]
- [[find Deep Dive]]
- [[journalctl Deep Dive]]
- [[Logging Architecture]]
- [[Python for Sysadmins]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- I have paged myself with a grep that matched `error` inside `terror` and inside `0 errors`. Anchors and `-F` / word boundaries are cheaper than explaining a false page.
- Scraping `docker ps` or `kubectl get` columns with `awk '{print $3}'` broke the first time a name got long enough to wrap. `--no-headers -o jsonpath=...` is the grown-up version.
- `sed -i` on a file Ansible also manages is how you get a two-hour “who changed nginx.conf” argument. Edit the source of truth, not the rendered file, unless you are in a break-glass window.
