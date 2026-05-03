"use strict";

const { resolveEvmRpcEndpoints, isPublicHttpsUrl } = require("./evm-rpc-pool.js");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024; // 256 KiB
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;     // 64 KiB returned to caller

const HEX_BYTES_RE = /^0x([0-9a-fA-F]*)$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const STORAGE_SLOT_RE = /^0x[0-9a-fA-F]{1,64}$/;

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function isHexBytes(value) {
  return typeof value === "string" && HEX_BYTES_RE.test(value);
}

function isStorageSlot(value) {
  return typeof value === "string" && STORAGE_SLOT_RE.test(value);
}

function normalizeBlockTag(value) {
  if (value == null || value === "" || value === "latest" || value === "earliest" || value === "pending" || value === "safe" || value === "finalized") {
    return value || "latest";
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return value.toLowerCase();
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return `0x${BigInt(value).toString(16)}`;
  }
  throw new Error(`block must be 'latest|earliest|pending|safe|finalized', a non-negative integer, or a hex string; received: ${value}`);
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
  chainId,
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
    : resolveEvmRpcEndpoints(chainId);
  if (endpointList.length === 0) {
    throw new Error(`no public RPC endpoints available for chain_id ${chainId}; set BOB_EVM_RPCS_${chainId}=url1,url2 to override`);
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
  const err = new Error(`all RPC endpoints failed for ${method} on chain ${chainId}: ${summary}`);
  err.attempts = errors;
  throw err;
}

async function ethCall({ chainId, to, data, block = "latest", from = null, endpoints }) {
  if (!isAddress(to)) throw new Error(`to must be a 20-byte hex address, received: ${to}`);
  if (!isHexBytes(data)) throw new Error(`data must be a hex string, received: ${data}`);
  if (from != null && !isAddress(from)) throw new Error(`from must be a 20-byte hex address, received: ${from}`);
  const txObject = { to, data };
  if (from) txObject.from = from;
  return rpcRequest({
    chainId,
    method: "eth_call",
    params: [txObject, normalizeBlockTag(block)],
    endpoints,
    maxResponseBytes: DEFAULT_MAX_RESULT_BYTES * 4,
  });
}

async function ethGetStorageAt({ chainId, address, slot, block = "latest", endpoints }) {
  if (!isAddress(address)) throw new Error(`address must be a 20-byte hex address, received: ${address}`);
  if (!isStorageSlot(slot)) throw new Error(`slot must be a hex string with up to 32 bytes, received: ${slot}`);
  return rpcRequest({
    chainId,
    method: "eth_getStorageAt",
    params: [address, slot, normalizeBlockTag(block)],
    endpoints,
    maxResponseBytes: 4096,
  });
}

async function ethGetCode({ chainId, address, block = "latest", endpoints }) {
  if (!isAddress(address)) throw new Error(`address must be a 20-byte hex address, received: ${address}`);
  return rpcRequest({
    chainId,
    method: "eth_getCode",
    params: [address, normalizeBlockTag(block)],
    endpoints,
    maxResponseBytes: 1024 * 1024, // up to 1 MiB for runtime bytecode
  });
}

async function ethBlockNumber({ chainId, endpoints }) {
  const { result } = await rpcRequest({
    chainId,
    method: "eth_blockNumber",
    params: [],
    endpoints,
    maxResponseBytes: 1024,
  });
  return result;
}

module.exports = {
  ADDRESS_RE,
  HEX_BYTES_RE,
  STORAGE_SLOT_RE,
  DEFAULT_MAX_RESULT_BYTES,
  ethBlockNumber,
  ethCall,
  ethGetCode,
  ethGetStorageAt,
  isAddress,
  isHexBytes,
  isStorageSlot,
  normalizeBlockTag,
  rpcRequest,
};
