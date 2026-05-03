"use strict";

// Public CosmWasm REST API fallback ladder per network.
//
// Each Cosmos SDK chain hosts:
//   - Tendermint RPC (port 26657 by convention) for chain-level queries
//   - REST/LCD API (port 1317) for high-level queries including
//     /cosmwasm/wasm/v1/contract/{address} and /cosmwasm/wasm/v1/contract/{address}/smart/{base64-msg}
//
// Bob's cosmwasm read tools and runner use the REST API because that's where
// CosmWasm-specific queries live. The endpoint URL is the LCD/REST root —
// the client appends "/cosmwasm/wasm/v1/..." paths.
//
// Override per network via env: BOB_COSMWASM_RPCS_<NETWORK>=url1,url2
// Override globally via env: BOB_COSMWASM_RPCS_DEFAULT=url1,url2
const DEFAULT_PUBLIC_RPC_LADDER = Object.freeze({
  "osmosis": Object.freeze([
    "https://lcd.osmosis.zone",
    "https://osmosis-rest.publicnode.com",
    "https://osmosis-api.polkachu.com",
  ]),
  "juno": Object.freeze([
    "https://juno-api.polkachu.com",
    "https://lcd.juno.basementnodes.ca",
  ]),
  "neutron": Object.freeze([
    "https://rest-kralum.neutron-1.neutron.org",
    "https://neutron-api.polkachu.com",
  ]),
  "archway": Object.freeze([
    "https://api.mainnet.archway.io",
    "https://archway-api.polkachu.com",
  ]),
  "sei": Object.freeze([
    "https://sei-rest.brocha.in",
    "https://rest.sei-apis.com",
  ]),
  "stargaze": Object.freeze([
    "https://rest.stargaze-apis.com",
    "https://stargaze-api.polkachu.com",
  ]),
  "terra": Object.freeze([
    "https://phoenix-lcd.terra.dev",
    "https://terra-api.polkachu.com",
  ]),
  "kava": Object.freeze([
    "https://api.data.kava.io",
    "https://kava-api.polkachu.com",
  ]),
  // localnet has no public default — operators must supply BOB_COSMWASM_RPCS_LOCALNET.
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
  return `BOB_COSMWASM_RPCS_${String(network).toUpperCase().replace(/-/g, "_")}`;
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
  const raw = process.env.BOB_COSMWASM_RPCS_DEFAULT;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url));
}

function resolveCosmwasmRpcEndpoints(network, { allowPrivate = false } = {}) {
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

function summarizeCosmwasmPoolForBrief(network) {
  const normalizedNetwork = typeof network === "string" ? network.trim() : null;
  if (!normalizedNetwork) {
    return { chain_family: "cosmwasm", network: null, endpoints: [], note: "Set chain_id (network) on the surface for a populated RPC pool." };
  }
  let endpoints;
  try {
    endpoints = resolveCosmwasmRpcEndpoints(normalizedNetwork);
  } catch {
    endpoints = [];
  }
  const trimmed = endpoints.slice(0, 6);
  const note = endpoints.length === 0
    ? `No default REST ladder for network ${normalizedNetwork}. Hunters must pass 'endpoints' explicitly to bounty_cosmwasm_* tools and 'fork_urls' to bounty_cosmwasm_run. Operators can set ${envKeyForNetwork(normalizedNetwork)}=url1,url2 in the MCP server env (before launch) for a default.`
    : null;
  return {
    chain_family: "cosmwasm",
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
  resolveCosmwasmRpcEndpoints,
  summarizeCosmwasmPoolForBrief,
};
