"use strict";

const {
  assertEnumValue,
} = require("./validation.js");

// Plane T cycle T.4 — `browser_behavior_probe` is the browser-shaped sibling
// of `behavior_probe`. Distinct enum value (not an option/flag on the HTTP
// lens) so the scheduler, brief renderer, and pack-affinity filtering can
// dispatch unambiguously. Order is insertion-stable: it slots next to
// `behavior_probe` so a human reading the enum sees the HTTP/browser pair
// together.
const TASK_LENSES = Object.freeze([
  "seed_mapping",
  "surface_scout",
  "behavior_probe",
  "browser_behavior_probe",
  "control_check",
  "claim_development",
  "impact_correlation",
  "reproduction_check",
  "evidence_capture",
  "coverage_closeout",
]);

function normalizeTaskLens(value, fieldName = "lens") {
  return assertEnumValue(value, TASK_LENSES, fieldName);
}

function isTaskLens(value) {
  return TASK_LENSES.includes(value);
}

module.exports = {
  TASK_LENSES,
  isTaskLens,
  normalizeTaskLens,
};
