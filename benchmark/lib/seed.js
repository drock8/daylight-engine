"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function sessionsRoot() {
  return path.join(os.homedir(), "bounty-agent-sessions");
}

function sessionDir(domain) {
  return path.join(sessionsRoot(), domain);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function seedSession(corpus) {
  const domain = corpus.target_domain;
  const dir = sessionDir(domain);

  ensureDir(dir);

  if (corpus.seed_artifacts.state) {
    const state = {
      version: 1,
      target_domain: domain,
      mtime: new Date().toISOString(),
      ...corpus.seed_artifacts.state,
    };
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify(state, null, 2),
    );
  }

  if (corpus.seed_artifacts.attack_surface) {
    fs.writeFileSync(
      path.join(dir, "attack_surface.json"),
      JSON.stringify(corpus.seed_artifacts.attack_surface, null, 2),
    );
  }

  if (Array.isArray(corpus.seed_artifacts.findings) && corpus.seed_artifacts.findings.length > 0) {
    const lines = corpus.seed_artifacts.findings.map((f) => {
      const record = {
        version: 1,
        ts: new Date().toISOString(),
        target_domain: domain,
        ...f,
      };
      return JSON.stringify(record);
    });
    fs.writeFileSync(path.join(dir, "findings.jsonl"), lines.join("\n") + "\n");
  }

  if (Array.isArray(corpus.seed_artifacts.coverage) && corpus.seed_artifacts.coverage.length > 0) {
    const lines = corpus.seed_artifacts.coverage.map((c) => {
      const record = {
        ts: new Date().toISOString(),
        ...c,
      };
      return JSON.stringify(record);
    });
    fs.writeFileSync(path.join(dir, "coverage.jsonl"), lines.join("\n") + "\n");
  }

  if (Array.isArray(corpus.seed_artifacts.pipeline_events) && corpus.seed_artifacts.pipeline_events.length > 0) {
    const lines = corpus.seed_artifacts.pipeline_events.map((e) => JSON.stringify(e));
    fs.writeFileSync(path.join(dir, "pipeline-events.jsonl"), lines.join("\n") + "\n");
  }

  return dir;
}

function cleanupSession(domain) {
  const dir = sessionDir(domain);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  cleanupSession,
  seedSession,
  sessionDir,
  sessionsRoot,
};
