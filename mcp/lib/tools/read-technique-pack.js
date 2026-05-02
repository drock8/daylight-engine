"use strict";

const { readTechniquePack } = require("../technique-packs.js");

function readTechniquePackTool(args) {
  return JSON.stringify(readTechniquePack(args.pack_id, { mode: args.mode || "summary" }));
}

module.exports = Object.freeze({
  name: "bounty_read_technique_pack",
  description: "Read one technique pack in summary or full bounded mode. Does not return unrelated technique bodies.",
  inputSchema: {
    type: "object",
    properties: {
      pack_id: { type: "string" },
      mode: { type: "string", enum: ["summary", "full"] },
    },
    required: ["pack_id"],
  },
  handler: readTechniquePackTool,
  role_bundles: ["hunter", "hunter-web", "orchestrator"],
  mutating: false,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: [],
  hook_required: false,
});
