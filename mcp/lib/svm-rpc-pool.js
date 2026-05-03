"use strict";

// Public Solana JSON-RPC fallback ladder per cluster.
// Order matters — earlier endpoints are tried first.
//
// Override per cluster via env: BOB_SVM_RPCS_<CLUSTER>=url1,url2
//   - <CLUSTER> is uppercased and `-` is replaced with `_`. e.g. mainnet-beta
//     becomes BOB_SVM_RPCS_MAINNET_BETA.
// Override globally via env: BOB_SVM_RPCS_DEFAULT=url1,url2 (appended after
//                            cluster-specific overrides if no cluster match)
const DEFAULT_PUBLIC_RPC_LADDER = Object.freeze({
  // Solana mainnet-beta
  "mainnet-beta": Object.freeze([
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
    "https://solana.drpc.org",
  ]),
  // Solana devnet
  "devnet": Object.freeze([
    "https://api.devnet.solana.com",
    "https://solana-devnet-rpc.publicnode.com",
  ]),
  // Solana testnet
  "testnet": Object.freeze([
    "https://api.testnet.solana.com",
  ]),
});

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./, // link-local
  /^::1$/,
  /^fe80:/i,    // link-local v6
  /^fc00:/i, /^fd00:/i, // unique local v6
  /\.local$/i,
  /\.internal$/i,
];

function isPrivateHost(host) {
  if (!host) return false;
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isPublicHttpsUrl(value) {
  if (!isHttpsUrl(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

function envKeyForCluster(cluster) {
  // mainnet-beta → MAINNET_BETA
  return `BOB_SVM_RPCS_${String(cluster).toUpperCase().replace(/-/g, "_")}`;
}

function envOverride(cluster) {
  const key = envKeyForCluster(cluster);
  const raw = process.env[key];
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url)); // env overrides may include http for local dev
}

function defaultOverride() {
  const raw = process.env.BOB_SVM_RPCS_DEFAULT;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url));
}

function resolveSvmRpcEndpoints(cluster, { allowPrivate = false } = {}) {
  if (typeof cluster !== "string" || !cluster.trim()) {
    throw new Error(`cluster must be a non-empty string, received: ${cluster}`);
  }
  const normalizedCluster = cluster.trim();
  const fromEnv = envOverride(normalizedCluster);
  const defaults = DEFAULT_PUBLIC_RPC_LADDER[normalizedCluster] || [];
  const fromDefaultEnv = defaultOverride();

  const seen = new Set();
  const endpoints = [];

  // Priority: cluster-specific env > shipped defaults > global env fallback.
  for (const url of [...fromEnv, ...defaults, ...fromDefaultEnv]) {
    if (seen.has(url)) continue;
    if (!allowPrivate) {
      try {
        if (isPrivateHost(new URL(url).hostname)) continue;
      } catch {
        continue;
      }
    }
    seen.add(url);
    endpoints.push(url);
  }
  return endpoints;
}

function summarizeSvmPoolForBrief(cluster) {
  const normalizedCluster = typeof cluster === "string" ? cluster.trim() : null;
  if (!normalizedCluster) {
    return { chain_family: "svm", cluster: null, endpoints: [], note: "Set chain_id (cluster) on the surface for a populated RPC pool." };
  }
  let endpoints;
  try {
    endpoints = resolveSvmRpcEndpoints(normalizedCluster);
  } catch {
    endpoints = [];
  }
  // Cap the brief view at 6 endpoints (matches HUNTER_BRIEF_SURFACE_ARRAY_LIMITS.fork_rpc_pool).
  const trimmed = endpoints.slice(0, 6);
  const note = endpoints.length === 0
    ? `No default RPC ladder for cluster ${normalizedCluster}. Hunters must pass 'endpoints' explicitly to bounty_svm_* tools and 'fork_urls' to bounty_anchor_run. Operators can set ${envKeyForCluster(normalizedCluster)}=url1,url2 in the MCP server env (before launch) for a default.`
    : null;
  return {
    chain_family: "svm",
    cluster: normalizedCluster,
    endpoints: trimmed,
    truncated: endpoints.length > trimmed.length,
    note,
  };
}

module.exports = {
  DEFAULT_PUBLIC_RPC_LADDER,
  envKeyForCluster,
  isPrivateHost,
  isHttpsUrl,
  isPublicHttpsUrl,
  resolveSvmRpcEndpoints,
  summarizeSvmPoolForBrief,
};
