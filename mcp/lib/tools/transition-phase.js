"use strict";

// Legacy bounty_transition_phase tool. Deprecated as of Cycle G.2 of the
// frontier-topology realization hypergraph. The supported replacement is
// bob_advance_session (advance-session.js), which speaks the six-state
// lifecycle enum {SETUP, OPEN_FRONTIER, CLAIM_FREEZE, VERIFY, GRADE, REPORT}.
//
// This wrapper stays registered so existing callers do not break. Every
// invocation:
//   1. emits a tool_deprecated governance event referencing the legacy phase,
//      the mapped lifecycle state, and bob_advance_session as the replacement;
//   2. delegates to the original transitionPhase handler so the legacy
//      session-state phase machine (used by mcp-server.test.js and live agent
//      surfaces during the deprecation window) keeps returning the same
//      response shape.
//
// Legacy phase -> lifecycle_state mapping (mirrored by
// LEGACY_PHASE_TO_LIFECYCLE in session-state.js):
//
//   SURFACE_DISCOVERY -> OPEN_FRONTIER  (seed discovery is frontier work)
//   AUTH              -> OPEN_FRONTIER  (auth capture stays under the frontier
//                                        lens)
//   EVALUATE          -> OPEN_FRONTIER  (per-claim frontier work)
//   CHAIN             -> OPEN_FRONTIER  (chain assembly is frontier work; the
//                                        previous "freeze" semantics belong to
//                                        the new CLAIM_FREEZE state)
//   EXPLORE           -> OPEN_FRONTIER  (re-exploration re-enters the open
//                                        frontier, decision D3)
//   VERIFY            -> VERIFY
//   GRADE             -> GRADE
//   REPORT            -> REPORT
//
// Note: SETUP is the bootstrap state assigned by init-session; the legacy
// machine never collapsed back to SURFACE_DISCOVERY mid-session, so the shim
// never advertises SETUP as a destination.

const {
  mapLegacyPhaseToLifecycle,
  transitionPhase,
} = require("../session-state.js");
const {
  appendSessionEvent,
} = require("../session-events.js");

function recordDeprecationEvent(targetDomain, legacyPhase, mappedState) {
  if (typeof targetDomain !== "string" || !targetDomain.trim()) return;
  try {
    appendSessionEvent({
      target_domain: targetDomain,
      kind: "governance.tool_deprecated",
      payload: {
        tool: "bounty_transition_phase",
        replacement: "bob_advance_session",
        legacy_phase: legacyPhase,
        mapped_lifecycle_state: mappedState,
      },
    });
  } catch {
    // Deprecation telemetry must never break the underlying call. The legacy
    // handler is authoritative; this event is observational only.
  }
}

function handler(args) {
  const targetDomain = args && typeof args === "object" ? args.target_domain : null;
  const legacyPhase = args && typeof args === "object" ? args.to_phase : null;
  let mappedState = null;
  try {
    if (typeof legacyPhase === "string") {
      mappedState = mapLegacyPhaseToLifecycle(legacyPhase);
    }
  } catch {
    mappedState = null;
  }
  recordDeprecationEvent(targetDomain, legacyPhase, mappedState);
  return transitionPhase(args);
}

module.exports = Object.freeze({
  name: "bounty_transition_phase",
  description:
    "Deprecated: apply one validated FSM phase transition to the persisted " +
    "session state. Prefer bob_advance_session; this shim records a " +
    "tool_deprecated event on each invocation and routes through the legacy " +
    "phase machine for backwards compatibility.",
  deprecated: true,
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": {
        "type": "string"
      },
      "to_phase": {
        "type": "string",
        "enum": [
          "SURFACE_DISCOVERY",
          "AUTH",
          "EVALUATE",
          "CHAIN",
          "VERIFY",
          "GRADE",
          "REPORT",
          "EXPLORE"
        ]
      },
      "auth_status": {
        "type": "string",
        "enum": [
          "authenticated",
          "unauthenticated"
        ]
      },
      "override_reason": {
        "type": "string",
        "description": "Auditable gate override reason. Only allowed for EVALUATE -> CHAIN or CHAIN -> VERIFY and must be at least 20 characters."
      }
    },
    "required": [
      "target_domain",
      "to_phase"
    ]
  },
  handler,
  role_bundles: ["orchestrator"],
  mutating: true,
  global_preapproval: false,
  network_access: false,
  browser_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: [
    "state.json",
    "verification-input-snapshot.json",
    "verification-manifest.json",
    "verification-attempts/attempt-*/",
  ],
});
