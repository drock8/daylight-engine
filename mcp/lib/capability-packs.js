"use strict";

const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  brief_max_tokens: 2500,
  candidate_pack_limit: 5,
  full_pack_read_limit: 2,
  attempt_log_required: true,
  team_escalation_allowed: false,
});

const WEB_CAPABILITY_PACK = Object.freeze({
  id: "web",
  capability_pack_version: 1,
  hunter_agent: "hunter-agent",
  brief_profile: "web",
  role_bundles: Object.freeze(["hunter-web"]),
  completion_gate: "web_wave_handoff",
  context_budget: DEFAULT_CONTEXT_BUDGET,
});

const CAPABILITY_PACKS = Object.freeze({
  web: WEB_CAPABILITY_PACK,
});

const WEB_SURFACE_TYPES = Object.freeze([
  "admin",
  "api",
  "auth",
  "billing",
  "ci_cd",
  "cms",
  "graphql",
  "js_endpoint",
  "mobile_api",
  "secrets",
  "static",
  "unknown",
  "upload",
]);

const WEB_SURFACE_TYPE_SET = new Set(WEB_SURFACE_TYPES);

// Smart-contract packs are intentionally inactive on this branch. The
// platform-adapters merge must add smart_contract_evm, smart_contract_svm,
// smart_contract_move, smart_contract_substrate, and smart_contract_cosmwasm
// here before those hunters can be selected by routing.

function normalizeSurfaceType(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized || null;
}

function getCapabilityPack(packId) {
  return CAPABILITY_PACKS[packId] || null;
}

function cloneContextBudget(budget) {
  return {
    brief_max_tokens: budget.brief_max_tokens,
    candidate_pack_limit: budget.candidate_pack_limit,
    full_pack_read_limit: budget.full_pack_read_limit,
    attempt_log_required: budget.attempt_log_required,
    team_escalation_allowed: budget.team_escalation_allowed,
  };
}

function getCapabilityPackContextBudget(packId) {
  const pack = getCapabilityPack(packId);
  if (!pack) return null;
  return cloneContextBudget(pack.context_budget || DEFAULT_CONTEXT_BUDGET);
}

function hunterAgentNamesForCapabilityPacks() {
  return Array.from(new Set(
    Object.values(CAPABILITY_PACKS)
      .map((pack) => pack && pack.hunter_agent)
      .filter((value) => typeof value === "string" && value.trim()),
  ));
}

function defaultWebRouteMetadata() {
  return {
    capability_pack: WEB_CAPABILITY_PACK.id,
    capability_pack_version: WEB_CAPABILITY_PACK.capability_pack_version,
    hunter_agent: WEB_CAPABILITY_PACK.hunter_agent,
    brief_profile: WEB_CAPABILITY_PACK.brief_profile,
    context_budget: cloneContextBudget(WEB_CAPABILITY_PACK.context_budget),
  };
}

function classifySurfaceCapability(surface) {
  const rawSurfaceType = surface && typeof surface === "object" ? surface.surface_type : null;
  const normalizedType = normalizeSurfaceType(rawSurfaceType);
  const surfaceType = normalizedType || "unknown";
  const reasons = normalizedType ? [`surface_type:${surfaceType}`] : ["surface_type:missing"];
  const knownWebType = normalizedType == null || WEB_SURFACE_TYPE_SET.has(surfaceType);

  if (!knownWebType) {
    reasons.push("fallback:web");
  }

  return {
    surface_type: surfaceType,
    capability_pack: WEB_CAPABILITY_PACK.id,
    capability_pack_version: WEB_CAPABILITY_PACK.capability_pack_version,
    hunter_agent: WEB_CAPABILITY_PACK.hunter_agent,
    brief_profile: WEB_CAPABILITY_PACK.brief_profile,
    context_budget: cloneContextBudget(WEB_CAPABILITY_PACK.context_budget),
    confidence: knownWebType ? "high" : "medium",
    reasons,
  };
}

function assertPackString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`assignment route metadata has invalid ${fieldName}`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`assignment route metadata has invalid ${fieldName}`);
  }
  return normalized;
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`assignment route metadata has invalid ${fieldName}`);
  }
  return value;
}

function normalizeBudgetInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new Error(`assignment route metadata has invalid context_budget.${fieldName}`);
  }
  return value;
}

function normalizeBudgetBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`assignment route metadata has invalid context_budget.${fieldName}`);
  }
  return value;
}

function normalizeContextBudget(value, pack) {
  if (value == null) {
    return cloneContextBudget(pack.context_budget || DEFAULT_CONTEXT_BUDGET);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("assignment route metadata has invalid context_budget");
  }
  return {
    brief_max_tokens: normalizeBudgetInteger(value.brief_max_tokens, "brief_max_tokens"),
    candidate_pack_limit: normalizeBudgetInteger(value.candidate_pack_limit, "candidate_pack_limit"),
    full_pack_read_limit: normalizeBudgetInteger(value.full_pack_read_limit, "full_pack_read_limit"),
    attempt_log_required: normalizeBudgetBoolean(value.attempt_log_required, "attempt_log_required"),
    team_escalation_allowed: normalizeBudgetBoolean(value.team_escalation_allowed, "team_escalation_allowed"),
  };
}

function normalizeAssignmentRouteMetadata(assignment) {
  const hasRouteMetadata = !!assignment && (
    assignment.capability_pack != null ||
    assignment.hunter_agent != null ||
    assignment.brief_profile != null
  );
  if (!hasRouteMetadata) {
    return defaultWebRouteMetadata();
  }

  const capabilityPack = assertPackString(assignment.capability_pack, "capability_pack");
  const hunterAgent = assertPackString(assignment.hunter_agent, "hunter_agent");
  const briefProfile = assertPackString(assignment.brief_profile, "brief_profile");
  const pack = getCapabilityPack(capabilityPack);
  if (!pack) {
    throw new Error(`assignment route metadata references unknown capability_pack: ${capabilityPack}`);
  }
  if (hunterAgent !== pack.hunter_agent) {
    throw new Error(`assignment route metadata hunter_agent ${hunterAgent} does not match pack ${capabilityPack}`);
  }
  if (briefProfile !== pack.brief_profile) {
    throw new Error(`assignment route metadata brief_profile ${briefProfile} does not match pack ${capabilityPack}`);
  }
  const capabilityPackVersion = assignment.capability_pack_version == null
    ? pack.capability_pack_version
    : assertPositiveInteger(assignment.capability_pack_version, "capability_pack_version");

  return {
    capability_pack: capabilityPack,
    capability_pack_version: capabilityPackVersion,
    hunter_agent: hunterAgent,
    brief_profile: briefProfile,
    context_budget: normalizeContextBudget(assignment.context_budget, pack),
  };
}

module.exports = {
  CAPABILITY_PACKS,
  DEFAULT_CONTEXT_BUDGET,
  WEB_SURFACE_TYPES,
  classifySurfaceCapability,
  defaultWebRouteMetadata,
  getCapabilityPack,
  getCapabilityPackContextBudget,
  hunterAgentNamesForCapabilityPacks,
  normalizeAssignmentRouteMetadata,
  normalizeSurfaceType,
};
