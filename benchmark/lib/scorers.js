"use strict";

const fs = require("fs");
const path = require("path");
const { sessionDir } = require("./seed.js");

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function scoreCoverage(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  const attackSurface = readJson(path.join(dir, "attack_surface.json"));
  if (!attackSurface || !Array.isArray(attackSurface.surfaces)) {
    return { score: 0, total_endpoints: 0, covered_endpoints: 0, detail: "no attack surface" };
  }

  const allEndpoints = new Set();
  for (const surface of attackSurface.surfaces) {
    if (!Array.isArray(surface.endpoints)) continue;
    for (const ep of surface.endpoints) {
      const key = `${surface.surface_id}|${(ep.method || "GET").toUpperCase()}|${ep.path}`;
      allEndpoints.add(key);
    }
  }

  const coverageRecords = readJsonl(path.join(dir, "coverage.jsonl"));
  const coveredEndpoints = new Set();
  for (const record of coverageRecords) {
    const key = `${record.surface_id}|${(record.method || "GET").toUpperCase()}|${record.endpoint}`;
    if (allEndpoints.has(key)) {
      coveredEndpoints.add(key);
    }
  }

  const total = allEndpoints.size;
  const covered = coveredEndpoints.size;
  const score = total > 0 ? Number((covered / total).toFixed(4)) : 0;

  return {
    score,
    total_endpoints: total,
    covered_endpoints: covered,
    uncovered_endpoints: Array.from(allEndpoints).filter((k) => !coveredEndpoints.has(k)),
  };
}

function scoreTimeToInsight(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  const events = readJsonl(path.join(dir, "pipeline-events.jsonl"));
  if (events.length === 0) {
    return { time_to_insight_ms: null, detail: "no pipeline events" };
  }

  const sessionStart = events.find((e) => e.type === "session_started");
  const firstFinding = events.find((e) => e.type === "finding_recorded");

  if (!sessionStart || !firstFinding) {
    return {
      time_to_insight_ms: null,
      session_started: !!sessionStart,
      first_finding_recorded: !!firstFinding,
      detail: !sessionStart ? "no session_started event" : "no findings recorded",
    };
  }

  const startMs = Date.parse(sessionStart.ts);
  const findingMs = Date.parse(firstFinding.ts);

  if (!Number.isFinite(startMs) || !Number.isFinite(findingMs)) {
    return { time_to_insight_ms: null, detail: "unparseable timestamps" };
  }

  return {
    time_to_insight_ms: Math.max(0, findingMs - startMs),
  };
}

function scoreFreshness(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  const state = readJson(path.join(dir, "state.json"));
  const events = readJsonl(path.join(dir, "pipeline-events.jsonl"));

  const nowMs = Date.now();
  const maxAgeDays = 7;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const timestamps = [];
  if (state && state.mtime) timestamps.push(Date.parse(state.mtime));
  for (const event of events) {
    if (event.ts) timestamps.push(Date.parse(event.ts));
  }

  const validTimestamps = timestamps.filter(Number.isFinite);
  const latestMs = validTimestamps.length > 0 ? Math.max(...validTimestamps) : 0;
  const ageMs = latestMs > 0 ? nowMs - latestMs : Infinity;
  const fresh = ageMs <= maxAgeMs;

  return {
    fresh,
    latest_activity_ts: latestMs > 0 ? new Date(latestMs).toISOString() : null,
    age_hours: latestMs > 0 ? Number((ageMs / (60 * 60 * 1000)).toFixed(1)) : null,
    threshold_days: maxAgeDays,
  };
}

function scorePhaseCompletion(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  const expectedPhases = corpus.expected_phases || [];
  const events = readJsonl(path.join(dir, "pipeline-events.jsonl"));
  const state = readJson(path.join(dir, "state.json"));

  const reachedPhases = new Set();

  if (state && state.phase) {
    reachedPhases.add(state.phase);
  }

  for (const event of events) {
    if (event.type === "session_started" && event.phase) {
      reachedPhases.add(event.phase);
    }
    if (event.type === "phase_transitioned" && event.to_phase) {
      reachedPhases.add(event.to_phase);
    }
  }

  const completed = expectedPhases.filter((p) => reachedPhases.has(p));
  const missing = expectedPhases.filter((p) => !reachedPhases.has(p));
  const score = expectedPhases.length > 0
    ? Number((completed.length / expectedPhases.length).toFixed(4))
    : 1;

  return {
    score,
    expected: expectedPhases,
    completed,
    missing,
  };
}

function scoreFindingDensity(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  const attackSurface = readJson(path.join(dir, "attack_surface.json"));
  const findings = readJsonl(path.join(dir, "findings.jsonl"));

  let totalEndpoints = 0;
  if (attackSurface && Array.isArray(attackSurface.surfaces)) {
    for (const surface of attackSurface.surfaces) {
      if (Array.isArray(surface.endpoints)) {
        totalEndpoints += surface.endpoints.length;
      }
    }
  }

  const density = totalEndpoints > 0
    ? Number((findings.length / totalEndpoints).toFixed(4))
    : 0;

  const bySeverity = {};
  for (const f of findings) {
    const sev = f.severity || "unknown";
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }

  return {
    density,
    total_findings: findings.length,
    total_endpoints: totalEndpoints,
    by_severity: bySeverity,
  };
}

function scoreAll(corpus) {
  return {
    coverage: scoreCoverage(corpus),
    time_to_insight: scoreTimeToInsight(corpus),
    freshness: scoreFreshness(corpus),
    phase_completion: scorePhaseCompletion(corpus),
    finding_density: scoreFindingDensity(corpus),
  };
}

module.exports = {
  scoreAll,
  scoreCoverage,
  scoreFindingDensity,
  scoreFreshness,
  scorePhaseCompletion,
  scoreTimeToInsight,
};
