"use strict";

// Public Substrate JSON-RPC fallback ladder per network.
//
// Substrate nodes accept JSON-RPC over WebSocket primarily; HTTP is supported
// on most public infrastructure for read-only methods (state_getStorage,
// chain_getBlock, system_chain). Bob's substrate read tools and runner use
// HTTP because subprocesses don't share a WS lifecycle. Operators with
// WS-only deployments must run a local proxy or set BOB_SUBSTRATE_RPCS_<NET>
// to an HTTP-reachable upstream.
//
// Override per network via env: BOB_SUBSTRATE_RPCS_<NETWORK>=url1,url2
// Override globally via env: BOB_SUBSTRATE_RPCS_DEFAULT=url1,url2
const DEFAULT_PUBLIC_RPC_LADDER = Object.freeze({
  "polkadot": Object.freeze([
    "https://rpc.polkadot.io",
    "https://polkadot-rpc.dwellir.com",
    "https://polkadot.api.onfinality.io/public",
  ]),
  "kusama": Object.freeze([
    "https://kusama-rpc.polkadot.io",
    "https://kusama-rpc.dwellir.com",
    "https://kusama.api.onfinality.io/public",
  ]),
  "astar": Object.freeze([
    "https://astar.api.onfinality.io/public",
    "https://astar-rpc.dwellir.com",
  ]),
  "shiden": Object.freeze([
    "https://shiden.api.onfinality.io/public",
    "https://shiden-rpc.dwellir.com",
  ]),
  "rococo": Object.freeze([
    "https://rococo-rpc.polkadot.io",
  ]),
  "westend": Object.freeze([
    "https://westend-rpc.polkadot.io",
  ]),
  // localnet has no public default — operators must supply BOB_SUBSTRATE_RPCS_LOCALNET.
  "localnet": Object.freeze([]),
});

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i, /^fd00:/i,
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

function envKeyForNetwork(network) {
  return `BOB_SUBSTRATE_RPCS_${String(network).toUpperCase().replace(/-/g, "_")}`;
}

function envOverride(network) {
  const key = envKeyForNetwork(network);
  const raw = process.env[key];
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url));
}

function defaultOverride() {
  const raw = process.env.BOB_SUBSTRATE_RPCS_DEFAULT;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url));
}

function resolveSubstrateRpcEndpoints(network, { allowPrivate = false } = {}) {
  if (typeof network !== "string" || !network.trim()) {
    throw new Error(`network must be a non-empty string, received: ${network}`);
  }
  const normalizedNetwork = network.trim();
  const fromEnv = envOverride(normalizedNetwork);
  const defaults = DEFAULT_PUBLIC_RPC_LADDER[normalizedNetwork] || [];
  const fromDefaultEnv = defaultOverride();

  const seen = new Set();
  const endpoints = [];
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

function summarizeSubstratePoolForBrief(network) {
  const normalizedNetwork = typeof network === "string" ? network.trim() : null;
  if (!normalizedNetwork) {
    return { chain_family: "substrate", network: null, endpoints: [], note: "Set chain_id (network) on the surface for a populated RPC pool." };
  }
  let endpoints;
  try {
    endpoints = resolveSubstrateRpcEndpoints(normalizedNetwork);
  } catch {
    endpoints = [];
  }
  const trimmed = endpoints.slice(0, 6);
  const note = endpoints.length === 0
    ? `No default RPC ladder for network ${normalizedNetwork}. Hunters must pass 'endpoints' explicitly to bounty_substrate_* tools and 'fork_urls' to bounty_substrate_run. Operators can set ${envKeyForNetwork(normalizedNetwork)}=url1,url2 in the MCP server env (before launch) for a default.`
    : null;
  return {
    chain_family: "substrate",
    network: normalizedNetwork,
    endpoints: trimmed,
    truncated: endpoints.length > trimmed.length,
    note,
  };
}

module.exports = {
  DEFAULT_PUBLIC_RPC_LADDER,
  envKeyForNetwork,
  isPrivateHost,
  isHttpsUrl,
  isPublicHttpsUrl,
  resolveSubstrateRpcEndpoints,
  summarizeSubstratePoolForBrief,
};
