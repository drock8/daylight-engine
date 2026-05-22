"use strict";

const crypto = require("crypto");
const fs = require("fs");
const {
  MOBILE_DEVICE_ACTION_VALUES,
  MOBILE_DEVICE_PROFILE_KIND_VALUES,
  MOBILE_PLATFORM_VALUES,
} = require("./constants.js");
const {
  assertEnumValue,
  assertInteger,
  assertNonEmptyString,
  normalizeOptionalText,
  normalizeStringArray,
} = require("./validation.js");
const {
  assertMobileDeviceLeaseId,
  assertMobileDeviceProfileId,
  mobileDeviceLeasesJsonlPath,
  mobileDeviceProfilesJsonlPath,
} = require("./paths.js");
const {
  appendJsonlLine,
  readFileUtf8,
  withSessionLock,
} = require("./storage.js");
const {
  readSessionStateStrict,
} = require("./session-state-store.js");

const MOBILE_DEVICE_PROFILE_LOG_MAX_RECORDS = 500;
const MOBILE_DEVICE_LEASE_LOG_MAX_RECORDS = 2_000;
const MOBILE_DEVICE_LEASE_DEFAULT_TTL_MS = 30 * 60 * 1000;
const MOBILE_DEVICE_LEASE_MAX_TTL_MS = 6 * 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function assertInitializedSession(domain) {
  readSessionStateStrict(domain);
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

function platformForProfileKind(profileKind) {
  if (profileKind.startsWith("android_")) return "android";
  if (profileKind.startsWith("ios_")) return "ios";
  throw new Error(`unsupported profile kind: ${profileKind}`);
}

function normalizeAuthorizedActions(value) {
  const actions = normalizeStringArray(value, "authorized_actions");
  const normalized = [];
  const seen = new Set();
  for (const action of actions) {
    const known = assertEnumValue(action, MOBILE_DEVICE_ACTION_VALUES, "authorized_actions[]");
    if (!seen.has(known)) {
      seen.add(known);
      normalized.push(known);
    }
  }
  return normalized;
}

function normalizeMobileDeviceProfileRecord(record, lineNumber = null) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(lineNumber == null
      ? "mobile device profile record must be an object"
      : `Malformed mobile-device-profiles.jsonl at line ${lineNumber}: expected object`);
  }
  try {
    const profileKind = assertEnumValue(record.profile_kind, MOBILE_DEVICE_PROFILE_KIND_VALUES, "profile_kind");
    const platform = record.platform == null
      ? platformForProfileKind(profileKind)
      : assertEnumValue(record.platform, MOBILE_PLATFORM_VALUES, "platform");
    if (platform !== platformForProfileKind(profileKind)) {
      throw new Error("platform does not match profile_kind");
    }
    return {
      version: record.version == null ? 1 : assertInteger(record.version, "version", { min: 1, max: 1 }),
      target_domain: assertNonEmptyString(record.target_domain, "target_domain"),
      profile_id: assertMobileDeviceProfileId(record.profile_id),
      platform,
      profile_kind: profileKind,
      label: assertNonEmptyString(record.label, "label"),
      device_identity_hash: assertNonEmptyString(record.device_identity_hash, "device_identity_hash"),
      authorized_actions: normalizeAuthorizedActions(record.authorized_actions),
      created_at: assertNonEmptyString(record.created_at, "created_at"),
      source: normalizeOptionalText(record.source, "source") || "operator",
      notes: normalizeOptionalText(record.notes, "notes"),
    };
  } catch (error) {
    if (lineNumber == null) throw error;
    throw new Error(`Malformed mobile-device-profiles.jsonl at line ${lineNumber}: ${error.message || String(error)}`);
  }
}

function readMobileDeviceProfilesFromJsonl(domain) {
  return readJsonlRecords(
    mobileDeviceProfilesJsonlPath(domain),
    "mobile-device-profiles.jsonl",
    (record, lineNumber) => normalizeMobileDeviceProfileRecord(record, lineNumber),
  ).filter((record) => record.target_domain === domain);
}

function nextProfileId(records) {
  let max = 0;
  for (const record of records) {
    const match = String(record.profile_id || "").match(/^MDP-([1-9]\d*)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `MDP-${max + 1}`;
}

function registerMobileDeviceProfile(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const profileKind = assertEnumValue(args.profile_kind, MOBILE_DEVICE_PROFILE_KIND_VALUES, "profile_kind");
  const platform = platformForProfileKind(profileKind);
  const label = assertNonEmptyString(args.label, "label");
  const identifierHint = normalizeOptionalText(args.device_identifier_hint, "device_identifier_hint") || label;
  const authorizedActions = normalizeAuthorizedActions(args.authorized_actions);
  const notes = normalizeOptionalText(args.notes, "notes");
  assertInitializedSession(domain);

  return withSessionLock(domain, () => {
    const records = readMobileDeviceProfilesFromJsonl(domain);
    const profileId = nextProfileId(records);
    const createdAt = new Date().toISOString();
    const record = normalizeMobileDeviceProfileRecord({
      version: 1,
      target_domain: domain,
      profile_id: profileId,
      platform,
      profile_kind: profileKind,
      label: label.slice(0, 120),
      device_identity_hash: sha256Hex(`${domain}\n${profileKind}\n${identifierHint}`),
      authorized_actions: authorizedActions,
      created_at: createdAt,
      source: "operator",
      notes,
    });
    appendJsonlLine(mobileDeviceProfilesJsonlPath(domain), record, {
      maxRecords: MOBILE_DEVICE_PROFILE_LOG_MAX_RECORDS,
    });
    return JSON.stringify({
      version: 1,
      target_domain: domain,
      registered: true,
      profile: record,
      profiles_path: mobileDeviceProfilesJsonlPath(domain),
    }, null, 2);
  });
}

function normalizeMobileDeviceLeaseRecord(record, lineNumber = null) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(lineNumber == null
      ? "mobile device lease record must be an object"
      : `Malformed mobile-device-leases.jsonl at line ${lineNumber}: expected object`);
  }
  try {
    const event = assertEnumValue(record.event || "acquired", ["acquired", "released"], "event");
    return {
      version: record.version == null ? 1 : assertInteger(record.version, "version", { min: 1, max: 1 }),
      target_domain: assertNonEmptyString(record.target_domain, "target_domain"),
      lease_id: assertMobileDeviceLeaseId(record.lease_id),
      profile_id: assertMobileDeviceProfileId(record.profile_id),
      event,
      purpose: assertNonEmptyString(record.purpose, "purpose"),
      acquired_at: assertNonEmptyString(record.acquired_at, "acquired_at"),
      expires_at: assertNonEmptyString(record.expires_at, "expires_at"),
      released_at: normalizeOptionalText(record.released_at, "released_at"),
    };
  } catch (error) {
    if (lineNumber == null) throw error;
    throw new Error(`Malformed mobile-device-leases.jsonl at line ${lineNumber}: ${error.message || String(error)}`);
  }
}

function readMobileDeviceLeaseRecordsFromJsonl(domain) {
  return readJsonlRecords(
    mobileDeviceLeasesJsonlPath(domain),
    "mobile-device-leases.jsonl",
    (record, lineNumber) => normalizeMobileDeviceLeaseRecord(record, lineNumber),
  ).filter((record) => record.target_domain === domain);
}

function nextLeaseId(records) {
  let max = 0;
  for (const record of records) {
    const match = String(record.lease_id || "").match(/^MDL-([1-9]\d*)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `MDL-${max + 1}`;
}

function activeMobileDeviceLeases(records, now = Date.now()) {
  const released = new Set(records.filter((record) => record.event === "released").map((record) => record.lease_id));
  return records
    .filter((record) => record.event === "acquired")
    .filter((record) => !released.has(record.lease_id))
    .filter((record) => Date.parse(record.expires_at) > now);
}

function acquireMobileDeviceLease(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const profileId = assertMobileDeviceProfileId(args.profile_id);
  const purpose = assertNonEmptyString(args.purpose, "purpose");
  const ttlMs = args.ttl_ms == null
    ? MOBILE_DEVICE_LEASE_DEFAULT_TTL_MS
    : assertInteger(args.ttl_ms, "ttl_ms", { min: 1_000, max: MOBILE_DEVICE_LEASE_MAX_TTL_MS });
  assertInitializedSession(domain);

  return withSessionLock(domain, () => {
    const profile = readMobileDeviceProfilesFromJsonl(domain).find((record) => record.profile_id === profileId);
    if (!profile) throw new Error(`Mobile device profile ${profileId} not found for ${domain}`);
    const leases = readMobileDeviceLeaseRecordsFromJsonl(domain);
    const conflicting = activeMobileDeviceLeases(leases).find((lease) => lease.profile_id === profileId);
    if (conflicting) {
      throw new Error(`Mobile device profile ${profileId} already has active lease ${conflicting.lease_id}`);
    }
    const acquiredAt = new Date();
    const lease = normalizeMobileDeviceLeaseRecord({
      version: 1,
      target_domain: domain,
      lease_id: nextLeaseId(leases),
      profile_id: profileId,
      event: "acquired",
      purpose: purpose.slice(0, 200),
      acquired_at: acquiredAt.toISOString(),
      expires_at: new Date(acquiredAt.getTime() + ttlMs).toISOString(),
    });
    appendJsonlLine(mobileDeviceLeasesJsonlPath(domain), lease, {
      maxRecords: MOBILE_DEVICE_LEASE_LOG_MAX_RECORDS,
    });
    return JSON.stringify({
      version: 1,
      target_domain: domain,
      acquired: true,
      lease,
      leases_path: mobileDeviceLeasesJsonlPath(domain),
    }, null, 2);
  });
}

function releaseMobileDeviceLease(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const leaseId = assertMobileDeviceLeaseId(args.lease_id);
  assertInitializedSession(domain);

  return withSessionLock(domain, () => {
    const leases = readMobileDeviceLeaseRecordsFromJsonl(domain);
    const acquired = leases.find((record) => record.lease_id === leaseId && record.event === "acquired");
    if (!acquired) throw new Error(`Mobile device lease ${leaseId} not found for ${domain}`);
    const alreadyReleased = leases.some((record) => record.lease_id === leaseId && record.event === "released");
    if (alreadyReleased) {
      return JSON.stringify({
        version: 1,
        target_domain: domain,
        released: false,
        already_released: true,
        lease_id: leaseId,
      }, null, 2);
    }
    const release = normalizeMobileDeviceLeaseRecord({
      ...acquired,
      event: "released",
      released_at: new Date().toISOString(),
    });
    appendJsonlLine(mobileDeviceLeasesJsonlPath(domain), release, {
      maxRecords: MOBILE_DEVICE_LEASE_LOG_MAX_RECORDS,
    });
    return JSON.stringify({
      version: 1,
      target_domain: domain,
      released: true,
      lease_id: leaseId,
      profile_id: release.profile_id,
      leases_path: mobileDeviceLeasesJsonlPath(domain),
    }, null, 2);
  });
}

function listMobileDeviceProfiles(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  assertInitializedSession(domain);
  const profiles = readMobileDeviceProfilesFromJsonl(domain);
  const activeLeases = activeMobileDeviceLeases(readMobileDeviceLeaseRecordsFromJsonl(domain));
  const leaseByProfile = new Map(activeLeases.map((lease) => [lease.profile_id, lease]));
  return JSON.stringify({
    version: 1,
    target_domain: domain,
    profiles_path: mobileDeviceProfilesJsonlPath(domain),
    leases_path: mobileDeviceLeasesJsonlPath(domain),
    profiles: profiles.map((profile) => ({
      ...profile,
      active_lease: leaseByProfile.get(profile.profile_id) || null,
    })),
  }, null, 2);
}

function summarizeMobileDeviceProfilesForBrief(domain, platform = null) {
  const profiles = readMobileDeviceProfilesFromJsonl(domain)
    .filter((profile) => !platform || profile.platform === platform);
  const activeLeases = activeMobileDeviceLeases(readMobileDeviceLeaseRecordsFromJsonl(domain));
  const leaseByProfile = new Map(activeLeases.map((lease) => [lease.profile_id, lease]));
  return {
    available: profiles.length > 0,
    total: profiles.length,
    profiles: profiles.slice(0, 10).map((profile) => ({
      profile_id: profile.profile_id,
      platform: profile.platform,
      profile_kind: profile.profile_kind,
      label: profile.label,
      authorized_actions: profile.authorized_actions,
      active_lease: leaseByProfile.get(profile.profile_id) || null,
    })),
  };
}

module.exports = {
  MOBILE_DEVICE_LEASE_DEFAULT_TTL_MS,
  acquireMobileDeviceLease,
  activeMobileDeviceLeases,
  listMobileDeviceProfiles,
  normalizeMobileDeviceLeaseRecord,
  normalizeMobileDeviceProfileRecord,
  readMobileDeviceLeaseRecordsFromJsonl,
  readMobileDeviceProfilesFromJsonl,
  registerMobileDeviceProfile,
  releaseMobileDeviceLease,
  summarizeMobileDeviceProfilesForBrief,
};
