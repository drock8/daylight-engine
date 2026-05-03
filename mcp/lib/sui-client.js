"use strict";

// Sui JSON-RPC client. Mirrors svm-client.js for reuse semantics.

const { resolveSuiRpcEndpoints, isPublicHttpsUrl } = require("./sui-rpc-pool.js");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

const MOVE_ADDRESS_RE = /^0x[a-fA-F0-9]{1,64}$/;

function isMoveAddress(value) {
  return typeof value === "string" && MOVE_ADDRESS_RE.test(value);
}

function normalizeMoveAddress(value) {
  if (!isMoveAddress(value)) return null;
  const hex = value.slice(2).toLowerCase();
  return `0x${hex.padStart(64, "0")}`;
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
    : resolveSuiRpcEndpoints(network);
  if (endpointList.length === 0) {
    throw new Error(`no public RPC endpoints available for network ${network}; set BOB_SUI_RPCS_${String(network).toUpperCase()}=url1,url2 to override`);
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

async function getObject({ network, objectId, options, endpoints }) {
  if (!isMoveAddress(objectId)) {
    throw new Error(`objectId must be a 0x-prefixed hex Sui object id, received: ${objectId}`);
  }
  // Sui's sui_getObject takes (id, options). options controls whether the
  // response includes content/type/owner/previousTransaction. We always show
  // owner + type because verifier prompts use both for object_ownership_*
  // pattern matching.
  const opts = {
    showType: true,
    showOwner: true,
    showPreviousTransaction: true,
    showDisplay: false,
    showContent: true,
    showBcs: false,
    showStorageRebate: true,
    ...(options || {}),
  };
  const normalized = normalizeMoveAddress(objectId);
  return rpcRequest({
    network,
    method: "sui_getObject",
    params: [normalized, opts],
    endpoints,
    maxResponseBytes: 1024 * 1024,
  });
}

async function getNormalizedMoveModulesByPackage({ network, packageId, endpoints }) {
  if (!isMoveAddress(packageId)) {
    throw new Error(`packageId must be a 0x-prefixed hex Sui package id, received: ${packageId}`);
  }
  const normalized = normalizeMoveAddress(packageId);
  return rpcRequest({
    network,
    method: "sui_getNormalizedMoveModulesByPackage",
    params: [normalized],
    endpoints,
    maxResponseBytes: 4 * 1024 * 1024,
  });
}

async function getLatestCheckpointSequenceNumber({ network, endpoints }) {
  return rpcRequest({
    network,
    method: "sui_getLatestCheckpointSequenceNumber",
    params: [],
    endpoints,
    maxResponseBytes: 1024,
  });
}

module.exports = {
  DEFAULT_MAX_RESULT_BYTES,
  MOVE_ADDRESS_RE,
  getLatestCheckpointSequenceNumber,
  getNormalizedMoveModulesByPackage,
  getObject,
  isMoveAddress,
  normalizeMoveAddress,
  rpcRequest,
};
