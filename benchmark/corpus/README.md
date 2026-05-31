# Benchmark Test Corpus

Each JSON file in this directory defines a benchmark scenario. The runner
pre-seeds session artifacts and scores the engine's analytics pipeline
against the seeded data.

## Corpus entries

Tier 0 (First Look) is a separate repository and not benchmarked here.
This corpus covers tiers 1–3 only.

| File | Tier | Description |
|---|---|---|
| `tier_1_webapp.json` | tier_1 | Full single-wave scan of a web app with findings |
| `tier_2_auth_heavy.json` | tier_2 | Multi-wave auth-differential scan |
| `tier_3_full.json` | tier_3 | Full-depth multi-wave scan with chain building |

## Schema

```json
{
  "name": "unique-corpus-id",
  "description": "What this scenario tests",
  "tier": 0,
  "target_domain": "something.benchmark.local",
  "expected_phases": ["RECON"],
  "seed_artifacts": {
    "state": { ... },
    "attack_surface": { ... },
    "findings": [ ... ],
    "coverage": [ ... ]
  }
}
```

All `target_domain` values must use the `.benchmark.local` suffix.
