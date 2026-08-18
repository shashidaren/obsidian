# DNS Resolution

## Concept

DNS turns names into addresses (and other records). On a Linux host the resolution path is usually:

```
Application → glibc / nsswitch → resolv.conf / systemd-resolved → recursive resolvers → authoritative servers
```

## Why it matters

Many “network” problems are actually DNS problems.  
Applications can behave differently from command-line tools because they may use different libraries, caches, or search domains.

## Mental Model

1. Application calls `getaddrinfo()` (or similar).
2. Name Service Switch (`/etc/nsswitch.conf`) decides the order (files, dns, etc.).
3. DNS configuration comes from `/etc/resolv.conf` (which may be managed by NetworkManager, systemd-resolved, etc.).
4. Query goes to the configured resolvers.

## Key Commands

```bash
# What the system libraries resolve (closest to most applications)
getent hosts example.com
getent ahosts example.com

# Direct DNS query tools
dig example.com
dig +short example.com
dig @8.8.8.8 example.com

# Check local configuration
cat /etc/resolv.conf
cat /etc/nsswitch.conf | grep hosts

# systemd-resolved (common on modern distributions)
resolvectl status
resolvectl query example.com
```

## Common Failure Modes & Symptoms

| Symptom                              | Likely cause                              | First checks                     |
|--------------------------------------|-------------------------------------------|----------------------------------|
| Works with dig, fails in application | Search domain, nsswitch, or different resolver | `getent`, `/etc/nsswitch.conf`  |
| Intermittent resolution              | Flaky upstream resolver or rate limiting  | Try different resolvers          |
| NXDOMAIN for valid name              | Wrong search domain or split DNS          | `dig` with absolute name (trailing dot) |
| Slow resolution                      | Timeout on first resolver                 | `resolv.conf` order, timeouts    |
| Only some hosts affected             | Caching resolver or /etc/hosts            | Compare with another machine     |

## Investigation Tips

- Always test with both `getent` and `dig`.
- Use a trailing dot (`example.com.`) to disable search domains.
- Check whether `systemd-resolved` or NetworkManager is managing `resolv.conf`.
- In containers, DNS is often controlled by the runtime or CNI plugin.

## Related Notes

- [[TCP IP Troubleshooting Model]]
- [[dig Deep Dive]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

> 
