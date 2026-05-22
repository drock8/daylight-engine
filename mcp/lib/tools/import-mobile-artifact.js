"use strict";

const { importMobileArtifact } = require("../mobile-artifacts.js");
const {
  MOBILE_ARTIFACT_MAX_BYTES,
  MOBILE_ARTIFACT_TYPE_VALUES,
} = require("../constants.js");

module.exports = Object.freeze({
  name: "bounty_import_mobile_artifact",
  description:
    "Import an in-scope mobile app binary artifact into session-owned mobile-apps storage. Accepts capped base64 content only; stored bytes are hashed and package-excluded.",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "artifact_type": { "type": "string", "enum": MOBILE_ARTIFACT_TYPE_VALUES },
      "content_base64": {
        "type": "string",
        "description": `Base64-encoded app artifact bytes. Decoded content is capped at ${MOBILE_ARTIFACT_MAX_BYTES} bytes.`
      },
      "label": { "type": "string" },
      "source_name": { "type": "string" },
      "surface_id": { "type": "string" },
      "app_id": { "type": "string" },
      "app_version": { "type": "string" }
    },
    "required": ["target_domain", "artifact_type", "content_base64"]
  },
  handler: importMobileArtifact,
  role_bundles: ["hunter-android", "hunter-ios", "orchestrator"],
  mutating: true,
  global_preapproval: true,
  network_access: false,
  browser_access: false,
  device_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: ["mobile-apps","mobile-artifacts.jsonl"],
  importMobileArtifact,
});
