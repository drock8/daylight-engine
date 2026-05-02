"use strict";

const fs = require("fs");
const {
  readAttackSurfaceStrict,
} = require("./attack-surface.js");
const {
  surfaceRoutesPath,
} = require("./paths.js");
const {
  writeFileAtomic,
  readJsonFile,
  withSessionLock,
} = require("./storage.js");
const {
  assertNonEmptyString,
} = require("./validation.js");
const {
  classifySurfaceCapability,
} = require("./capability-packs.js");

const SURFACE_ROUTES_VERSION = 1;
const SURFACE_ROUTE_VERSION = 1;

function buildSurfaceRoutesDocument(domain, { attackSurfaceInfo = null } = {}) {
  const attackSurface = attackSurfaceInfo || readAttackSurfaceStrict(domain);
  const routes = [];
  const seenSurfaceIds = new Set();

  for (const surface of attackSurface.document.surfaces) {
    const surfaceId = assertNonEmptyString(surface.id, "surface.id");
    if (seenSurfaceIds.has(surfaceId)) continue;
    seenSurfaceIds.add(surfaceId);

    const classification = classifySurfaceCapability(surface);
    routes.push({
      surface_id: surfaceId,
      surface_type: classification.surface_type,
      capability_pack: classification.capability_pack,
      capability_pack_version: classification.capability_pack_version,
      hunter_agent: classification.hunter_agent,
      brief_profile: classification.brief_profile,
      context_budget: classification.context_budget,
      confidence: classification.confidence,
      reasons: classification.reasons,
    });
  }

  return {
    version: SURFACE_ROUTES_VERSION,
    route_version: SURFACE_ROUTE_VERSION,
    routes,
  };
}

function countRoutesByCapabilityPack(routes) {
  const counts = {};
  for (const route of routes) {
    counts[route.capability_pack] = (counts[route.capability_pack] || 0) + 1;
  }
  return counts;
}

function routeSurfacesInternal(domain, { attackSurfaceInfo = null } = {}) {
  const targetDomain = assertNonEmptyString(domain, "target_domain");
  const document = buildSurfaceRoutesDocument(targetDomain, { attackSurfaceInfo });
  const filePath = surfaceRoutesPath(targetDomain);
  writeFileAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);

  return {
    path: filePath,
    document,
    counts: countRoutesByCapabilityPack(document.routes),
  };
}

function readSurfaceRoutesStrict(domain) {
  const filePath = surfaceRoutesPath(domain);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing surface routes JSON: ${filePath}`);
  }
  let parsed;
  try {
    parsed = readJsonFile(filePath);
  } catch (error) {
    throw new Error(`Malformed surface routes JSON: ${filePath} (${error.message || String(error)})`);
  }
  if (
    parsed == null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.version !== SURFACE_ROUTES_VERSION ||
    parsed.route_version !== SURFACE_ROUTE_VERSION ||
    !Array.isArray(parsed.routes)
  ) {
    throw new Error(`Malformed surface routes JSON: ${filePath} (expected versioned routes document)`);
  }
  return { path: filePath, document: parsed };
}

function routeSurfaces(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  return withSessionLock(domain, () => {
    const routed = routeSurfacesInternal(domain);
    return JSON.stringify({
      version: SURFACE_ROUTES_VERSION,
      routed: true,
      target_domain: domain,
      route_version: SURFACE_ROUTE_VERSION,
      surface_count: routed.document.routes.length,
      counts: routed.counts,
      surface_routes_path: routed.path,
    });
  });
}

module.exports = {
  SURFACE_ROUTE_VERSION,
  SURFACE_ROUTES_VERSION,
  buildSurfaceRoutesDocument,
  countRoutesByCapabilityPack,
  readSurfaceRoutesStrict,
  routeSurfaces,
  routeSurfacesInternal,
};
