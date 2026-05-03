#!/usr/bin/env node
"use strict";

// hacker-bob-cc is the Hacker Bob Claude Code adapter wrapper. It injects
// `--adapter claude` as the default when the operator has not supplied one,
// then delegates to the canonical hacker-bob CLI. Explicit `--adapter ...`
// is preserved so the wrapper does not block multi-adapter installs.
const args = process.argv.slice(2);
const hasAdapter = args.some(
  (arg) => arg === "--adapter" || arg.startsWith("--adapter="),
);
if (!hasAdapter) {
  process.argv.push("--adapter", "claude");
}

require("hacker-bob/bin/hacker-bob.js");
