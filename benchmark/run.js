#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { seedSession, cleanupSession } = require("./lib/seed.js");
const { scoreAll } = require("./lib/scorers.js");
const { compareRuns } = require("./lib/compare.js");

function loadCorpus(corpusDir) {
  const files = fs.readdirSync(corpusDir)
    .filter((f) => f.endsWith(".json") && f !== "README.md")
    .sort();

  const entries = [];
  for (const file of files) {
    const filePath = path.join(corpusDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    entries.push(content);
  }
  return entries;
}

function readEngineVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
    );
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function parseArgs(argv) {
  const args = { target: null, out: null, baseline: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--target" && argv[i + 1]) {
      args.target = argv[++i];
    } else if (argv[i] === "--out" && argv[i + 1]) {
      args.out = argv[++i];
    } else if (argv[i] === "--baseline" && argv[i + 1]) {
      args.baseline = argv[++i];
    } else if (argv[i] === "--quiet" || argv[i] === "-q") {
      args.quiet = true;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const corpusDir = path.join(__dirname, "corpus");
  const engineVersion = readEngineVersion();

  let corpus = loadCorpus(corpusDir);
  if (args.target) {
    corpus = corpus.filter((c) => c.name === args.target);
    if (corpus.length === 0) {
      console.error(`No corpus entry found for: ${args.target}`);
      process.exit(1);
    }
  }

  if (!args.quiet) {
    console.log(`Benchmark harness — engine v${engineVersion}`);
    console.log(`Running ${corpus.length} corpus entries...\n`);
  }

  const results = {};
  let passed = 0;
  let failed = 0;

  for (const entry of corpus) {
    const domain = entry.target_domain;
    try {
      seedSession(entry);

      const scores = scoreAll(entry);
      const entryPassed = scores.phase_completion.score >= 1.0;

      results[entry.name] = {
        name: entry.name,
        tier: entry.tier,
        target_domain: domain,
        status: entryPassed ? "passed" : "failed",
        scores,
      };

      if (entryPassed) {
        passed++;
      } else {
        failed++;
      }

      if (!args.quiet) {
        const icon = entryPassed ? "PASS" : "FAIL";
        console.log(`  [${icon}] ${entry.name} (tier_${entry.tier})`);
        console.log(`         coverage: ${(scores.coverage.score * 100).toFixed(1)}%`);
        console.log(`         phases:   ${scores.phase_completion.completed.join(" -> ") || "none"}`);
        console.log(`         findings: ${scores.finding_density.total_findings} (density: ${scores.finding_density.density})`);
        if (scores.time_to_insight.time_to_insight_ms != null) {
          console.log(`         time-to-insight: ${(scores.time_to_insight.time_to_insight_ms / 1000).toFixed(1)}s`);
        }
        console.log();
      }
    } catch (err) {
      results[entry.name] = {
        name: entry.name,
        tier: entry.tier,
        target_domain: domain,
        status: "error",
        error: err.message || String(err),
      };
      failed++;
      if (!args.quiet) {
        console.log(`  [ERR]  ${entry.name}: ${err.message}`);
      }
    } finally {
      cleanupSession(domain);
    }
  }

  const report = {
    schema_version: 1,
    engine_version: engineVersion,
    timestamp: new Date().toISOString(),
    summary: {
      total: corpus.length,
      passed,
      failed,
    },
    results,
  };

  if (args.baseline) {
    try {
      const baselineData = JSON.parse(fs.readFileSync(args.baseline, "utf8"));
      report.comparison = compareRuns(baselineData, report);

      if (!args.quiet && report.comparison.regressions.length > 0) {
        console.log("Regressions detected:");
        for (const reg of report.comparison.regressions) {
          console.log(`  - ${reg.corpus}: ${reg.message}`);
        }
        console.log();
      }
    } catch (err) {
      if (!args.quiet) {
        console.log(`Warning: could not load baseline: ${err.message}\n`);
      }
    }
  }

  if (!args.quiet) {
    console.log(`Results: ${passed} passed, ${failed} failed out of ${corpus.length} total`);
  }

  if (args.out) {
    const outDir = path.dirname(args.out);
    if (outDir && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    if (!args.quiet) {
      console.log(`Results written to: ${args.out}`);
    }
  } else {
    if (args.quiet) {
      console.log(JSON.stringify(report, null, 2));
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
