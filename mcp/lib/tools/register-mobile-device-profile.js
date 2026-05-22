"use strict";

const { registerMobileDeviceProfile } = require("../mobile-device-profiles.js");
const {
  MOBILE_DEVICE_ACTION_VALUES,
  MOBILE_DEVICE_PROFILE_KIND_VALUES,
} = require("../constants.js");

module.exports = Object.freeze({
  name: "bounty_register_mobile_device_profile",
  description:
    "Register a session-scoped mobile emulator, simulator, or physical-device profile. Raw serials/UDIDs are hashed; later device-capable tools must select a profile and acquire a lease.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "profile_kind": { "type": "string", "enum": MOBILE_DEVICE_PROFILE_KIND_VALUES },
      "label": { "type": "string", "minLength": 1, "maxLength": 120 },
      "device_identifier_hint": {
        "type": "string",
        "description": "Optional serial/UDID/emulator handle used only to derive a hash; the raw value is not stored."
      },
      "authorized_actions": {
        "type": "array",
        "items": { "type": "string", "enum": MOBILE_DEVICE_ACTION_VALUES }
      },
      "notes": { "type": "string" }
    },
    "required": ["target_domain", "profile_kind", "label", "authorized_actions"]
  },
  handler: registerMobileDeviceProfile,
  role_bundles: ["orchestrator"],
  mutating: true,
  global_preapproval: false,
  network_access: false,
  browser_access: false,
  device_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: ["mobile-device-profiles.jsonl"],
});
