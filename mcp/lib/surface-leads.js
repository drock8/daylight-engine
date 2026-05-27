"use strict";

// Aggregator shim for the legacy surface-leads.js entry. The original module
// was split into lead-intake / lead-scoring / lead-promotion / surface-mutator
// in F.6; external consumers (test fixtures, in-tree call sites) still import
// from "./surface-leads.js", so this file re-exports the union of the four
// new modules. Deleted alongside surface-mutator in Plane D.

module.exports = {
  ...require("./lead-intake.js"),
  ...require("./lead-scoring.js"),
  ...require("./lead-promotion.js"),
  ...require("./surface-mutator.js"),
};
