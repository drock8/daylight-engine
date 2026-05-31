"use strict";

function compareRuns(baseline, current) {
  const deltas = {};

  for (const corpusName of Object.keys(current.results)) {
    const curr = current.results[corpusName];
    const base = baseline && baseline.results ? baseline.results[corpusName] : null;

    const entry = {
      corpus: corpusName,
      tier: curr.tier,
      metrics: {},
    };

    entry.metrics.coverage = {
      current: curr.scores.coverage.score,
      baseline: base ? base.scores.coverage.score : null,
      delta: base ? Number((curr.scores.coverage.score - base.scores.coverage.score).toFixed(4)) : null,
    };

    entry.metrics.phase_completion = {
      current: curr.scores.phase_completion.score,
      baseline: base ? base.scores.phase_completion.score : null,
      delta: base ? Number((curr.scores.phase_completion.score - base.scores.phase_completion.score).toFixed(4)) : null,
    };

    entry.metrics.finding_density = {
      current: curr.scores.finding_density.density,
      baseline: base ? base.scores.finding_density.density : null,
      delta: base ? Number((curr.scores.finding_density.density - base.scores.finding_density.density).toFixed(4)) : null,
    };

    const currTTI = curr.scores.time_to_insight.time_to_insight_ms;
    const baseTTI = base ? base.scores.time_to_insight.time_to_insight_ms : null;
    entry.metrics.time_to_insight_ms = {
      current: currTTI,
      baseline: baseTTI,
      delta: (currTTI != null && baseTTI != null) ? currTTI - baseTTI : null,
    };

    deltas[corpusName] = entry;
  }

  const regressions = [];
  for (const [name, entry] of Object.entries(deltas)) {
    if (entry.metrics.coverage.delta != null && entry.metrics.coverage.delta < -0.05) {
      regressions.push({
        corpus: name,
        metric: "coverage",
        delta: entry.metrics.coverage.delta,
        message: `Coverage dropped by ${Math.abs(entry.metrics.coverage.delta * 100).toFixed(1)}%`,
      });
    }
    if (entry.metrics.phase_completion.delta != null && entry.metrics.phase_completion.delta < 0) {
      regressions.push({
        corpus: name,
        metric: "phase_completion",
        delta: entry.metrics.phase_completion.delta,
        message: "Phase completion regressed",
      });
    }
  }

  return {
    schema_version: 1,
    baseline_version: baseline ? baseline.engine_version : null,
    current_version: current.engine_version,
    deltas,
    regressions,
    regression_count: regressions.length,
  };
}

module.exports = {
  compareRuns,
};
