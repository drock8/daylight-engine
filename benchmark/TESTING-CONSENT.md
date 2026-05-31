# Testing Consent & Authorization

## Scope

The daylight-engine benchmark harness operates **entirely offline** against
synthetic fixture data. It does not:

- Make any network requests to external hosts
- Scan real domains or IP addresses
- Access any third-party APIs
- Store or transmit any data outside the local filesystem

## Test corpus domains

All corpus entries use `.benchmark.local` domains, which are non-routable
synthetic hostnames. Examples:

- `basic-webapp.benchmark.local`
- `api-service.benchmark.local`
- `auth-heavy-app.benchmark.local`

These domains do not resolve and cannot be confused with real targets.

## Pre-seeded artifacts

Instead of running live scans, the benchmark harness pre-seeds session
directories with fixture artifacts (attack surfaces, findings, coverage
logs, etc.) and then runs the scoring/analytics pipeline against that
seeded data.

## Authorization

Running `node benchmark/run.js` is self-contained and requires no external
authorization. The benchmark measures engine analytics quality, not live
scanning capability.

## Responsible use

This harness is designed for internal quality assurance. Do not modify the
corpus to point at real domains. The engine's live scanning capabilities
require separate authorization per the project's SECURITY.md and
DISCLAIMER.md.
