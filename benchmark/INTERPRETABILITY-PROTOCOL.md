# Manual Interpretability Testing Protocol

This document defines the manual review protocol for evaluating scan report
quality. Automated metrics (coverage, time-to-insight, freshness) are
necessary but not sufficient — a human reviewer must assess whether the
report is **useful, actionable, and clear** to its intended audience.

## When to run

- Before every major release
- After significant changes to the report-writing pipeline
- After changes to finding contracts or verification logic

## Reviewer requirements

The reviewer should have baseline familiarity with:

- Web application security concepts (OWASP Top 10)
- The daylight-engine tier structure (tier_0 through tier_3)
- Common vulnerability report formats

## Scoring rubric

Score each dimension 1–5. Record scores in a structured JSON file using the
template at the bottom of this document.

### 1. Clarity (weight: 25%)

Does the report communicate findings without ambiguity?

| Score | Criteria |
|---|---|
| 5 | Every finding has a clear title, description, and reproduction path |
| 4 | Minor phrasing issues but no ambiguity |
| 3 | Some findings require re-reading to understand |
| 2 | Multiple findings are confusing or contradictory |
| 1 | Report is largely incomprehensible |

### 2. Actionability (weight: 25%)

Can the reader fix the issue based solely on the report?

| Score | Criteria |
|---|---|
| 5 | Every finding includes specific remediation steps |
| 4 | Most findings have remediation; a few are generic |
| 3 | Remediation is present but often vague |
| 2 | Remediation is mostly "fix this vulnerability" |
| 1 | No actionable remediation provided |

### 3. Accuracy (weight: 20%)

Are the findings real and correctly classified?

| Score | Criteria |
|---|---|
| 5 | All findings verified, no false positives |
| 4 | One minor misclassification |
| 3 | 1–2 false positives or severity mismatches |
| 2 | Multiple false positives undermine trust |
| 1 | Majority of findings are incorrect |

### 4. Completeness (weight: 15%)

Does the report cover the expected attack surface?

| Score | Criteria |
|---|---|
| 5 | All expected vulnerability classes tested and reported |
| 4 | One minor gap in coverage |
| 3 | Notable gaps but core findings present |
| 2 | Major attack surface areas untested |
| 1 | Report covers a fraction of the attack surface |

### 5. Presentation (weight: 15%)

Is the report well-structured and professional?

| Score | Criteria |
|---|---|
| 5 | Executive summary, organized sections, consistent formatting |
| 4 | Good structure with minor formatting issues |
| 3 | Readable but disorganized |
| 2 | Hard to navigate, inconsistent formatting |
| 1 | No discernible structure |

## Scoring template

Save results as `benchmark/results/interpretability-<date>.json`:

```json
{
  "schema_version": 1,
  "reviewer": "<name>",
  "date": "<YYYY-MM-DD>",
  "engine_version": "<version>",
  "tier": "<tier_0|tier_1|tier_2|tier_3>",
  "target_description": "<what was scanned>",
  "scores": {
    "clarity": { "score": 0, "notes": "" },
    "actionability": { "score": 0, "notes": "" },
    "accuracy": { "score": 0, "notes": "" },
    "completeness": { "score": 0, "notes": "" },
    "presentation": { "score": 0, "notes": "" }
  },
  "weighted_total": 0,
  "summary": ""
}
```

## Weighted total calculation

```
weighted_total = (clarity * 0.25) + (actionability * 0.25) +
                 (accuracy * 0.20) + (completeness * 0.15) +
                 (presentation * 0.15)
```

A weighted total of **3.5 or above** is the minimum quality bar for release.
Below 3.0 blocks the release until findings are addressed.
