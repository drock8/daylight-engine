"use strict";

// Public archive RPC fallback ladder per major EVM chain.
// Order matters — earlier endpoints are tried first. All entries are full
// archive nodes that support eth_call at historical blocks.
//
// Override per chain via env: BOB_EVM_RPCS_<CHAIN_ID>=url1,url2
// Override globally via env: BOB_EVM_RPCS_DEFAULT=url1,url2 (appended after
//                            chain-specific overrides if no chain match)
const DEFAULT_PUBLIC_RPC_LADDER = Object.freeze({
  // Ethereum
  1: Object.freeze([
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
  ]),
  // Optimism
  10: Object.freeze([
    "https://optimism-rpc.publicnode.com",
    "https://op.llamarpc.com",
    "https://1rpc.io/op",
  ]),
  // BNB Smart Chain
  56: Object.freeze([
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed.binance.org",
  ]),
  // Polygon
  137: Object.freeze([
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon-rpc.com",
  ]),
  // zkSync Era
  324: Object.freeze([
    "https://zksync-mainnet.zksync.io",
    "https://1rpc.io/zksync2-era",
  ]),
  // Base
  8453: Object.freeze([
    "https://base-rpc.publicnode.com",
    "https://base.llamarpc.com",
    "https://1rpc.io/base",
  ]),
  // Arbitrum One
  42161: Object.freeze([
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
    "https://1rpc.io/arb",
  ]),
  // Avalanche C-chain
  43114: Object.freeze([
    "https://avalanche-c-chain-rpc.publicnode.com",
    "https://1rpc.io/avax/c",
  ]),
  // Linea
  59144: Object.freeze([
    "https://linea-rpc.publicnode.com",
    "https://1rpc.io/linea",
  ]),
  // Scroll
  534352: Object.freeze([
    "https://scroll-rpc.publicnode.com",
    "https://1rpc.io/scroll",
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

function envOverride(chainId) {
  const key = `BOB_EVM_RPCS_${chainId}`;
  const raw = process.env[key];
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url)); // env overrides may include http for local dev
}

function defaultOverride() {
  const raw = process.env.BOB_EVM_RPCS_DEFAULT;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => isHttpsUrl(url));
}

function resolveEvmRpcEndpoints(chainId, { allowPrivate = false } = {}) {
  const numericChainId = Number(chainId);
  if (!Number.isInteger(numericChainId) || numericChainId <= 0) {
    throw new Error(`chainId must be a positive integer, received: ${chainId}`);
  }
  const fromEnv = envOverride(numericChainId);
  const defaults = DEFAULT_PUBLIC_RPC_LADDER[numericChainId] || [];
  const fromDefaultEnv = defaultOverride();

  const seen = new Set();
  const endpoints = [];

  // Priority: chain-specific env > shipped defaults > global env fallback.
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

function summarizeRpcPoolForBrief(chainFamily, chainId) {
  // Dispatch by chain_family so SVM/Aptos/Sui/Substrate/CosmWasm hunters
  // receive their proper RPC ladders rather than the legacy evm-only
  // placeholder. Lazy-require family pools to avoid circular import
  // (svm-rpc-pool depends on this module's isPublicHttpsUrl helper indirectly
  // via shared patterns).
  if (chainFamily === "svm") {
    const { summarizeSvmPoolForBrief } = require("./svm-rpc-pool.js");
    return summarizeSvmPoolForBrief(chainId);
  }
  if (chainFamily === "aptos") {
    const { summarizeAptosPoolForBrief } = require("./aptos-rpc-pool.js");
    return summarizeAptosPoolForBrief(chainId);
  }
  if (chainFamily === "sui") {
    const { summarizeSuiPoolForBrief } = require("./sui-rpc-pool.js");
    return summarizeSuiPoolForBrief(chainId);
  }
  if (chainFamily === "substrate") {
    const { summarizeSubstratePoolForBrief } = require("./substrate-rpc-pool.js");
    return summarizeSubstratePoolForBrief(chainId);
  }
  if (chainFamily === "cosmwasm") {
    const { summarizeCosmwasmPoolForBrief } = require("./cosmwasm-rpc-pool.js");
    return summarizeCosmwasmPoolForBrief(chainId);
  }
  if (chainFamily !== "evm") {
    return { chain_family: chainFamily || null, endpoints: [], note: "RPC pool is currently provided for chain_family: evm, svm, aptos, sui, substrate, cosmwasm only." };
  }
  const numericChainId = Number(chainId);
  if (!Number.isInteger(numericChainId) || numericChainId <= 0) {
    return { chain_family: chainFamily, chain_id: chainId || null, endpoints: [], note: "Set chain_id on the surface for a populated RPC pool." };
  }
  let endpoints;
  try {
    endpoints = resolveEvmRpcEndpoints(numericChainId);
  } catch {
    endpoints = [];
  }
  // Cap the brief view at 6 endpoints (matches HUNTER_BRIEF_SURFACE_ARRAY_LIMITS.fork_rpc_pool).
  const trimmed = endpoints.slice(0, 6);
  const note = endpoints.length === 0
    ? `No default RPC ladder for chain_id ${numericChainId}. Hunters must pass 'endpoints' explicitly to bounty_evm_* tools and 'fork_urls' to bounty_foundry_run. Operators can set BOB_EVM_RPCS_${numericChainId}=url1,url2 in the MCP server env (before launch) for a default.`
    : null;
  return {
    chain_family: chainFamily,
    chain_id: numericChainId,
    endpoints: trimmed,
    truncated: endpoints.length > trimmed.length,
    note,
  };
}

module.exports = {
  DEFAULT_PUBLIC_RPC_LADDER,
  isPrivateHost,
  isHttpsUrl,
  isPublicHttpsUrl,
  resolveEvmRpcEndpoints,
  summarizeRpcPoolForBrief,
};
