# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in BugSafari, please report it privately.
Do **not** open a public issue for security problems.

- Email: **ayantorreda18@gmail.com** with the subject line `SECURITY: BugSafari`.
- Include a description, reproduction steps, affected component, and impact.
- We aim to acknowledge reports within 3 business days and to provide a remediation
  timeline after triage.

Please give us a reasonable window to remediate before any public disclosure.

## Reporting abuse originating from a BugSafari deployment

BugSafari is an autonomous exploratory-testing engine that drives a browser against
a target application. If you believe a BugSafari-operated run is testing a site you
own **without authorization**, contact the address above with:

- The source IP you observed.
- Any `X-BugSafari-Run` / correlation identifier, if present, from your logs.
- The approximate timestamp and target URL.

We will trace the run to its operator and can suspend the source.

## Scope

This policy covers the `developer-dashboard`, `testing-core`, and `shared` packages
and the deployment configuration in this repository.

## Hardening status

The current security posture and the status of each hardening item are tracked in
[`SECURITY_HARDENING_PLAN.md`](./SECURITY_HARDENING_PLAN.md), which is the single
source of truth for implementation progress.
