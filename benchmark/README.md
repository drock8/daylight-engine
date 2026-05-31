# Benchmark Harness

Automated benchmark harness for daylight-engine scan quality metrics.

## Quick start

```bash
# Run the full benchmark suite against the test corpus
node benchmark/run.js

# Run a single corpus entry
node benchmark/run.js --target tier_0_basic

# Output results to a file
node benchmark/run.js --out results.json
```

## What it measures

### Automated metrics (run.js)

| Metric | Description |
|---|---|
| **coverage** | Percentage of attack-surface entries that received at least one coverage log entry |
| **time_to_insight_ms** | Wall-clock time from session start to first finding recorded |
| **freshness** | Whether CVE feed data and public-intel data are current (< 7 days old) |
| **phase_completion** | Whether the scan reached all phases allowed for its tier |
| **finding_density** | Findings per attack-surface entry — higher is not always better but zero is a signal |

### Manual interpretability protocol (documented below)

The manual protocol is run by a human reviewer post-scan. See
[INTERPRETABILITY-PROTOCOL.md](./INTERPRETABILITY-PROTOCOL.md) for the full
checklist and scoring rubric.

## Test corpus

The `corpus/` directory contains JSON fixture files, each describing a
benchmark scenario. Tier 0 (First Look) is a separate repository and is
not benchmarked here — this harness covers tiers 1–3 only.

Every corpus entry specifies:

- `target_domain`: a synthetic `.benchmark.local` domain
- `tier`: tier level (1–3) using internal IDs only
- `description`: what the scenario tests
- `expected_phases`: which pipeline phases should be reached
- `seed_artifacts`: pre-seeded session artifacts for the benchmark runner

See [corpus/README.md](./corpus/README.md) for the full corpus inventory.

## CI integration

The benchmark CI job runs on every release tag. See
`.github/workflows/benchmark.yml` for configuration.

## Consent & testing protocol

All benchmark scans target synthetic `.benchmark.local` domains with
pre-seeded artifacts. **No live network requests are made.** The benchmark
harness operates entirely on local fixture data and does not contact any
external systems.

See [TESTING-CONSENT.md](./TESTING-CONSENT.md) for the full consent and
authorization documentation.
