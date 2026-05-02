"use strict";

const fs = require("fs");
const {
  assertNonEmptyString,
  normalizeOptionalText,
} = require("./validation.js");
const {
  readAttackSurfaceStrict,
} = require("./attack-surface.js");
const {
  surfaceRoutesPath,
} = require("./paths.js");
const {
  readJsonFile,
} = require("./storage.js");
const {
  getCapabilityPack,
  getCapabilityPackContextBudget,
} = require("./capability-packs.js");

function getContextBudget(args) {
  const capabilityPack = assertNonEmptyString(args.capability_pack, "capability_pack");
  const pack = getCapabilityPack(capabilityPack);
  if (!pack) {
    throw new Error(`Unknown capability_pack: ${capabilityPack}`);
  }

  const targetDomain = normalizeOptionalText(args.target_domain, "target_domain");
  const surfaceId = normalizeOptionalText(args.surface_id, "surface_id");
  let briefProfile = normalizeOptionalText(args.brief_profile, "brief_profile") || pack.brief_profile;

  if (briefProfile !== pack.brief_profile) {
    throw new Error(`brief_profile ${briefProfile} does not match capability_pack ${capabilityPack}`);
  }

  if (targetDomain && surfaceId) {
    const attackSurface = readAttackSurfaceStrict(targetDomain);
    if (!attackSurface.surface_id_set.has(surfaceId)) {
      throw new Error(`Unknown surface_id: ${surfaceId}`);
    }

    const routesPath = surfaceRoutesPath(targetDomain);
    if (fs.existsSync(routesPath)) {
      const routes = readJsonFile(routesPath);
      const route = routes && Array.isArray(routes.routes)
        ? routes.routes.find((entry) => entry.surface_id === surfaceId)
        : null;
      if (route) {
        if (route.capability_pack !== capabilityPack) {
          throw new Error(`surface_id ${surfaceId} is routed to capability_pack ${route.capability_pack}`);
        }
        if (route.brief_profile) briefProfile = route.brief_profile;
      }
    }
  }

  return JSON.stringify({
    version: 1,
    capability_pack: capabilityPack,
    capability_pack_version: pack.capability_pack_version,
    brief_profile: briefProfile,
    context_budget: getCapabilityPackContextBudget(capabilityPack),
  });
}

module.exports = {
  getContextBudget,
};
