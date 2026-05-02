"use strict";

const { getContextBudget } = require("../context-budget.js");

module.exports = Object.freeze({
  name: "bounty_get_context_budget",
  description: "Return the versioned context budget for a capability pack and optional routed surface.",
  inputSchema: {
    type: "object",
    properties: {
      target_domain: { type: "string" },
      capability_pack: { type: "string" },
      brief_profile: { type: "string" },
      surface_id: { type: "string" },
    },
    required: ["capability_pack"],
  },
  handler: getContextBudget,
  role_bundles: ["hunter", "hunter-web", "orchestrator", "router"],
  mutating: false,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: [],
  hook_required: false,
});
