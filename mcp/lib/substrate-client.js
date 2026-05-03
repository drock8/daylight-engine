"use strict";

// Substrate JSON-RPC client. Substrate nodes implement JSON-RPC over both
// WebSocket (preferred for subscriptions) and HTTP (sufficient for read-only
// queries). Bob's substrate read tools talk HTTP because subprocess lifetime
// doesn't share a WS session.
//
// Method dispatch: state_*, chain_*, system_*, contracts_call_*. The methods
// we care about for SC verification are:
//   - state_getStorage(key, blockHash?) → raw storage at key
//   - state_call(method, callData, blockHash?) → execute a runtime API call
//   - chain_getBlockHash(number?) → resolve block number to hash for pinning
//   - chain_getHeader(blockHash?) → latest header for height/parent lookups
//   - system_chain() → chain spec_name (sanity check that endpoint matches network)
//
// The pallet_contracts ContractInfoOf storage layout uses a Twox64Concat hasher
// over the AccountId, so we expose getContractInfo as a convenience that
// builds the storage key from the SS58 address. Hunters and verifiers who
// need lower-level access can call rpcRequest directly with a raw key.

const { resolveSubstrateRpcEndpoints, isPublicHttpsUrl } = require("./substrate-rpc-pool.js");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

const SS58_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isSs58Address(value) {
  if (typeof value !== "string") return false;
  if (value.length < 45 || value.length > 52) return false;
  return SS58_BASE58_RE.test(value);
}

async function readResponseTextCapped(resp, maxBytes) {
  if (!resp.body || typeof resp.body.getReader !== "function") {
    const text = await resp.text();
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length <= maxBytes) return text;
    return buffer.subarray(0, maxBytes).toString("utf8");
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      const remaining = maxBytes - received;
      if (remaining > 0) {
        chunks.push(buffer.length > remaining ? buffer.subarray(0, remaining) : buffer);
      }
      received += buffer.length;
      if (received > maxBytes) {
        try { if (typeof reader.cancel === "function") await reader.cancel(); } catch {}
        break;
      }
    }
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function rpcRequestOnce(url, method, params, { timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; hacker-bob)" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
    });
    const text = await readResponseTextCapped(resp, maxResponseBytes);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${url}: ${text.slice(0, 200)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`malformed JSON-RPC response from ${url}: ${error.message || String(error)}`);
    }
    if (parsed && parsed.error) {
      const message = typeof parsed.error.message === "string" ? parsed.error.message : JSON.stringify(parsed.error);
      const err = new Error(`JSON-RPC error from ${url}: ${message}`);
      err.rpcError = parsed.error;
      throw err;
    }
    return parsed && parsed.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcRequest({
  network,
  method,
  params,
  endpoints,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof fetch !== "function") {
    throw new Error("fetch is unavailable in this Node runtime");
  }
  const endpointList = Array.isArray(endpoints) && endpoints.length > 0
    ? endpoints.filter(isPublicHttpsUrl)
    : resolveSubstrateRpcEndpoints(network);
  if (endpointList.length === 0) {
    throw new Error(`no public RPC endpoints available for network ${network}; set BOB_SUBSTRATE_RPCS_${String(network).toUpperCase()}=url1,url2 to override`);
  }

  const errors = [];
  for (const endpoint of endpointList) {
    try {
      const result = await rpcRequestOnce(endpoint, method, params, { timeoutMs, maxResponseBytes });
      return { result, endpoint };
    } catch (error) {
      errors.push({ endpoint, message: error.message || String(error) });
    }
  }
  const summary = errors.map((e) => `${e.endpoint}: ${e.message}`).join("; ");
  const err = new Error(`all RPC endpoints failed for ${method} on network ${network}: ${summary}`);
  err.attempts = errors;
  throw err;
}

async function getStorage({ network, storageKey, blockHash, endpoints }) {
  if (typeof storageKey !== "string" || !storageKey.startsWith("0x")) {
    throw new Error("storageKey must be a 0x-prefixed hex string");
  }
  const params = blockHash != null ? [storageKey, blockHash] : [storageKey];
  return rpcRequest({
    network,
    method: "state_getStorage",
    params,
    endpoints,
    maxResponseBytes: 1024 * 1024,
  });
}

async function getRuntimeVersion({ network, blockHash, endpoints }) {
  // state_getRuntimeVersion returns spec_name, spec_version, transaction_version,
  // and the auth/runtime API list. Verifiers use spec_version to confirm the
  // chain hasn't been upgraded since the hunter recorded the bug.
  const params = blockHash != null ? [blockHash] : [];
  return rpcRequest({
    network,
    method: "state_getRuntimeVersion",
    params,
    endpoints,
    maxResponseBytes: 64 * 1024,
  });
}

async function getBlockHash({ network, blockNumber, endpoints }) {
  // chain_getBlockHash(number) returns the hash for that block. With no
  // argument it returns the head block hash.
  const params = blockNumber != null ? [blockNumber] : [];
  return rpcRequest({
    network,
    method: "chain_getBlockHash",
    params,
    endpoints,
    maxResponseBytes: 4096,
  });
}

async function getHeader({ network, blockHash, endpoints }) {
  // chain_getHeader returns the parent_hash, number, state_root, extrinsics_root,
  // and digest for the latest (or specified) block. Useful as a chain liveness
  // probe and for resolving fork height at verification time.
  const params = blockHash != null ? [blockHash] : [];
  return rpcRequest({
    network,
    method: "chain_getHeader",
    params,
    endpoints,
    maxResponseBytes: 16 * 1024,
  });
}

async function getSystemChain({ network, endpoints }) {
  // system_chain returns the chain's spec_name (e.g., "Polkadot", "Kusama").
  // Verifier prompts use this as a cross-check that a substrate RPC endpoint
  // actually serves the network the hunter claimed in chain_id.
  return rpcRequest({
    network,
    method: "system_chain",
    params: [],
    endpoints,
    maxResponseBytes: 4096,
  });
}

module.exports = {
  DEFAULT_MAX_RESULT_BYTES,
  SS58_BASE58_RE,
  getBlockHash,
  getHeader,
  getRuntimeVersion,
  getStorage,
  getSystemChain,
  isSs58Address,
  rpcRequest,
};
