"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { seedSession, cleanupSession } = require("../benchmark/lib/seed.js");
const {
  scoreAll,
  scoreCoverage,
  scoreFindingDensity,
  scoreFreshness,
  scorePhaseCompletion,
  scoreTimeToInsight,
} = require("../benchmark/lib/scorers.js");
const { compareRuns } = require("../benchmark/lib/compare.js");

function loadCorpusEntry(name) {
  const filePath = path.join(__dirname, "..", "benchmark", "corpus", `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

describe("benchmark corpus validation", () => {
  const corpusDir = path.join(__dirname, "..", "benchmark", "corpus");
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    it(`${file} has required fields`, () => {
      const content = JSON.parse(fs.readFileSync(path.join(corpusDir, file), "utf8"));
      assert.ok(content.name, "name is required");
      assert.ok(content.description, "description is required");
      assert.ok(Number.isInteger(content.tier) && content.tier >= 1 && content.tier <= 3, "tier must be 1-3 (tier_0 is a separate repo)");
      assert.ok(content.target_domain, "target_domain is required");
      assert.ok(content.target_domain.endsWith(".benchmark.local"), "domain must use .benchmark.local suffix");
      assert.ok(Array.isArray(content.expected_phases), "expected_phases must be an array");
      assert.ok(content.seed_artifacts, "seed_artifacts is required");
      assert.ok(content.seed_artifacts.state, "seed_artifacts.state is required");
    });
  }
});

describe("seed and cleanup", () => {
  it("creates and removes session directory", () => {
    const corpus = loadCorpusEntry("tier_1_webapp");
    const dir = seedSession(corpus);
    try {
      assert.ok(fs.existsSync(dir), "session dir should exist after seeding");
      assert.ok(fs.existsSync(path.join(dir, "state.json")), "state.json should exist");
      assert.ok(fs.existsSync(path.join(dir, "attack_surface.json")), "attack_surface.json should exist");
    } finally {
      cleanupSession(corpus.target_domain);
    }
    assert.ok(!fs.existsSync(dir), "session dir should be removed after cleanup");
  });

  it("seeds findings and coverage jsonl", () => {
    const corpus = loadCorpusEntry("tier_1_webapp");
    try {
      seedSession(corpus);
      const dir = path.join(require("os").homedir(), "bounty-agent-sessions", corpus.target_domain);
      assert.ok(fs.existsSync(path.join(dir, "findings.jsonl")), "findings.jsonl should exist");
      assert.ok(fs.existsSync(path.join(dir, "coverage.jsonl")), "coverage.jsonl should exist");
      assert.ok(fs.existsSync(path.join(dir, "pipeline-events.jsonl")), "pipeline-events.jsonl should exist");

      const findingsContent = fs.readFileSync(path.join(dir, "findings.jsonl"), "utf8").trim();
      const findingsLines = findingsContent.split("\n");
      assert.strictEqual(findingsLines.length, 3, "should have 3 findings");
    } finally {
      cleanupSession(corpus.target_domain);
    }
  });
});

describe("scorers", () => {
  describe("scoreCoverage", () => {
    it("computes coverage ratio for tier_1_webapp", () => {
      const corpus = loadCorpusEntry("tier_1_webapp");
      try {
        seedSession(corpus);
        const result = scoreCoverage(corpus);
        assert.ok(result.score > 0, "coverage score should be > 0");
        assert.ok(result.score <= 1, "coverage score should be <= 1");
        assert.ok(result.total_endpoints > 0, "should have endpoints");
        assert.ok(result.covered_endpoints > 0, "should have covered endpoints");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });

    it("computes high coverage for tier_3", () => {
      const corpus = loadCorpusEntry("tier_3_full");
      try {
        seedSession(corpus);
        const result = scoreCoverage(corpus);
        assert.ok(result.score >= 0.5, "tier_3 should have substantial coverage");
        assert.ok(result.total_endpoints >= 10, "tier_3 should have many endpoints");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });

  describe("scoreTimeToInsight", () => {
    it("computes time to first finding for tier_1_webapp", () => {
      const corpus = loadCorpusEntry("tier_1_webapp");
      try {
        seedSession(corpus);
        const result = scoreTimeToInsight(corpus);
        assert.ok(result.time_to_insight_ms != null, "should have time_to_insight_ms");
        assert.ok(result.time_to_insight_ms >= 0, "should be non-negative");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });

    it("computes time to first finding for tier_2", () => {
      const corpus = loadCorpusEntry("tier_2_auth_heavy");
      try {
        seedSession(corpus);
        const result = scoreTimeToInsight(corpus);
        assert.ok(result.time_to_insight_ms != null, "should have time_to_insight_ms");
        assert.ok(result.time_to_insight_ms > 0, "multi-phase scan should have nonzero TTI");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });

  describe("scorePhaseCompletion", () => {
    it("reports full completion for tier_1 that reached REPORT", () => {
      const corpus = loadCorpusEntry("tier_1_webapp");
      try {
        seedSession(corpus);
        const result = scorePhaseCompletion(corpus);
        assert.strictEqual(result.score, 1, "should complete all expected phases");
        assert.strictEqual(result.missing.length, 0, "no missing phases");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });

    it("reports full completion for tier_3 including EXPLORE", () => {
      const corpus = loadCorpusEntry("tier_3_full");
      try {
        seedSession(corpus);
        const result = scorePhaseCompletion(corpus);
        assert.strictEqual(result.score, 1, "tier_3 should complete all phases");
        assert.ok(result.completed.includes("EXPLORE"), "EXPLORE should be in completed phases");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });

  describe("scoreFindingDensity", () => {
    it("computes density for tier_2 corpus", () => {
      const corpus = loadCorpusEntry("tier_2_auth_heavy");
      try {
        seedSession(corpus);
        const result = scoreFindingDensity(corpus);
        assert.ok(result.density > 0, "should have nonzero density");
        assert.strictEqual(result.total_findings, 4);
        assert.ok(result.by_severity.critical >= 1, "should have critical findings");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });

  describe("scoreFreshness", () => {
    it("reports fresh for recently seeded data", () => {
      const corpus = loadCorpusEntry("tier_1_webapp");
      try {
        seedSession(corpus);
        const result = scoreFreshness(corpus);
        assert.strictEqual(result.fresh, true, "recently seeded data should be fresh");
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });

  describe("scoreAll", () => {
    it("returns all metric categories", () => {
      const corpus = loadCorpusEntry("tier_3_full");
      try {
        seedSession(corpus);
        const result = scoreAll(corpus);
        assert.ok("coverage" in result);
        assert.ok("time_to_insight" in result);
        assert.ok("freshness" in result);
        assert.ok("phase_completion" in result);
        assert.ok("finding_density" in result);
      } finally {
        cleanupSession(corpus.target_domain);
      }
    });
  });
});

describe("compare", () => {
  it("detects regressions when coverage drops", () => {
    const baseline = {
      engine_version: "0.0.9",
      results: {
        test: {
          scores: {
            coverage: { score: 0.8 },
            phase_completion: { score: 1.0 },
            finding_density: { density: 0.5 },
            time_to_insight: { time_to_insight_ms: 30000 },
          },
        },
      },
    };
    const current = {
      engine_version: "0.1.0",
      results: {
        test: {
          tier: 1,
          scores: {
            coverage: { score: 0.6 },
            phase_completion: { score: 1.0 },
            finding_density: { density: 0.5 },
            time_to_insight: { time_to_insight_ms: 30000 },
          },
        },
      },
    };

    const result = compareRuns(baseline, current);
    assert.strictEqual(result.regression_count, 1);
    assert.strictEqual(result.regressions[0].metric, "coverage");
  });

  it("reports no regressions on improvement", () => {
    const baseline = {
      engine_version: "0.0.9",
      results: {
        test: {
          scores: {
            coverage: { score: 0.5 },
            phase_completion: { score: 1.0 },
            finding_density: { density: 0.3 },
            time_to_insight: { time_to_insight_ms: 60000 },
          },
        },
      },
    };
    const current = {
      engine_version: "0.1.0",
      results: {
        test: {
          tier: 1,
          scores: {
            coverage: { score: 0.8 },
            phase_completion: { score: 1.0 },
            finding_density: { density: 0.5 },
            time_to_insight: { time_to_insight_ms: 30000 },
          },
        },
      },
    };

    const result = compareRuns(baseline, current);
    assert.strictEqual(result.regression_count, 0);
  });

  it("handles null baseline gracefully", () => {
    const current = {
      engine_version: "0.1.0",
      results: {
        test: {
          tier: 1,
          scores: {
            coverage: { score: 0.8 },
            phase_completion: { score: 1.0 },
            finding_density: { density: 0.5 },
            time_to_insight: { time_to_insight_ms: 30000 },
          },
        },
      },
    };

    const result = compareRuns(null, current);
    assert.strictEqual(result.baseline_version, null);
    assert.strictEqual(result.regression_count, 0);
  });
});
