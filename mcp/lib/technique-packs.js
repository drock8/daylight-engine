"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  TECHNIQUE_ATTEMPT_LOG_MAX_RECORDS,
  TECHNIQUE_ATTEMPT_STATUS_VALUES,
} = require("./constants.js");
const {
  assertEnumValue,
  assertInteger,
  assertNonEmptyString,
  assertRequiredText,
  normalizeOptionalInteger,
  normalizeOptionalText,
  parseAgentId,
  parseWaveId,
} = require("./validation.js");
const {
  readAttackSurfaceStrict,
} = require("./attack-surface.js");
const {
  validateAssignedWaveAgentSurface,
} = require("./assignments.js");
const {
  techniqueAttemptsJsonlPath,
  surfaceRoutesPath,
} = require("./paths.js");
const {
  classifySurfaceCapability,
  getCapabilityPack,
} = require("./capability-packs.js");
const {
  readSurfaceRoutesStrict,
} = require("./surface-router.js");
const {
  appendJsonlLine,
  withSessionLock,
} = require("./storage.js");
const {
  safeAppendPipelineEventDirect,
} = require("./pipeline-analytics.js");

const HUNTER_KNOWLEDGE_FILE = path.join(".claude", "knowledge", "hunter-techniques.json");
const HUNTER_KNOWLEDGE_DEFAULT_ID = "generic-rest-api";
const HUNTER_KNOWLEDGE_MAX_ENTRIES = 4;
const HUNTER_KNOWLEDGE_MAX_CHARS = 4500;
const TECHNIQUE_PACK_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_SUMMARY_ESTIMATED_TOKENS = 500;
const DEFAULT_FULL_ESTIMATED_TOKENS = 1500;

function hunterKnowledgeCandidatePaths() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) {
    candidates.push(path.join(process.env.CLAUDE_PROJECT_DIR, HUNTER_KNOWLEDGE_FILE));
  }
  candidates.push(path.join(__dirname, "..", "..", HUNTER_KNOWLEDGE_FILE));
  candidates.push(path.join(os.homedir(), HUNTER_KNOWLEDGE_FILE));
  return candidates;
}

function loadHunterKnowledge() {
  for (const candidate of hunterKnowledgeCandidatePaths()) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
        return {
          path: candidate,
          version: Number.isInteger(parsed.version) ? parsed.version : 1,
          entries: parsed.entries.filter((entry) => entry && typeof entry === "object"),
        };
      }
    } catch {
      // Technique packs are read-only enrichment. Malformed optional knowledge
      // must not block deterministic assignment briefs.
    }
  }
  return { path: null, version: 1, entries: [] };
}

function lowerStringArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item != null)
    .map((item) => String(item).toLowerCase());
}

function stringArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item != null)
    .map((item) => String(item));
}

function surfaceFieldText(surface, fields) {
  const values = [];
  for (const field of fields) {
    values.push(...lowerStringArray(surface[field]));
  }
  return values.join("\n");
}

function countMatches(patterns, haystack, weight, label) {
  const matches = [];
  let score = 0;
  for (const pattern of lowerStringArray(patterns)) {
    if (!pattern || !haystack.includes(pattern)) continue;
    score += weight;
    matches.push(`${label}:${pattern}`);
  }
  return { score, matches };
}

function countExactMatches(patterns, values, weight, label) {
  const valueSet = new Set(lowerStringArray(values));
  const matches = [];
  let score = 0;
  for (const pattern of lowerStringArray(patterns)) {
    if (!pattern || !valueSet.has(pattern)) continue;
    score += weight;
    matches.push(`${label}:${pattern}`);
  }
  return { score, matches };
}

function scoreTechniqueEntry(entry, surface) {
  const match = entry.match && typeof entry.match === "object" ? entry.match : {};
  const techText = surfaceFieldText(surface, [
    "tech_stack",
    "surface_type",
  ]);
  const endpointText = surfaceFieldText(surface, [
    "endpoints",
    "discovered_endpoints",
    "js_endpoints",
    "hosts",
    "high_value_flows",
    "evidence",
  ]);
  const paramValues = [
    ...lowerStringArray(surface.interesting_params),
    ...lowerStringArray(surface.params),
    ...lowerStringArray(surface.parameters),
  ];
  const hintText = surfaceFieldText(surface, [
    "nuclei_hits",
    "js_hints",
    "security_issues",
    "leaked_secrets",
    "auth_info",
    "surface_type",
    "bug_class_hints",
    "high_value_flows",
    "evidence",
  ]);

  const scored = [
    countMatches(match.tech, techText, 8, "tech"),
    countMatches(match.endpoints, endpointText, 5, "endpoint"),
    countExactMatches(match.params, paramValues, 3, "param"),
    countMatches(match.hints, hintText, 4, "hint"),
  ];

  return scored.reduce(
    (result, item) => ({
      score: result.score + item.score,
      matches: result.matches.concat(item.matches),
    }),
    { score: 0, matches: [] },
  );
}

function normalizeTechniquePackId(value, fieldName = "pack_id") {
  const packId = assertNonEmptyString(value, fieldName);
  if (!TECHNIQUE_PACK_ID_RE.test(packId)) {
    throw new Error(`${fieldName} has invalid format`);
  }
  return packId;
}

function normalizeCapabilityPacks(entry) {
  const packs = stringArray(entry.capability_packs)
    .map((item) => item.trim())
    .filter(Boolean);
  return packs.length > 0 ? Array.from(new Set(packs)) : ["web"];
}

function packEstimatedTokens(entry) {
  const explicit = entry.estimated_tokens && typeof entry.estimated_tokens === "object"
    ? entry.estimated_tokens
    : {};
  return {
    summary: Number.isInteger(explicit.summary) && explicit.summary > 0
      ? explicit.summary
      : DEFAULT_SUMMARY_ESTIMATED_TOKENS,
    full: Number.isInteger(explicit.full) && explicit.full > 0
      ? explicit.full
      : DEFAULT_FULL_ESTIMATED_TOKENS,
  };
}

function normalizeRegistryEntry(entry, registryVersion) {
  const id = normalizeTechniquePackId(entry.id || "knowledge-entry", "technique_pack.id");
  const title = assertNonEmptyString(entry.title || entry.id || "Hunter guidance", "technique_pack.title");
  return {
    id,
    version: Number.isInteger(entry.version) ? entry.version : registryVersion,
    title,
    capability_packs: normalizeCapabilityPacks(entry),
    match: entry.match && typeof entry.match === "object" && !Array.isArray(entry.match) ? entry.match : {},
    techniques: stringArray(entry.techniques)
      .map((item) => item.trim())
      .filter(Boolean),
    payload_hints: stringArray(entry.payload_hints)
      .map((item) => item.trim())
      .filter(Boolean),
    estimated_tokens: packEstimatedTokens(entry),
    raw_entry: {
      id,
      title,
      match: entry.match && typeof entry.match === "object" && !Array.isArray(entry.match) ? entry.match : {},
      techniques: stringArray(entry.techniques)
        .map((item) => item.trim())
        .filter(Boolean),
      payload_hints: stringArray(entry.payload_hints)
        .map((item) => item.trim())
        .filter(Boolean),
    },
  };
}

function loadTechniqueRegistry() {
  const knowledge = loadHunterKnowledge();
  return {
    source: knowledge.path,
    version: knowledge.version,
    packs: knowledge.entries.map((entry) => normalizeRegistryEntry(entry, knowledge.version)),
  };
}

function techniquePackSummary(pack, { matches = [], score = 0, attempt = null } = {}) {
  const summary = {
    id: pack.id,
    version: pack.version,
    title: pack.title,
    capability_packs: pack.capability_packs.slice(),
    matched: matches.slice(0, 8),
    score,
    summary: {
      guidance: pack.techniques.slice(0, 4),
      payload_hints: pack.payload_hints.slice(0, 4),
    },
    estimated_tokens: { ...pack.estimated_tokens },
  };
  if (attempt) {
    summary.attempt = summarizeTechniqueAttempt(attempt);
  }
  return summary;
}

function latestAttemptByPack(attempts) {
  const latest = new Map();
  for (const attempt of attempts || []) {
    latest.set(attempt.pack_id, attempt);
  }
  return latest;
}

function shouldSkipAttemptedPack(attempt, includeAttempted) {
  if (includeAttempted) return false;
  return !!attempt;
}

function selectTechniquePacksForSurface(surface, {
  capabilityPack = "web",
  maxPacks = HUNTER_KNOWLEDGE_MAX_ENTRIES,
  includeAttempted = true,
  attempts = [],
} = {}) {
  const limit = normalizeOptionalInteger(maxPacks, "max_packs", { min: 1, max: 50 }) || HUNTER_KNOWLEDGE_MAX_ENTRIES;
  const registry = loadTechniqueRegistry();
  if (registry.packs.length === 0) {
    return {
      source: registry.source,
      selected: [],
      omitted_attempted: [],
      registry_version: registry.version,
    };
  }

  const attemptsByPack = latestAttemptByPack(attempts);
  const scoredPacks = [];
  for (const pack of registry.packs) {
    if (!pack.capability_packs.includes(capabilityPack)) continue;
    const scored = scoreTechniqueEntry(pack, surface || {});
    if (scored.score > 0) {
      scoredPacks.push({ pack, score: scored.score, matches: scored.matches });
    }
  }

  if (scoredPacks.length === 0) {
    const fallback = registry.packs.find(
      (pack) => pack.id === HUNTER_KNOWLEDGE_DEFAULT_ID && pack.capability_packs.includes(capabilityPack),
    );
    if (fallback) {
      scoredPacks.push({ pack: fallback, score: 0, matches: ["fallback:generic-rest-api"] });
    }
  }

  scoredPacks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.pack.id.localeCompare(b.pack.id);
  });

  const selected = [];
  const omittedAttempted = [];
  for (const scored of scoredPacks) {
    const attempt = attemptsByPack.get(scored.pack.id) || null;
    if (shouldSkipAttemptedPack(attempt, includeAttempted)) {
      omittedAttempted.push(summarizeTechniqueAttempt(attempt));
      continue;
    }
    selected.push(techniquePackSummary(scored.pack, {
      matches: scored.matches,
      score: scored.score,
      attempt,
    }));
    if (selected.length >= limit) break;
  }

  return {
    source: registry.source,
    selected,
    omitted_attempted: omittedAttempted,
    registry_version: registry.version,
  };
}

function readTechniquePack(packId, { mode = "summary" } = {}) {
  const normalizedPackId = normalizeTechniquePackId(packId);
  const normalizedMode = mode == null ? "summary" : assertEnumValue(mode, ["summary", "full"], "mode");
  const registry = loadTechniqueRegistry();
  const pack = registry.packs.find((entry) => entry.id === normalizedPackId);
  if (!pack) {
    throw new Error(`Unknown technique pack id: ${normalizedPackId}`);
  }
  const summary = techniquePackSummary(pack);
  if (normalizedMode === "summary") {
    return {
      version: 1,
      mode: normalizedMode,
      source: registry.source ? path.basename(registry.source) : null,
      technique_pack: summary,
    };
  }
  return {
    version: 1,
    mode: normalizedMode,
    source: registry.source ? path.basename(registry.source) : null,
    technique_pack: {
      ...summary,
      full: {
        id: pack.id,
        version: pack.version,
        title: pack.title,
        capability_packs: pack.capability_packs.slice(),
        match: pack.match,
        techniques: pack.techniques.slice(),
        payload_hints: pack.payload_hints.slice(),
      },
    },
  };
}

function resolveSurfaceTechniqueRoute(domain, surface, requestedCapabilityPack = null) {
  const routesPath = surfaceRoutesPath(domain);
  let route = null;
  if (fs.existsSync(routesPath)) {
    try {
      const routesInfo = readSurfaceRoutesStrict(domain);
      route = routesInfo.document.routes.find((entry) => entry.surface_id === surface.id) || null;
    } catch {}
  }
  if (!route) {
    route = classifySurfaceCapability(surface);
  }

  const capabilityPack = requestedCapabilityPack || route.capability_pack;
  const pack = getCapabilityPack(capabilityPack);
  if (!pack) {
    throw new Error(`Unknown capability_pack: ${capabilityPack}`);
  }
  if (requestedCapabilityPack && route.capability_pack && requestedCapabilityPack !== route.capability_pack) {
    throw new Error(`surface_id ${surface.id} is routed to capability_pack ${route.capability_pack}`);
  }

  return {
    capability_pack: capabilityPack,
    capability_pack_version: route.capability_pack_version || pack.capability_pack_version,
    brief_profile: route.brief_profile || pack.brief_profile,
    hunter_agent: route.hunter_agent || pack.hunter_agent,
    context_budget: route.context_budget || { ...pack.context_budget },
  };
}

function selectTechniquePacks(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const surfaceId = assertNonEmptyString(args.surface_id, "surface_id");
  const requestedCapabilityPack = normalizeOptionalText(args.capability_pack, "capability_pack");
  const includeAttempted = args.include_attempted == null ? false : args.include_attempted;
  if (typeof includeAttempted !== "boolean") {
    throw new Error("include_attempted must be a boolean");
  }

  const attackSurface = readAttackSurfaceStrict(domain);
  const surface = attackSurface.document.surfaces.find((entry) => entry && entry.id === surfaceId);
  if (!surface) {
    throw new Error(`Unknown surface_id: ${surfaceId}`);
  }

  const route = resolveSurfaceTechniqueRoute(domain, surface, requestedCapabilityPack);
  const requestedLimit = normalizeOptionalInteger(args.max_packs, "max_packs", { min: 1, max: 50 });
  const maxPacks = Math.min(
    requestedLimit || route.context_budget.candidate_pack_limit,
    route.context_budget.candidate_pack_limit,
  );
  const attempts = readTechniqueAttemptRecordsFromJsonl(domain)
    .filter((record) => record.surface_id === surfaceId);
  const selected = selectTechniquePacksForSurface(surface, {
    capabilityPack: route.capability_pack,
    maxPacks,
    includeAttempted,
    attempts,
  });

  return JSON.stringify({
    version: 1,
    target_domain: domain,
    surface_id: surfaceId,
    capability_pack: route.capability_pack,
    capability_pack_version: route.capability_pack_version,
    brief_profile: route.brief_profile,
    context_budget: route.context_budget,
    max_packs: maxPacks,
    include_attempted: includeAttempted,
    technique_packs: selected.selected,
    attempts_summary: {
      total_for_surface: attempts.length,
      omitted_attempted: selected.omitted_attempted,
    },
  });
}

function fitKnowledgeEntries(entries, maxChars) {
  const selected = [];
  for (const entry of entries) {
    const candidate = selected.concat(entry);
    if (JSON.stringify(candidate).length > maxChars) break;
    selected.push(entry);
  }
  return selected;
}

function resolveHunterKnowledge(surface, {
  capabilityPack = "web",
  maxEntries = HUNTER_KNOWLEDGE_MAX_ENTRIES,
} = {}) {
  const selectedResult = selectTechniquePacksForSurface(surface, {
    capabilityPack,
    maxPacks: maxEntries,
    includeAttempted: true,
  });

  const slimEntries = selectedResult.selected
    .slice(0, maxEntries)
    .map((pack) => ({
      id: pack.id,
      title: pack.title,
      matched: pack.matched.slice(0, 6),
      techniques: pack.summary.guidance.slice(0, 4),
      payload_hints: pack.summary.payload_hints.slice(0, 4),
    }));
  const fittedEntries = fitKnowledgeEntries(slimEntries, HUNTER_KNOWLEDGE_MAX_CHARS);
  let techniques = [];
  let payloadHints = [];
  let charCount = 0;
  while (fittedEntries.length > 0) {
    techniques = fittedEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      matched: entry.matched,
      guidance: entry.techniques,
    }));
    payloadHints = fittedEntries
      .filter((entry) => entry.payload_hints.length > 0)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        hints: entry.payload_hints,
      }));
    charCount = JSON.stringify({ techniques, payload_hints: payloadHints }).length;
    if (charCount <= HUNTER_KNOWLEDGE_MAX_CHARS) break;
    fittedEntries.pop();
  }
  if (fittedEntries.length === 0) {
    techniques = [];
    payloadHints = [];
    charCount = 0;
  }

  return {
    techniques,
    payload_hints: payloadHints,
    knowledge_summary: {
      source: selectedResult.source ? path.basename(selectedResult.source) : null,
      entries_returned: fittedEntries.length,
      capped: slimEntries.length > fittedEntries.length,
      char_count: charCount,
      max_chars: HUNTER_KNOWLEDGE_MAX_CHARS,
    },
  };
}

function normalizeTechniqueAttemptRecord(record, { expectedDomain = null, lineNumber = null } = {}) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(lineNumber == null
      ? "technique attempt record must be an object"
      : `Malformed technique-attempts.jsonl at line ${lineNumber}: expected object`);
  }

  try {
    const attempt = {
      version: record.version == null
        ? 1
        : assertInteger(record.version, "version", { min: 1, max: 1 }),
      ts: assertNonEmptyString(record.ts, "ts"),
      target_domain: assertNonEmptyString(record.target_domain, "target_domain"),
      surface_id: assertNonEmptyString(record.surface_id, "surface_id"),
      pack_id: normalizeTechniquePackId(record.pack_id),
      status: assertEnumValue(record.status, TECHNIQUE_ATTEMPT_STATUS_VALUES, "status"),
      evidence: assertRequiredText(record.evidence, "evidence"),
    };

    const wave = normalizeOptionalText(record.wave, "wave");
    const agent = normalizeOptionalText(record.agent, "agent");
    const outcome = normalizeOptionalText(record.outcome, "outcome");
    if (wave) attempt.wave = parseWaveId(wave);
    if (agent) attempt.agent = parseAgentId(agent);
    if (outcome) attempt.outcome = outcome;
    if (expectedDomain != null && attempt.target_domain !== expectedDomain) {
      throw new Error("target_domain mismatch");
    }
    return attempt;
  } catch (error) {
    if (lineNumber == null) {
      throw error;
    }
    throw new Error(`Malformed technique-attempts.jsonl at line ${lineNumber}: ${error.message || String(error)}`);
  }
}

function readTechniqueAttemptRecordsFromJsonl(domain) {
  const filePath = techniqueAttemptsJsonlPath(domain);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    return [];
  }

  const records = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed technique-attempts.jsonl at line ${index + 1}: ${error.message || String(error)}`);
    }
    records.push(normalizeTechniqueAttemptRecord(parsed, {
      expectedDomain: domain,
      lineNumber: index + 1,
    }));
  }
  return records;
}

function summarizeTechniqueAttempt(record) {
  if (!record) return null;
  const summary = {
    pack_id: record.pack_id,
    status: record.status,
    ts: record.ts,
    evidence: record.evidence,
  };
  if (record.outcome) summary.outcome = record.outcome;
  if (record.wave) summary.wave = record.wave;
  if (record.agent) summary.agent = record.agent;
  if (record.surface_id) summary.surface_id = record.surface_id;
  return summary;
}

function logTechniqueAttempt(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const surfaceId = assertNonEmptyString(args.surface_id, "surface_id");
  const packId = normalizeTechniquePackId(args.pack_id);
  const status = assertEnumValue(args.status, TECHNIQUE_ATTEMPT_STATUS_VALUES, "status");
  const evidence = assertRequiredText(args.evidence, "evidence");
  if (evidence.length > 2000) {
    throw new Error("evidence must be at most 2000 characters");
  }
  const outcome = normalizeOptionalText(args.outcome, "outcome");
  if (outcome && outcome.length > 200) {
    throw new Error("outcome must be at most 200 characters");
  }

  const wave = normalizeOptionalText(args.wave, "wave");
  const agent = normalizeOptionalText(args.agent, "agent");
  if ((wave && !agent) || (agent && !wave)) {
    throw new Error("wave and agent must be provided together");
  }
  const parsedWave = wave ? parseWaveId(wave) : null;
  const parsedAgent = agent ? parseAgentId(agent) : null;

  readTechniquePack(packId, { mode: "summary" });
  const attackSurface = readAttackSurfaceStrict(domain);
  if (!attackSurface.surface_id_set.has(surfaceId)) {
    throw new Error(`Unknown surface_id: ${surfaceId}`);
  }
  if (parsedWave && parsedAgent) {
    validateAssignedWaveAgentSurface(domain, parsedWave, parsedAgent, surfaceId);
  }

  const record = normalizeTechniqueAttemptRecord({
    version: 1,
    ts: new Date().toISOString(),
    target_domain: domain,
    wave: parsedWave,
    agent: parsedAgent,
    surface_id: surfaceId,
    pack_id: packId,
    status,
    outcome,
    evidence,
  }, { expectedDomain: domain });

  return withSessionLock(domain, () => {
    const logPath = techniqueAttemptsJsonlPath(domain);
    appendJsonlLine(logPath, record, { maxRecords: TECHNIQUE_ATTEMPT_LOG_MAX_RECORDS });
    safeAppendPipelineEventDirect(domain, "technique_attempt_logged", {
      wave: parsedWave,
      agent: parsedAgent,
      surface_id: surfaceId,
      status,
      source: "bounty_log_technique_attempt",
      counts: {
        records: 1,
      },
    });
    return JSON.stringify({
      appended: 1,
      log_path: logPath,
      record: summarizeTechniqueAttempt(record),
    });
  });
}

module.exports = {
  HUNTER_KNOWLEDGE_FILE,
  HUNTER_KNOWLEDGE_MAX_CHARS,
  HUNTER_KNOWLEDGE_MAX_ENTRIES,
  loadHunterKnowledge,
  loadTechniqueRegistry,
  logTechniqueAttempt,
  normalizeTechniqueAttemptRecord,
  readTechniqueAttemptRecordsFromJsonl,
  readTechniquePack,
  resolveHunterKnowledge,
  scoreTechniqueEntry,
  selectTechniquePacks,
  selectTechniquePacksForSurface,
  summarizeTechniqueAttempt,
  techniquePackSummary,
};
