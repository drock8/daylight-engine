"use strict";

const { resolveSvmRpcEndpoints, isPublicHttpsUrl } = require("./svm-rpc-pool.js");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024; // 256 KiB
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

const SVM_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isPubkey(value) {
  return typeof value === "string" && SVM_PUBKEY_RE.test(value);
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

// Solana RPC has a stronger rate-limit reputation than EVM public RPCs. The
// caller-supplied endpoints + per-cluster ladder lets verifiers/hunters fail
// over without re-spawning the MCP server.
async function rpcRequest({
  cluster,
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
    : resolveSvmRpcEndpoints(cluster);
  if (endpointList.length === 0) {
    throw new Error(`no public RPC endpoints available for cluster ${cluster}; set BOB_SVM_RPCS_${String(cluster).toUpperCase().replace(/-/g, "_")}=url1,url2 to override`);
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
  const err = new Error(`all RPC endpoints failed for ${method} on cluster ${cluster}: ${summary}`);
  err.attempts = errors;
  throw err;
}

async function getAccountInfo({ cluster, pubkey, encoding = "base64", endpoints }) {
  if (!isPubkey(pubkey)) {
    throw new Error(`pubkey must be a base58 32-44 char Solana program/account id, received: ${pubkey}`);
  }
  // commitment: "confirmed" balances tradeoff between freshness and finality.
  // For audit work "confirmed" is more useful than "finalized" because slot
  // is recent enough to reflect bug-pattern state without waiting for full
  // finality (32 slots / ~12s).
  return rpcRequest({
    cluster,
    method: "getAccountInfo",
    params: [pubkey, { encoding, commitment: "confirmed" }],
    endpoints,
    maxResponseBytes: 1024 * 1024, // up to 1 MiB for executables and large data accounts
  });
}

async function getMultipleAccounts({ cluster, pubkeys, encoding = "base64", endpoints }) {
  if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
    throw new Error("pubkeys must be a non-empty array");
  }
  for (const pk of pubkeys) {
    if (!isPubkey(pk)) {
      throw new Error(`pubkey must be a base58 32-44 char Solana program/account id, received: ${pk}`);
    }
  }
  if (pubkeys.length > 100) {
    throw new Error("getMultipleAccounts caps requests at 100 pubkeys per call");
  }
  return rpcRequest({
    cluster,
    method: "getMultipleAccounts",
    params: [pubkeys, { encoding, commitment: "confirmed" }],
    endpoints,
    maxResponseBytes: 4 * 1024 * 1024,
  });
}

async function getSlot({ cluster, endpoints }) {
  return rpcRequest({
    cluster,
    method: "getSlot",
    params: [{ commitment: "confirmed" }],
    endpoints,
    maxResponseBytes: 1024,
  });
}

async function getEpochInfo({ cluster, endpoints }) {
  return rpcRequest({
    cluster,
    method: "getEpochInfo",
    params: [{ commitment: "confirmed" }],
    endpoints,
    maxResponseBytes: 4096,
  });
}

module.exports = {
  DEFAULT_MAX_RESULT_BYTES,
  SVM_PUBKEY_RE,
  getAccountInfo,
  getEpochInfo,
  getMultipleAccounts,
  getSlot,
  isPubkey,
  rpcRequest,
};
