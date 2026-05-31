# Daylight Engine

Security scan engine powering [Zer0Daylight](https://zer0daylight.com) — bringing vulnerabilities into the light.

Daylight Engine coordinates reconnaissance, authentication testing, parallel surface hunting, finding verification, grading, and report generation for Zer0Daylight's security audit tiers.

## Tiers

| Tier | Mode | Phases |
|------|------|--------|
| **Teaser** (Free) | Passive recon only | RECON |
| **Starter** ($399) | Light active testing | RECON → HUNT → VERIFY → GRADE → REPORT |
| **Pro** ($1,500) | Full active + auth | RECON (deep) → AUTH → HUNT → CHAIN → VERIFY → GRADE → REPORT |
| **Eclipse** ($3,500) | Exhaustive | All phases, multi-wave, deep recon, full verification |

## Safety

Daylight Engine is designed for authorized security testing only. It can send real network requests, run local recon tools, and preserve sensitive run data on disk.

- Free teasers: passive scanning only, legal on any public URL with attestation
- Paid audits: require verified domain ownership and signed authorization before any active testing

See [DISCLAIMER.md](DISCLAIMER.md) for full usage terms.

## Setup

Requires Node.js 20+ and an Anthropic API key.

```bash
npm install
```

Optional recon tools: subfinder, httpx, nuclei, katana, dnsx, tlsx

## Attribution

Daylight Engine is a derivative work of [Hacker Bob](https://github.com/vmihalis/hacker-bob) by Michail Vasileiadis, licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for full attribution.
