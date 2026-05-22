"use strict";

const { releaseMobileDeviceLease } = require("../mobile-device-profiles.js");

module.exports = Object.freeze({
  name: "bounty_release_mobile_device_lease",
  description:
    "Release a session-scoped mobile device lease.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "lease_id": { "type": "string", "pattern": "^MDL-[1-9][0-9]*$" }
    },
    "required": ["target_domain", "lease_id"]
  },
  handler: releaseMobileDeviceLease,
  role_bundles: ["hunter-android", "hunter-ios", "orchestrator"],
  mutating: true,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  device_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: ["mobile-device-leases.jsonl"],
});
