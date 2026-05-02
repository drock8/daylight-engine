"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertBoolean,
  assertNonEmptyString,
  normalizeOptionalText,
  parseAgentId,
  parseWaveId,
} = require("./validation.js");
const {
  loadWaveAssignments,
} = require("./assignments.js");
const {
  readSessionStateStrict,
} = require("./session-state.js");
const {
  readAttackSurfaceStrict,
} = require("./attack-surface.js");
const {
  rankAttackSurfaces,
} = require("./ranking.js");
const {
  buildCoverageSummaryForSurface,
  readCoverageRecordsFromJsonl,
} = require("./coverage.js");
const {
  buildCircuitBreakerSummary,
  readHttpAuditRecordsFromJsonl,
  readTrafficRecordsFromJsonl,
  summarizeHttpAuditRecords,
  summarizeTrafficRecords,
} = require("./http-records.js");
const {
  summarizePublicIntelForSurface,
} = require("./public-intel.js");
const {
  summarizeStaticScanHints,
} = require("./static-artifacts.js");
const {
  filterExclusionsByHosts,
} = require("./scope.js");
const {
  normalizeAssignmentRouteMetadata,
} = require("./capability-packs.js");
const {
  resolveHunterKnowledge,
  selectTechniquePacksForSurface,
} = require("./technique-packs.js");

// Bypass table tech-to-file map used by hunter brief generation.
const BYPASS_TABLE_MAP = {
  wordpress: "wordpress.txt",
  graphql: "graphql.txt",
  ssrf: "ssrf.txt",
  jwt: "jwt.txt",
  firebase: "firebase.txt",
  "next.js": "nextjs.txt",
  nextjs: "nextjs.txt",
  oauth: "oauth-oidc.txt",
  oidc: "oauth-oidc.txt",
};
const BYPASS_TABLE_DEFAULT = "rest-api.txt";
const HUNTER_BRIEF_SURFACE_ARRAY_LIMITS = Object.freeze({
  hosts: 20,
  tech_stack: 20,
  endpoints: 80,
  interesting_params: 40,
  nuclei_hits: 30,
  bug_class_hints: 20,
  high_value_flows: 20,
  evidence: 25,
});
const HUNTER_BRIEF_SURFACE_SCALAR_LIMITS = Object.freeze({
  id: 120,
  priority: 40,
  original_priority: 40,
  surface_type: 80,
  name: 160,
  title: 160,
  description: 500,
});
const HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS = 500;
const HUNTER_BRIEF_RANKING_REASON_LIMIT = 10;
const HUNTER_BRIEF_RANKING_REASON_MAX_CHARS = 160;

function resolveBypassTable(techStack) {
  if (!Array.isArray(techStack)) return BYPASS_TABLE_DEFAULT;
  for (const tech of techStack) {
    const key = String(tech).toLowerCase();
    for (const [pattern, file] of Object.entries(BYPASS_TABLE_MAP)) {
      if (key.includes(pattern)) return file;
    }
  }
  return BYPASS_TABLE_DEFAULT;
}

function isBriefScalar(value) {
  return value == null || ["string", "number", "boolean"].includes(typeof value);
}

function capStringValue(value, maxChars) {
  if (typeof value !== "string" || value.length <= maxChars) {
    return { value, truncated: false, total_chars: typeof value === "string" ? value.length : null };
  }
  return {
    value: value.slice(0, maxChars),
    truncated: true,
    total_chars: value.length,
  };
}

function cappedSurfaceArray(value, limit) {
  const values = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  let truncatedValues = 0;
  const shownValues = values.filter((item) => item != null).slice(0, limit).map((item) => {
    const capped = capStringValue(String(item), HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS);
    if (capped.truncated) truncatedValues += 1;
    return capped.value;
  });
  const limits = {
    shown: shownValues.length,
    total: values.length,
    omitted: Math.max(0, values.length - shownValues.length),
  };
  if (truncatedValues > 0) {
    limits.truncated_values = truncatedValues;
    limits.max_value_chars = HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS;
  }
  return {
    values: shownValues,
    limits,
  };
}

function slimRankingForBrief(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ranking = {};
  if (Number.isFinite(value.version)) ranking.version = value.version;
  if (Number.isFinite(value.score)) ranking.score = value.score;
  if (isBriefScalar(value.priority)) {
    ranking.priority = capStringValue(String(value.priority), HUNTER_BRIEF_SURFACE_SCALAR_LIMITS.priority).value;
  }
  const cappedReasons = cappedSurfaceArray(value.reasons, HUNTER_BRIEF_RANKING_REASON_LIMIT);
  ranking.reasons = cappedReasons.values.map((reason) => {
    const capped = capStringValue(reason, HUNTER_BRIEF_RANKING_REASON_MAX_CHARS);
    return capped.value;
  });
  return ranking;
}

function slimSurfaceForBrief(surface) {
  const source = surface && typeof surface === "object" && !Array.isArray(surface) ? surface : {};
  const slimSurface = {};
  const surfaceLimits = {};

  for (const [field, maxChars] of Object.entries(HUNTER_BRIEF_SURFACE_SCALAR_LIMITS)) {
    const value = source[field];
    if (!isBriefScalar(value) || value == null) continue;
    const normalizedValue = typeof value === "string" ? value : String(value);
    const capped = capStringValue(normalizedValue, maxChars);
    slimSurface[field] = capped.value;
    if (capped.truncated) {
      surfaceLimits[field] = {
        shown_chars: capped.value.length,
        total_chars: capped.total_chars,
        omitted_chars: capped.total_chars - capped.value.length,
      };
    }
  }

  const ranking = slimRankingForBrief(source.ranking);
  if (ranking) {
    slimSurface.ranking = ranking;
  }

  for (const [field, limit] of Object.entries(HUNTER_BRIEF_SURFACE_ARRAY_LIMITS)) {
    const capped = cappedSurfaceArray(source[field], limit);
    slimSurface[field] = capped.values;
    surfaceLimits[field] = capped.limits;
  }

  return {
    surface: slimSurface,
    surface_limits: surfaceLimits,
  };
}

function readHunterBrief(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const wave = parseWaveId(args.wave);
  const agent = parseAgentId(args.agent);
  const egressProfile = normalizeOptionalText(args.egress_profile, "egress_profile") || "default";
  const blockInternalHosts = args.block_internal_hosts == null
    ? false
    : assertBoolean(args.block_internal_hosts, "block_internal_hosts");
  const waveNumber = Number(wave.slice(1));

  // 1. Load and validate assignment
  const { assignmentByAgent } = loadWaveAssignments(domain, waveNumber);
  const assignment = assignmentByAgent.get(agent);
  if (!assignment) {
    throw new Error(`Agent ${agent} is not assigned in wave ${wave}`);
  }
  const routeMetadata = normalizeAssignmentRouteMetadata(assignment);
  if (routeMetadata.brief_profile !== "web") {
    throw new Error(`Unsupported hunter brief profile: ${routeMetadata.brief_profile}`);
  }

  // 2. Load attack surface and find assigned surface
  const attackSurface = readAttackSurfaceStrict(domain);
  let surfacesForBrief = attackSurface.document.surfaces;
  try {
    const ranked = rankAttackSurfaces(domain, { write: false });
    if (ranked && Array.isArray(ranked.surfaces)) {
      surfacesForBrief = ranked.surfaces;
    }
  } catch {}
  const surfaceObj = surfacesForBrief.find(
    (s) => s.id === assignment.surface_id,
  );
  if (!surfaceObj) {
    throw new Error(`Surface ${assignment.surface_id} not found in attack_surface.json`);
  }

  // 3. Read session state for exclusions
  const { state } = readSessionStateStrict(domain);

  // 4. Resolve bypass table
  const bypassFile = resolveBypassTable(surfaceObj.tech_stack);
  let bypassTable = "";
  try {
    // Look for bypass tables relative to project dir, install location, or global install
    const candidates = [
      path.join(process.env.CLAUDE_PROJECT_DIR || "", ".claude", "bypass-tables", bypassFile),
      path.join(__dirname, "..", "..", ".claude", "bypass-tables", bypassFile),
      path.join(os.homedir(), ".claude", "bypass-tables", bypassFile),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        bypassTable = fs.readFileSync(candidate, "utf8").trim();
        break;
      }
    }
  } catch {}

  const deadEndResult = filterExclusionsByHosts(state.dead_ends, surfaceObj.hosts);
  const wafResult = filterExclusionsByHosts(state.waf_blocked_endpoints, surfaceObj.hosts);
  const knowledge = resolveHunterKnowledge(surfaceObj, {
    capabilityPack: routeMetadata.capability_pack,
    maxEntries: Math.min(4, routeMetadata.context_budget.candidate_pack_limit),
  });
  const selectedTechniquePacks = selectTechniquePacksForSurface(surfaceObj, {
    capabilityPack: routeMetadata.capability_pack,
    maxPacks: routeMetadata.context_budget.candidate_pack_limit,
    includeAttempted: true,
  }).selected.map((pack) => ({
    id: pack.id,
    version: pack.version,
    title: pack.title,
    matched: pack.matched,
    score: pack.score,
    summary: pack.summary,
    estimated_tokens: pack.estimated_tokens,
  }));
  const coverageSummary = buildCoverageSummaryForSurface(
    readCoverageRecordsFromJsonl(domain),
    assignment.surface_id,
  );
  const trafficSummary = summarizeTrafficRecords(
    readTrafficRecordsFromJsonl(domain),
    { surface: surfaceObj },
  );
  const auditRecords = readHttpAuditRecordsFromJsonl(domain);
  const auditSummary = summarizeHttpAuditRecords(auditRecords, { surface: surfaceObj, targetDomain: domain });
  const circuitBreakerSummary = buildCircuitBreakerSummary(auditRecords, { surface: surfaceObj });
  const intelHints = summarizePublicIntelForSurface(domain, surfaceObj);
  const staticScanHints = summarizeStaticScanHints(domain, { surface: surfaceObj });
  const slimSurface = slimSurfaceForBrief(surfaceObj);

  return JSON.stringify({
    run_context: {
      target_domain: domain,
      phase: state.phase,
      auth_status: state.auth_status,
      egress_profile: egressProfile,
      block_internal_hosts: blockInternalHosts,
      capability_pack: routeMetadata.capability_pack,
      capability_pack_version: routeMetadata.capability_pack_version,
      hunter_agent: routeMetadata.hunter_agent,
      brief_profile: routeMetadata.brief_profile,
      context_budget: routeMetadata.context_budget,
    },
    target_url: state.target_url,
    wave,
    agent,
    surface: slimSurface.surface,
    surface_limits: slimSurface.surface_limits,
    valid_surface_ids: attackSurface.surface_ids,
    dead_ends: deadEndResult.filtered,
    waf_blocked_endpoints: wafResult.filtered,
    exclusions_summary: {
      dead_ends_total: deadEndResult.total,
      dead_ends_shown: deadEndResult.filtered.length,
      dead_ends_omitted: deadEndResult.omitted,
      waf_blocked_total: wafResult.total,
      waf_blocked_shown: wafResult.filtered.length,
      waf_blocked_omitted: wafResult.omitted,
    },
    bypass_table: bypassTable || null,
    techniques: knowledge.techniques,
    payload_hints: knowledge.payload_hints,
    knowledge_summary: knowledge.knowledge_summary,
    technique_packs: {
      selected: selectedTechniquePacks,
      selection_budget: {
        candidate_pack_limit: routeMetadata.context_budget.candidate_pack_limit,
        full_pack_read_limit: routeMetadata.context_budget.full_pack_read_limit,
      },
    },
    coverage_summary: coverageSummary,
    traffic_summary: trafficSummary,
    audit_summary: auditSummary,
    circuit_breaker_summary: circuitBreakerSummary,
    ranking_summary: surfaceObj.ranking || null,
    intel_hints: intelHints,
    static_scan_hints: staticScanHints,
    auth_profiles_hint: "Call `bounty_list_auth_profiles`; pass the chosen profile name as `auth_profile` to `bounty_http_scan`.",
  }, null, 2);
}

module.exports = {
  readHunterBrief,
  resolveBypassTable,
  resolveHunterKnowledge,
  slimSurfaceForBrief,
};
