"use strict";

const { androidStaticScan } = require("../mobile-artifacts.js");

module.exports = Object.freeze({
  name: "bounty_android_static_scan",
  description:
    "Run the Android mobile static MVP over an imported mobile artifact and return bounded manifest/string hints plus qualified backend surface leads.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "mobile_artifact_id": {
        "type": "string",
        "pattern": "^MA-[1-9][0-9]*$"
      },
      "allowed_hosts": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional additional in-scope hosts for mobile-derived backend lead promotion."
      }
    },
    "required": ["target_domain", "mobile_artifact_id"]
  },
  handler: androidStaticScan,
  role_bundles: ["hunter-android", "orchestrator"],
  mutating: true,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  device_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: ["mobile-static-scan-results.jsonl"],
  androidStaticScan,
});
