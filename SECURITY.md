# Security Policy

## Supported versions

This repository is a teaching / production-patterns showcase. Security fixes
are applied on `main` only.

| Version                            | Supported                  |
| ---------------------------------- | -------------------------- |
| `main`                             | ✅                         |
| older branches (`beginner`, `mid`) | ❌ (educational snapshots) |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Prefer one of:

1. **GitHub private vulnerability reporting** —
   [Report a vulnerability](https://github.com/kefyusuf/nodejs-rabbitmq-order-system/security/advisories/new)
   on this repository (recommended).
2. Open a **private** security advisory from the repository’s
   _Security_ tab.

Include:

- A short description of the issue and its impact
- Steps to reproduce (or a proof of concept)
- Affected component (API, workers, relay, Docker, dependencies, …)

## What to expect

- Acknowledgement when the report is received
- An initial assessment and, if confirmed, a fix on `main`
- Credit in the advisory / changelog if you want it

## Scope notes

- Demo credentials and placeholder secrets in `.env.example` / compose files
  are intentional and **not** vulnerabilities by themselves — but reports about
  unsafe defaults that would affect a real deployment are welcome.
- Dependency advisories are tracked via Dependabot and `npm audit`; please
  still report anything with a realistic exploit path in _this_ codebase.
