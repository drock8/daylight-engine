"use strict";

const {
  PHASE_VALUES,
} = require("./constants.js");

// Operator-actionability ordering: kinds the operator can resolve
// fastest first. auth/egress have registry-based unblock paths;
// funded_wallet/key_material/external_credential require operator
// procurement. Lower number = higher actionability.
const BLOCKED_PREREQ_KIND_ACTIONABILITY = Object.freeze({
  auth_missing: 0,
  egress_unreachable: 1,
  funded_wallet_missing: 2,
  key_material_missing: 3,
  external_credential_missing: 4,
});

function phaseAtLeast(phase, requiredPhase) {
  const current = PHASE_VALUES.indexOf(phase);
  const required = PHASE_VALUES.indexOf(requiredPhase);
  return current >= 0 && required >= 0 && current >= required;
}

function terminallyBlockedEntries(state) {
  return Array.isArray(state && state.terminally_blocked) ? state.terminally_blocked : [];
}

function summarizeBlockedPrereqs(state) {
  const groups = new Map();
  const terminallyBlocked = terminallyBlockedEntries(state);
  // Iterate in blocked_at_wave ASC order so the LATEST blocker
  // overrides the example_reason field — operators care about the
  // freshest signal, not the oldest sample.
  const sortedEntries = [...terminallyBlocked].sort((a, b) =>
    (a.blocked_at_wave || 0) - (b.blocked_at_wave || 0),
  );
  for (const entry of sortedEntries) {
    if (!entry || !Array.isArray(entry.blockers)) continue;
    for (const blocker of entry.blockers) {
      const hint = blocker.identifier_hint || null;
      const key = `${blocker.kind}\t${hint || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          kind: blocker.kind,
          identifier_hint: hint,
          surface_count: 0,
          surface_ids: [],
          latest_reason: null,
          latest_blocked_at_wave: 0,
        });
      }
      const group = groups.get(key);
      group.surface_count += 1;
      if (!group.surface_ids.includes(entry.surface_id)) {
        group.surface_ids.push(entry.surface_id);
      }
      // Latest wave wins (entries are sorted ASC, so later iterations overwrite).
      if (blocker.reason) {
        group.latest_reason = blocker.reason;
      }
      if ((entry.blocked_at_wave || 0) > group.latest_blocked_at_wave) {
        group.latest_blocked_at_wave = entry.blocked_at_wave || 0;
      }
    }
  }
  return {
    total_blocked_surfaces: terminallyBlocked.length,
    by_kind: Array.from(groups.values()).sort((a, b) => {
      const aRank = BLOCKED_PREREQ_KIND_ACTIONABILITY[a.kind] ?? 99;
      const bRank = BLOCKED_PREREQ_KIND_ACTIONABILITY[b.kind] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return (a.identifier_hint || "").localeCompare(b.identifier_hint || "");
    }),
  };
}

function summarizeAcceptedCoverageGaps(state) {
  const blockedPrereqs = summarizeBlockedPrereqs(state);
  const surfaceIds = terminallyBlockedEntries(state)
    .map((entry) => entry && entry.surface_id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const accepted = blockedPrereqs.total_blocked_surfaces > 0 && phaseAtLeast(state && state.phase, "CHAIN");
  return {
    status: accepted
      ? "accepted_terminal_gap"
      : blockedPrereqs.total_blocked_surfaces > 0
        ? "terminal_gap_not_accepted"
        : "none",
    accepted,
    phase: state && state.phase ? state.phase : null,
    total_blocked_surfaces: blockedPrereqs.total_blocked_surfaces,
    surface_ids: surfaceIds,
    by_kind: blockedPrereqs.by_kind,
    note: accepted
      ? "Terminally blocked surfaces were accepted to proceed past HUNT; they count as closed for wave gating but remain blocked gaps, not explored coverage."
      : "No accepted terminal coverage gaps are active for this phase.",
  };
}

module.exports = {
  phaseAtLeast,
  summarizeAcceptedCoverageGaps,
  summarizeBlockedPrereqs,
};
