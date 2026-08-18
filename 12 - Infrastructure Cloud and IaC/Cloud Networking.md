# Cloud Networking

## Concept
Cloud networking combines virtual networks, route tables, security controls and managed gateways.

## Why it matters
Security groups and network ACLs may both influence traffic.

## Mental model
Treat this topic as one component in a larger system. A correct diagnosis usually requires identifying dependencies above and below the component rather than changing the first setting that appears related.

## What failure looks like
Common indicators include:
- explicit errors in application or system logs
- timeouts or increased latency
- resource saturation or exhaustion
- repeated retries and cascading failures
- differences between healthy and unhealthy hosts

## Investigation workflow
1. Define the exact symptom and affected scope.
2. Establish the first known time of failure.
3. Check recent deployments, configuration changes and capacity changes.
4. Collect evidence before restarting or deleting anything.
5. Compare with a known healthy baseline where possible.
6. Test one hypothesis at a time.
7. Verify both technical recovery and user-facing behavior.

## Useful commands
```bash
date
uptime
systemctl --failed
journalctl -p err -b
```

Add topic-specific commands and examples to this note as you encounter them in real systems.

## Safe remediation
Prefer the smallest reversible change that addresses evidence. Record the command, configuration change and expected result. If risk is high, define rollback before implementation.

## Verification
- Original symptom no longer reproduces.
- Logs stop producing the relevant error.
- Resource and latency metrics return to expected levels.
- Dependencies remain healthy.

## Prevention
Improve monitoring, capacity, configuration validation, automation or documentation so the same failure is detected earlier or cannot recur.

## Related topics
See the surrounding notebook for command-specific notes and [[Troubleshooting Methodology]].

## Personal lessons learned
Record environment-specific discoveries, incident links and commands that proved useful.
