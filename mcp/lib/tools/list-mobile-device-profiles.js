"use strict";

const { listMobileDeviceProfiles } = require("../mobile-device-profiles.js");

module.exports = Object.freeze({
  name: "bounty_list_mobile_device_profiles",
  description:
    "List session-scoped mobile device profiles and active leases without exposing raw serials, UDIDs, or local device names.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" }
    },
    "required": ["target_domain"]
  },
  handler: listMobileDeviceProfiles,
  role_bundles: ["hunter-android", "hunter-ios", "orchestrator"],
  mutating: false,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  device_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: [],
});
