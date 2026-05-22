"use strict";

const { acquireMobileDeviceLease } = require("../mobile-device-profiles.js");

module.exports = Object.freeze({
  name: "bounty_acquire_mobile_device_lease",
  description:
    "Acquire a session-scoped lease for a registered mobile device profile before any future device/emulator/simulator operation.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "profile_id": { "type": "string", "pattern": "^MDP-[1-9][0-9]*$" },
      "purpose": { "type": "string", "minLength": 1, "maxLength": 200 },
      "ttl_ms": { "type": "integer", "minimum": 1000, "maximum": 21600000 }
    },
    "required": ["target_domain", "profile_id", "purpose"]
  },
  handler: acquireMobileDeviceLease,
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
