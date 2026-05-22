"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  MOBILE_ARTIFACT_LOG_MAX_RECORDS,
  MOBILE_ARTIFACT_MAX_BYTES,
  MOBILE_ARTIFACT_TYPE_VALUES,
  MOBILE_BACKEND_LEAD_MAX_ITEMS,
  MOBILE_PLATFORM_VALUES,
  MOBILE_STATIC_SCAN_HINT_MAX_ITEMS,
  MOBILE_STATIC_SCAN_RESULTS_MAX_RECORDS,
} = require("./constants.js");
const {
  assertEnumValue,
  assertInteger,
  assertNonEmptyString,
  normalizeOptionalText,
} = require("./validation.js");
const {
  assertMobileArtifactId,
  mobileArtifactImportDir,
  mobileArtifactPath,
  mobileArtifactsJsonlPath,
  mobileStaticScanResultsJsonlPath,
} = require("./paths.js");
const {
  appendJsonlLine,
  readFileUtf8,
  withSessionLock,
  writeFileAtomic,
} = require("./storage.js");
const {
  readSessionStateStrict,
} = require("./session-state-store.js");
const {
  redactStaticArtifactContent,
} = require("./static-artifacts.js");

const ANDROID_ARTIFACT_TYPES = new Set(["android_apk", "android_aab", "android_xapk"]);
const IOS_ARTIFACT_TYPES = new Set(["ios_ipa", "ios_app_bundle"]);
const MOBILE_STATIC_SCAN_TYPE_VALUES = Object.freeze(["android_static_mvp"]);
const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g;
const ANDROID_PERMISSION_RE = /android\.permission\.[A-Z0-9_.]+/g;
const JAVA_PACKAGE_RE = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}\b/g;
const ASCII_STRING_RE = /[\x20-\x7e]{4,}/g;

function platformForArtifactType(artifactType) {
  if (ANDROID_ARTIFACT_TYPES.has(artifactType)) return "android";
  if (IOS_ARTIFACT_TYPES.has(artifactType)) return "ios";
  throw new Error(`unsupported mobile artifact type: ${artifactType}`);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeDisplayName(value, fieldName) {
  const normalized = normalizeOptionalText(value, fieldName);
  if (!normalized) return null;
  return path.basename(normalized).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || null;
}

function assertInitializedSession(domain) {
  readSessionStateStrict(domain);
}

function decodeBase64Content(value) {
  const raw = assertNonEmptyString(value, "content_base64").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new Error("content_base64 must be valid standard base64");
  }
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length < 1) {
    throw new Error("content_base64 decoded to an empty artifact");
  }
  if (buffer.length > MOBILE_ARTIFACT_MAX_BYTES) {
    throw new Error(`mobile artifact exceeds cap of ${MOBILE_ARTIFACT_MAX_BYTES} bytes`);
  }
  return buffer;
}

function readJsonlRecords(filePath, label, normalizer) {
  if (!fs.existsSync(filePath)) return [];
  const content = readFileUtf8(filePath, { label, maxBytes: null });
  if (!content.trim()) return [];
  const records = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed ${label} at line ${index + 1}: ${error.message || String(error)}`);
    }
    records.push(normalizer(parsed, index + 1));
  }
  return records;
}

function normalizeMobileArtifactRecord(record, lineNumber = null) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(lineNumber == null
      ? "mobile artifact record must be an object"
      : `Malformed mobile-artifacts.jsonl at line ${lineNumber}: expected object`);
  }
  try {
    const artifactType = assertEnumValue(record.artifact_type, MOBILE_ARTIFACT_TYPE_VALUES, "artifact_type");
    const platform = record.platform == null
      ? platformForArtifactType(artifactType)
      : assertEnumValue(record.platform, MOBILE_PLATFORM_VALUES, "platform");
    if (platform !== platformForArtifactType(artifactType)) {
      throw new Error("platform does not match artifact_type");
    }
    return {
      version: record.version == null ? 1 : assertInteger(record.version, "version", { min: 1, max: 1 }),
      target_domain: assertNonEmptyString(record.target_domain, "target_domain"),
      mobile_artifact_id: assertMobileArtifactId(record.mobile_artifact_id),
      artifact_type: artifactType,
      platform,
      label: normalizeOptionalText(record.label, "label"),
      source_name: normalizeOptionalText(record.source_name, "source_name"),
      surface_id: normalizeOptionalText(record.surface_id, "surface_id"),
      app_id: normalizeOptionalText(record.app_id, "app_id"),
      app_version: normalizeOptionalText(record.app_version, "app_version"),
      imported_at: assertNonEmptyString(record.imported_at, "imported_at"),
      content_sha256: assertNonEmptyString(record.content_sha256, "content_sha256"),
      byte_size: assertInteger(record.byte_size, "byte_size", { min: 1, max: MOBILE_ARTIFACT_MAX_BYTES }),
      retention_class: normalizeOptionalText(record.retention_class, "retention_class") || "session_large_binary",
      storage_mode: normalizeOptionalText(record.storage_mode, "storage_mode") || "copied_binary",
      artifact_path: normalizeOptionalText(record.artifact_path, "artifact_path"),
      redactions: assertInteger(record.redactions || 0, "redactions", { min: 0 }),
    };
  } catch (error) {
    if (lineNumber == null) throw error;
    throw new Error(`Malformed mobile-artifacts.jsonl at line ${lineNumber}: ${error.message || String(error)}`);
  }
}

function readMobileArtifactRecordsFromJsonl(domain) {
  return readJsonlRecords(
    mobileArtifactsJsonlPath(domain),
    "mobile-artifacts.jsonl",
    (record, lineNumber) => normalizeMobileArtifactRecord(record, lineNumber),
  ).filter((record) => record.target_domain === domain);
}

function nextMobileArtifactId(records) {
  let max = 0;
  for (const record of records) {
    const match = String(record.mobile_artifact_id || "").match(/^MA-([1-9]\d*)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `MA-${max + 1}`;
}

function importMobileArtifact(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const artifactType = assertEnumValue(args.artifact_type, MOBILE_ARTIFACT_TYPE_VALUES, "artifact_type");
  const platform = platformForArtifactType(artifactType);
  const content = decodeBase64Content(args.content_base64);
  const label = normalizeDisplayName(args.label, "label");
  const sourceName = normalizeDisplayName(args.source_name, "source_name");
  const surfaceId = normalizeOptionalText(args.surface_id, "surface_id");
  const appId = normalizeOptionalText(args.app_id, "app_id");
  const appVersion = normalizeOptionalText(args.app_version, "app_version");
  assertInitializedSession(domain);

  return withSessionLock(domain, () => {
    const records = readMobileArtifactRecordsFromJsonl(domain);
    const mobileArtifactId = nextMobileArtifactId(records);
    const artifactPath = mobileArtifactPath(domain, mobileArtifactId);
    writeFileAtomic(artifactPath, content);
    const record = normalizeMobileArtifactRecord({
      version: 1,
      target_domain: domain,
      mobile_artifact_id: mobileArtifactId,
      artifact_type: artifactType,
      platform,
      label,
      source_name: sourceName,
      surface_id: surfaceId,
      app_id: appId,
      app_version: appVersion,
      imported_at: new Date().toISOString(),
      content_sha256: sha256Hex(content),
      byte_size: content.length,
      retention_class: "session_large_binary",
      storage_mode: "copied_binary",
      artifact_path: artifactPath,
      redactions: 0,
    });
    appendJsonlLine(mobileArtifactsJsonlPath(domain), record, { maxRecords: MOBILE_ARTIFACT_LOG_MAX_RECORDS });
    return JSON.stringify({
      version: 1,
      target_domain: domain,
      mobile_artifact_id: mobileArtifactId,
      artifact_type: artifactType,
      platform,
      byte_size: content.length,
      content_sha256: record.content_sha256,
      artifact_path: artifactPath,
      manifest_path: mobileArtifactsJsonlPath(domain),
      retention_class: record.retention_class,
    }, null, 2);
  });
}

function stringsFromBuffer(buffer) {
  const raw = buffer.toString("latin1");
  const strings = raw.match(ASCII_STRING_RE) || [];
  return strings.slice(0, 5000).join("\n");
}

function textForStaticScan(buffer) {
  const ascii = stringsFromBuffer(buffer);
  return redactStaticArtifactContent(ascii).content;
}

function unique(values, limit) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function extractPackageName(text, artifact) {
  const manifestMatch = text.match(/\bpackage\s*=\s*["']([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){2,})["']/);
  if (manifestMatch) return manifestMatch[1];
  if (artifact.app_id) return artifact.app_id;
  const candidates = unique(text.match(JAVA_PACKAGE_RE) || [], 20)
    .filter((item) => !item.startsWith("android.") && !item.startsWith("java."));
  return candidates[0] || null;
}

function extractAndroidStaticFacts(text, artifact) {
  const endpoints = unique(text.match(URL_RE) || [], 80);
  const permissions = unique(text.match(ANDROID_PERMISSION_RE) || [], 80);
  const deeplinks = unique([
    ...(text.match(/[a-z][a-z0-9+.-]+:\/\/[^\s"'<>]+/gi) || []),
    ...Array.from(text.matchAll(/android:scheme\s*=\s*["']([^"']+)["'][\s\S]{0,200}?android:host\s*=\s*["']([^"']+)["']/g))
      .map((match) => `${match[1]}://${match[2]}`),
  ], 80);
  const exportedComponentLines = text.split(/\r?\n/)
    .filter((line) => /android:exported\s*=\s*["']true["']/i.test(line))
    .slice(0, 40)
    .map((line) => line.trim().slice(0, 300));
  const packageName = extractPackageName(text, artifact);
  const cleartextTraffic = /usesCleartextTraffic\s*=\s*["']true["']|cleartextTrafficPermitted\s*=\s*["']true["']/i.test(text);
  return {
    package_name: packageName,
    endpoints,
    permissions,
    deeplinks,
    exported_components: exportedComponentLines,
    cleartext_traffic_enabled: cleartextTraffic,
  };
}

function hostAllowed(hostname, allowedHosts) {
  const host = String(hostname || "").toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function normalizedAllowedHosts(targetDomain, extraHosts = []) {
  return unique([targetDomain, ...extraHosts].map((host) => String(host || "").toLowerCase().replace(/^\*\./, "")), 50);
}

function qualifyMobileBackendLeads({ endpoints, targetDomain, allowedHosts = [], sourceArtifactId, surfaceId }) {
  const allowlist = normalizedAllowedHosts(targetDomain, allowedHosts);
  const byKey = new Map();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      continue;
    }
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    const host = parsed.hostname.toLowerCase();
    if (!hostAllowed(host, allowlist)) continue;
    const pathShape = parsed.pathname
      .replace(/[0-9a-f]{16,}/gi, "{hex}")
      .replace(/\b\d+\b/g, "{int}");
    const key = `${parsed.protocol}//${host}${pathShape}`;
    if (byKey.has(key)) continue;
    const confidence = host === targetDomain ? "high" : "medium";
    byKey.set(key, {
      title: `Mobile backend endpoint ${host}`,
      hosts: [host],
      endpoints: [parsed.toString()],
      surface_type: "api",
      bug_class_hints: ["mobile_backend", "authz", "idor"],
      high_value_flows: ["Replay mobile-discovered endpoint through web/API hunting with scoped auth profiles."],
      evidence: [`mobile artifact ${sourceArtifactId}${surfaceId ? ` from surface ${surfaceId}` : ""}`],
      confidence,
      score: confidence === "high" ? 72 : 58,
      priority: confidence === "high" ? "HIGH" : "MEDIUM",
      promote: confidence === "high",
    });
    if (byKey.size >= MOBILE_BACKEND_LEAD_MAX_ITEMS) break;
  }
  return Array.from(byKey.values());
}

function buildAndroidStaticHints(facts, artifactId) {
  const hints = [];
  for (const line of facts.exported_components.slice(0, MOBILE_STATIC_SCAN_HINT_MAX_ITEMS)) {
    hints.push({
      risk: "medium",
      risk_class: "exported_component",
      title: "Exported Android component requires manual validation",
      evidence: line,
      mobile_artifact_id: artifactId,
      reproduction_limit: "static_only",
    });
  }
  if (facts.cleartext_traffic_enabled) {
    hints.push({
      risk: "low",
      risk_class: "network_config",
      title: "Cleartext traffic appears enabled",
      evidence: "usesCleartextTraffic or cleartextTrafficPermitted is true",
      mobile_artifact_id: artifactId,
      reproduction_limit: "static_only",
    });
  }
  for (const deeplink of facts.deeplinks.slice(0, Math.max(0, MOBILE_STATIC_SCAN_HINT_MAX_ITEMS - hints.length))) {
    hints.push({
      risk: "info",
      risk_class: "deeplink",
      title: "Deep link discovered",
      evidence: deeplink,
      mobile_artifact_id: artifactId,
      reproduction_limit: "static_only",
    });
  }
  return hints.slice(0, MOBILE_STATIC_SCAN_HINT_MAX_ITEMS);
}

function normalizeMobileStaticScanRecord(record, lineNumber = null) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(lineNumber == null
      ? "mobile static scan record must be an object"
      : `Malformed mobile-static-scan-results.jsonl at line ${lineNumber}: expected object`);
  }
  try {
    return {
      version: record.version == null ? 1 : assertInteger(record.version, "version", { min: 1, max: 1 }),
      target_domain: assertNonEmptyString(record.target_domain, "target_domain"),
      mobile_artifact_id: assertMobileArtifactId(record.mobile_artifact_id),
      scan_type: assertEnumValue(record.scan_type, MOBILE_STATIC_SCAN_TYPE_VALUES, "scan_type"),
      platform: assertEnumValue(record.platform, ["android"], "platform"),
      surface_id: normalizeOptionalText(record.surface_id, "surface_id"),
      scanned_at: assertNonEmptyString(record.scanned_at, "scanned_at"),
      analyzer_version: normalizeOptionalText(record.analyzer_version, "analyzer_version") || "android_static_mvp_v1",
      package_name: normalizeOptionalText(record.package_name, "package_name"),
      endpoints: unique(record.endpoints || [], 80),
      permissions: unique(record.permissions || [], 80),
      deeplinks: unique(record.deeplinks || [], 80),
      exported_components: unique(record.exported_components || [], 40),
      cleartext_traffic_enabled: !!record.cleartext_traffic_enabled,
      hints: Array.isArray(record.hints) ? record.hints.slice(0, MOBILE_STATIC_SCAN_HINT_MAX_ITEMS) : [],
      backend_leads: Array.isArray(record.backend_leads) ? record.backend_leads.slice(0, MOBILE_BACKEND_LEAD_MAX_ITEMS) : [],
    };
  } catch (error) {
    if (lineNumber == null) throw error;
    throw new Error(`Malformed mobile-static-scan-results.jsonl at line ${lineNumber}: ${error.message || String(error)}`);
  }
}

function readMobileStaticScanResultsFromJsonl(domain) {
  return readJsonlRecords(
    mobileStaticScanResultsJsonlPath(domain),
    "mobile-static-scan-results.jsonl",
    (record, lineNumber) => normalizeMobileStaticScanRecord(record, lineNumber),
  ).filter((record) => record.target_domain === domain);
}

function androidStaticScan(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const mobileArtifactId = assertMobileArtifactId(args.mobile_artifact_id);
  const allowedHosts = Array.isArray(args.allowed_hosts) ? args.allowed_hosts : [];
  assertInitializedSession(domain);

  return withSessionLock(domain, () => {
    const artifact = readMobileArtifactRecordsFromJsonl(domain).find((record) => record.mobile_artifact_id === mobileArtifactId);
    if (!artifact) throw new Error(`Mobile artifact ${mobileArtifactId} not found for ${domain}`);
    if (artifact.platform !== "android") {
      throw new Error(`Mobile artifact ${mobileArtifactId} is not an Android artifact`);
    }
    const artifactPath = mobileArtifactPath(domain, mobileArtifactId);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Missing imported mobile artifact file: ${artifactPath}`);
    }
    const buffer = fs.readFileSync(artifactPath);
    const text = textForStaticScan(buffer);
    const facts = extractAndroidStaticFacts(text, artifact);
    const backendLeads = qualifyMobileBackendLeads({
      endpoints: facts.endpoints,
      targetDomain: domain,
      allowedHosts,
      sourceArtifactId: mobileArtifactId,
      surfaceId: artifact.surface_id,
    });
    const record = normalizeMobileStaticScanRecord({
      version: 1,
      target_domain: domain,
      mobile_artifact_id: mobileArtifactId,
      scan_type: "android_static_mvp",
      platform: "android",
      surface_id: artifact.surface_id,
      scanned_at: new Date().toISOString(),
      analyzer_version: "android_static_mvp_v1",
      package_name: facts.package_name,
      endpoints: facts.endpoints,
      permissions: facts.permissions,
      deeplinks: facts.deeplinks,
      exported_components: facts.exported_components,
      cleartext_traffic_enabled: facts.cleartext_traffic_enabled,
      hints: buildAndroidStaticHints(facts, mobileArtifactId),
      backend_leads: backendLeads,
    });
    appendJsonlLine(mobileStaticScanResultsJsonlPath(domain), record, {
      maxRecords: MOBILE_STATIC_SCAN_RESULTS_MAX_RECORDS,
    });
    return JSON.stringify({
      ...record,
      endpoints_shown: record.endpoints.length,
      backend_leads_shown: record.backend_leads.length,
      results_path: mobileStaticScanResultsJsonlPath(domain),
    }, null, 2);
  });
}

function summarizeMobileArtifactsForSurface(domain, { surface = null, limit = MOBILE_STATIC_SCAN_HINT_MAX_ITEMS } = {}) {
  const normalizedLimit = limit == null
    ? MOBILE_STATIC_SCAN_HINT_MAX_ITEMS
    : assertInteger(limit, "limit", { min: 0, max: MOBILE_STATIC_SCAN_HINT_MAX_ITEMS });
  const surfaceId = surface && surface.id ? String(surface.id) : null;
  const artifacts = readMobileArtifactRecordsFromJsonl(domain)
    .filter((record) => !surfaceId || !record.surface_id || record.surface_id === surfaceId)
    .slice(-normalizedLimit)
    .reverse();
  const scans = readMobileStaticScanResultsFromJsonl(domain)
    .filter((record) => !surfaceId || !record.surface_id || record.surface_id === surfaceId)
    .sort((a, b) => Date.parse(b.scanned_at) - Date.parse(a.scanned_at))
    .slice(0, normalizedLimit);

  return {
    available: artifacts.length > 0 || scans.length > 0,
    artifacts_total: artifacts.length,
    scans_total: scans.length,
    cap: normalizedLimit,
    artifacts: artifacts.map((artifact) => ({
      mobile_artifact_id: artifact.mobile_artifact_id,
      artifact_type: artifact.artifact_type,
      platform: artifact.platform,
      label: artifact.label,
      source_name: artifact.source_name,
      surface_id: artifact.surface_id,
      app_id: artifact.app_id,
      app_version: artifact.app_version,
      content_sha256: artifact.content_sha256,
      byte_size: artifact.byte_size,
      imported_at: artifact.imported_at,
      retention_class: artifact.retention_class,
    })),
    static_scan_hints: scans.map((scan) => ({
      mobile_artifact_id: scan.mobile_artifact_id,
      scan_type: scan.scan_type,
      analyzer_version: scan.analyzer_version,
      package_name: scan.package_name,
      scanned_at: scan.scanned_at,
      permissions_count: scan.permissions.length,
      deeplinks_count: scan.deeplinks.length,
      endpoints_count: scan.endpoints.length,
      backend_leads_count: scan.backend_leads.length,
      hints: scan.hints,
      backend_leads: scan.backend_leads,
    })),
  };
}

module.exports = {
  androidStaticScan,
  importMobileArtifact,
  normalizeMobileArtifactRecord,
  normalizeMobileStaticScanRecord,
  qualifyMobileBackendLeads,
  readMobileArtifactRecordsFromJsonl,
  readMobileStaticScanResultsFromJsonl,
  summarizeMobileArtifactsForSurface,
};
