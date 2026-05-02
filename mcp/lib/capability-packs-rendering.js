"use strict";

const { CAPABILITY_PACKS } = require("./capability-packs.js");

// Render a markdown reference table of every pack's verifier dispatch.
// Both the Claude and Codex prompt renderers consume this so adding a new
// pack to capability-packs.js updates every adapter at next regeneration.
// Keep the rendering renderer-agnostic — the same string is dropped into
// brutalist/balanced/final/evidence prompts on Claude and into the Codex
// `bob-hunt` skill's worker contracts.
function renderCapabilityPackVerifierTable() {
  const rows = [];
  const failReasonNotes = [];
  for (const pack of Object.values(CAPABILITY_PACKS)) {
    const v = pack.verifier;
    if (!v) continue;
    const replay = v.replay_tool;
    const sample = v.sample_type;
    const fresh = v.fresh_state_omit_field == null ? "—" : `omit \`${v.fresh_state_omit_field}\``;
    const blockRef = v.block_reference_field
      ? `\`${v.block_reference_field}\` (${v.block_reference_label || "block"})`
      : "—";
    const disambig = v.disambiguation && v.disambiguation.tool
      ? `\`${v.disambiguation.tool}\``
      : "—";
    rows.push(`| \`${pack.id}\` | \`${replay}\` | \`${sample}\` | ${fresh} | ${blockRef} | ${disambig} |`);
    if (v.disambiguation && v.disambiguation.tool && v.disambiguation.fail_reason) {
      failReasonNotes.push(`- \`${pack.id}\` disambiguation deny reason: ${v.disambiguation.fail_reason}`);
    }
  }
  return [
    "## Capability pack verifier table",
    "",
    "Generated from `mcp/lib/capability-packs.js`. Adding a new pack updates this table at next prompt regeneration.",
    "",
    "| capability_pack | replay_tool | sample_type | runner-input param to omit for fresh-state replay | runner response field with resolved block reference | required disambiguation read |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "Disambiguation deny reasons (use as `reasoning` when the disambiguation read does not resolve):",
    ...failReasonNotes,
  ].join("\n");
}

const CAPABILITY_PACK_VERIFIER_TABLE_PLACEHOLDER = "{{CAPABILITY_PACK_VERIFIER_TABLE}}";

// Substitute the verifier-table placeholder in any document. Returns the
// document unchanged if the placeholder is absent.
function substituteCapabilityPackVerifierTable(document) {
  if (!document.includes(CAPABILITY_PACK_VERIFIER_TABLE_PLACEHOLDER)) return document;
  return document.split(CAPABILITY_PACK_VERIFIER_TABLE_PLACEHOLDER).join(renderCapabilityPackVerifierTable());
}

module.exports = {
  CAPABILITY_PACK_VERIFIER_TABLE_PLACEHOLDER,
  renderCapabilityPackVerifierTable,
  substituteCapabilityPackVerifierTable,
};
