"use strict";

const { runSuiTest, DEFAULT_TIMEOUT_MS } = require("../sui-runner.js");

async function handler(args) {
  const result = await runSuiTest({
    workdir: args.harness_path,
    matchTest: args.match_test || null,
    network: args.network || null,
    forkCheckpoint: args.fork_checkpoint != null ? args.fork_checkpoint : (args.fork_block != null ? args.fork_block : null),
    forkUrls: Array.isArray(args.fork_urls) ? args.fork_urls : null,
    extraArgs: Array.isArray(args.extra_args) ? args.extra_args : [],
    timeoutMs: args.timeout_ms || DEFAULT_TIMEOUT_MS,
  });
  return JSON.stringify(result);
}

module.exports = Object.freeze({
  name: "bounty_sui_run",
  description: "Run sui move test on a local Sui Move package, optionally pinned to a Sui network for harnesses that opt into checkpoint-clone fixtures via BOB_SUI_FORK_URL. Forks use the public JSON-RPC fallback ladder for the supplied network; on RPC failure the result reports kind: sui_fork blockage so the hunter can record blocked_harness_runs[] and set surface_status: partial. Returns structured per-test pass/fail parsed from the Move unit test output ([ PASS ]/[ FAIL ]/[ TIMEOUT ]). Requires `sui` CLI in PATH on the user's machine; if absent, returns reason: sui_not_in_path. Subprocess hard-killed at timeout (default 90s, max 600s).",
  inputSchema: {
    "type": "object",
    "properties": {
      "target_domain": { "type": "string" },
      "harness_path": { "type": "string", "minLength": 1 },
      "match_test": { "type": "string", "minLength": 1, "maxLength": 200 },
      "network": { "type": "string", "enum": ["mainnet", "testnet", "devnet", "localnet"] },
      "fork_checkpoint": { "type": "integer", "minimum": 0 },
      "fork_block": { "type": "integer", "minimum": 0, "description": "Alias for fork_checkpoint — accepted for symmetry with bounty_foundry_run / bounty_anchor_run." },
      "fork_urls": { "type": "array", "items": { "type": "string", "format": "uri" }, "maxItems": 8 },
      "extra_args": { "type": "array", "items": { "type": "string", "minLength": 1, "maxLength": 200 }, "maxItems": 12 },
      "timeout_ms": { "type": "integer", "minimum": 5000, "maximum": 600000 }
    },
    "required": ["target_domain", "harness_path", "match_test"]
  },
  handler,
  role_bundles: ["hunter-move", "verifier", "evidence"],
  mutating: false,
  global_preapproval: false,
  network_access: true,
  browser_access: false,
  scope_required: false,
  sensitive_output: false,
  session_artifacts_written: [],
  hook_required: false,
});
