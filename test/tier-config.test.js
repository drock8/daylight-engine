"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  TIER_LEVELS,
  TIER_LEVEL_VALUES,
  TIER_PHASES,
  TIER_VERIFICATION_ROUNDS,
  TIER_WAVE_LIMITS,
  isPhaseAllowedForTier,
  tierPhasesAvailable,
  tierVerificationRounds,
  tierWaveLimit,
} = require("../mcp/lib/tier-config.js");
const {
  buildToolRegistry,
  defineTool,
  TOOL_REGISTRY,
} = require("../mcp/lib/tool-registry.js");
const {
  executeTool,
} = require("../mcp/lib/dispatch.js");
const {
  initSession,
  readSessionState,
} = require("../mcp/lib/session-state.js");
const {
  buildInitialSessionState,
  compactSessionState,
  normalizeSessionStateDocument,
} = require("../mcp/lib/session-state-contracts.js");
const {
  sessionDir,
  statePath,
} = require("../mcp/lib/paths.js");
const {
  writeFileAtomic,
} = require("../mcp/lib/storage.js");

function withTempHome(fn) {
  const previousHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "tier-test-"));
  process.env.HOME = tempHome;
  const cleanup = () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  };
  try {
    const result = fn(tempHome);
    if (result && typeof result.then === "function") {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function seedSessionState(domain, overrides = {}) {
  const dir = sessionDir(domain);
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    target: domain,
    target_url: `https://${domain}`,
    tier_level: 3,
    deep_mode: false,
    checkpoint_mode: "normal",
    block_internal_hosts: false,
    block_internal_hosts_source: "mode_default",
    phase: "HUNT",
    hunt_wave: 0,
    pending_wave: null,
    total_findings: 0,
    explored: [],
    terminally_blocked: [],
    prereq_registry_snapshots: [],
    blocked_prereq_history: [],
    terminal_block_clear_history: [],
    dead_ends: [],
    waf_blocked_endpoints: [],
    lead_surface_ids: [],
    scope_exclusions: [],
    hold_count: 0,
    auth_status: "pending",
    egress_profile: "default",
    egress_region: null,
    proxy_configured: false,
    egress_profile_identity_hash: null,
    egress_profile_identity_version: null,
    egress_profile_identity_source: null,
    egress_profile_identity_bound_at: null,
    egress_profile_identity_bind_source: null,
    egress_profile_legacy_migration: null,
    operator_note: null,
    verification_schema_version: null,
    verification_attempt_id: null,
    verification_snapshot_hash: null,
    verification_entered_at: null,
    handoff_provenance_required: true,
    ...overrides,
  };
  writeFileAtomic(statePath(domain), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

// --- tier-config.js unit tests ---

test("tier-config exports valid tier level constants", () => {
  assert.deepEqual(TIER_LEVEL_VALUES, [0, 1, 2, 3]);
  assert.equal(TIER_LEVELS.TIER_0, 0);
  assert.equal(TIER_LEVELS.TIER_1, 1);
  assert.equal(TIER_LEVELS.TIER_2, 2);
  assert.equal(TIER_LEVELS.TIER_3, 3);
});

test("tier-config phase availability is cumulative", () => {
  const t0 = tierPhasesAvailable(0);
  const t1 = tierPhasesAvailable(1);
  const t2 = tierPhasesAvailable(2);
  const t3 = tierPhasesAvailable(3);

  assert.ok(t0.includes("RECON"));
  assert.ok(!t0.includes("HUNT"));
  assert.ok(!t0.includes("AUTH"));

  assert.ok(t1.includes("RECON"));
  assert.ok(t1.includes("HUNT"));
  assert.ok(!t1.includes("AUTH"));
  assert.ok(t1.includes("VERIFY"));
  assert.ok(t1.includes("GRADE"));
  assert.ok(t1.includes("REPORT"));

  assert.ok(t2.includes("AUTH"));
  assert.ok(t2.includes("CHAIN"));

  assert.ok(t3.includes("EXPLORE"));
  for (const phase of t2) {
    assert.ok(t3.includes(phase), `tier_3 should include ${phase}`);
  }
});

test("isPhaseAllowedForTier correctly gates phases", () => {
  assert.ok(isPhaseAllowedForTier("RECON", 0));
  assert.ok(!isPhaseAllowedForTier("HUNT", 0));
  assert.ok(isPhaseAllowedForTier("HUNT", 1));
  assert.ok(!isPhaseAllowedForTier("AUTH", 1));
  assert.ok(isPhaseAllowedForTier("AUTH", 2));
  assert.ok(isPhaseAllowedForTier("EXPLORE", 3));
  assert.ok(!isPhaseAllowedForTier("EXPLORE", 2));
});

test("tier wave limits follow tier definitions", () => {
  assert.equal(tierWaveLimit(0), 0);
  assert.equal(tierWaveLimit(1), 1);
  assert.equal(tierWaveLimit(2), Infinity);
  assert.equal(tierWaveLimit(3), Infinity);
});

test("tier verification round counts follow tier definitions", () => {
  assert.equal(tierVerificationRounds(0), 0);
  assert.equal(tierVerificationRounds(1), 1);
  assert.equal(tierVerificationRounds(2), 1);
  assert.equal(tierVerificationRounds(3), 3);
});

// --- tool registry min_tier validation ---

test("every registered tool has a valid min_tier field", () => {
  for (const tool of TOOL_REGISTRY) {
    assert.ok(
      Number.isInteger(tool.min_tier) && tool.min_tier >= 0 && tool.min_tier <= 3,
      `${tool.name} has invalid min_tier: ${tool.min_tier}`,
    );
  }
});

test("tool registry rejects tools without min_tier", () => {
  const base = {
    name: "bounty_test_no_tier",
    description: "Test tool without tier.",
    inputSchema: { type: "object", properties: {} },
    handler: () => ({}),
    role_bundles: ["hunter-shared"],
    mutating: false,
    global_preapproval: true,
    network_access: false,
    browser_access: false,
    scope_required: false,
    sensitive_output: false,
    session_artifacts_written: [],
  };
  assert.throws(
    () => buildToolRegistry({ toolModules: [base] }),
    /missing min_tier/,
  );
});

test("tool registry rejects invalid min_tier values", () => {
  const base = {
    name: "bounty_test_bad_tier",
    description: "Test tool with bad tier.",
    inputSchema: { type: "object", properties: {} },
    handler: () => ({}),
    role_bundles: ["hunter-shared"],
    mutating: false,
    global_preapproval: true,
    network_access: false,
    browser_access: false,
    scope_required: false,
    sensitive_output: false,
    session_artifacts_written: [],
  };

  for (const badValue of [-1, 4, 1.5, "2", null, true]) {
    assert.throws(
      () => buildToolRegistry({ toolModules: [{ ...base, min_tier: badValue }] }),
      /invalid min_tier/,
      `min_tier: ${badValue} should be rejected`,
    );
  }
});

test("tier-critical tools are assigned correct min_tier values", () => {
  const toolByName = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

  assert.equal(toolByName.get("bounty_init_session").min_tier, 0);
  assert.equal(toolByName.get("bounty_read_session_state").min_tier, 0);
  assert.equal(toolByName.get("bounty_record_finding").min_tier, 0);
  assert.equal(toolByName.get("bounty_public_intel").min_tier, 0);
  assert.equal(toolByName.get("bounty_evm_call").min_tier, 0);

  assert.equal(toolByName.get("bounty_http_scan").min_tier, 1);
  assert.equal(toolByName.get("bounty_signup_detect").min_tier, 1);
  assert.equal(toolByName.get("bounty_temp_email").min_tier, 1);

  assert.equal(toolByName.get("bounty_auto_signup").min_tier, 2);
  assert.equal(toolByName.get("bounty_run_auth_differential").min_tier, 2);
  assert.equal(toolByName.get("bounty_run_doc_delta").min_tier, 2);
  assert.equal(toolByName.get("bounty_foundry_run").min_tier, 2);

  assert.equal(toolByName.get("bounty_halmos_run").min_tier, 3);
  assert.equal(toolByName.get("bounty_run_invariant_for_finding").min_tier, 3);
  assert.equal(toolByName.get("bounty_anchor_run").min_tier, 3);
});

// --- init-session tier_level ---

test("bounty_init_session defaults tier_level to 3", () => {
  withTempHome(() => {
    const result = JSON.parse(initSession({
      target_domain: "tier-default.example.com",
      target_url: "https://tier-default.example.com",
    }));
    assert.equal(result.state.tier_level, 3);
  });
});

test("bounty_init_session persists explicit tier_level", () => {
  withTempHome(() => {
    for (const tier of [0, 1, 2, 3]) {
      const domain = `tier${tier}.example.com`;
      const result = JSON.parse(initSession({
        target_domain: domain,
        target_url: `https://${domain}`,
        tier_level: tier,
      }));
      assert.equal(result.state.tier_level, tier);

      const rawState = JSON.parse(fs.readFileSync(statePath(domain), "utf8"));
      assert.equal(rawState.tier_level, tier);
    }
  });
});

test("bounty_init_session rejects invalid tier_level", () => {
  withTempHome(() => {
    for (const bad of [-1, 4, 1.5, "2"]) {
      assert.throws(
        () => initSession({
          target_domain: `bad-tier.example.com`,
          target_url: "https://bad-tier.example.com",
          tier_level: bad,
        }),
        /tier_level/,
        `tier_level: ${bad} should be rejected`,
      );
    }
  });
});

// --- session state contracts ---

test("buildInitialSessionState includes tier_level", () => {
  withTempHome(() => {
    const result = JSON.parse(initSession({
      target_domain: "build-test-1.example.com",
      target_url: "https://build-test-1.example.com",
      tier_level: 1,
    }));
    assert.equal(result.state.tier_level, 1);
    const rawState = JSON.parse(fs.readFileSync(statePath("build-test-1.example.com"), "utf8"));
    assert.equal(rawState.tier_level, 1);
  });
});

test("buildInitialSessionState defaults tier_level to 3", () => {
  withTempHome(() => {
    const result = JSON.parse(initSession({
      target_domain: "build-test-default.example.com",
      target_url: "https://build-test-default.example.com",
    }));
    assert.equal(result.state.tier_level, 3);
  });
});

test("normalizeSessionStateDocument defaults tier_level to 3 for legacy state", () => {
  const normalized = normalizeSessionStateDocument(
    { target_url: "https://test.com", phase: "RECON" },
    "test.com",
  );
  assert.equal(normalized.tier_level, 3);
});

test("normalizeSessionStateDocument rejects invalid tier_level", () => {
  assert.throws(
    () => normalizeSessionStateDocument(
      { target_url: "https://test.com", phase: "RECON", tier_level: 5 },
      "test.com",
    ),
    /tier_level/,
  );
});

test("compactSessionState includes tier_level", () => {
  const compact = compactSessionState({ tier_level: 1, target: "test.com" });
  assert.equal(compact.tier_level, 1);
});

test("compactSessionState defaults tier_level to 3 when missing", () => {
  const compact = compactSessionState({ target: "test.com" });
  assert.equal(compact.tier_level, 3);
});

// --- dispatch tier enforcement ---

test("dispatch blocks tools above session tier_level", () => {
  withTempHome(async () => {
    seedSessionState("blocked.example.com", {
      phase: "HUNT",
      tier_level: 1,
    });

    const result = await executeTool("bounty_run_auth_differential", {
      target_domain: "blocked.example.com",
      base_url: "https://blocked.example.com",
      endpoints: ["/api/users"],
      auth_profiles: ["admin", "guest"],
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TIER_BLOCKED");
    assert.match(result.error.message, /requires tier_2/);
    assert.match(result.error.message, /session is tier_1/);
  });
});

test("dispatch allows tools at session tier_level", () => {
  withTempHome(async () => {
    seedSessionState("allowed.example.com", {
      phase: "HUNT",
      tier_level: 2,
    });

    const result = await executeTool("bounty_read_auth_differential_results", {
      target_domain: "allowed.example.com",
    });

    assert.notEqual(result.error && result.error.code, "TIER_BLOCKED");
  });
});

test("dispatch allows tools below session tier_level", () => {
  withTempHome(async () => {
    seedSessionState("below.example.com", {
      phase: "HUNT",
      tier_level: 3,
    });

    const result = await executeTool("bounty_read_session_state", {
      target_domain: "below.example.com",
    });

    assert.equal(result.ok, true);
  });
});

test("dispatch allows tier_0 tools without a session", () => {
  withTempHome(async () => {
    const result = await executeTool("bounty_read_session_state", {
      target_domain: "nosession.example.com",
    });

    assert.notEqual(result.error && result.error.code, "TIER_BLOCKED");
  });
});

test("dispatch blocks tier_3 tools when session is tier_1", () => {
  withTempHome(async () => {
    seedSessionState("t1.example.com", {
      phase: "HUNT",
      tier_level: 1,
    });

    const result = await executeTool("bounty_halmos_run", {
      target_domain: "t1.example.com",
      harness_path: "/nonexistent",
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TIER_BLOCKED");
    assert.match(result.error.message, /requires tier_3/);
    assert.match(result.error.message, /session is tier_1/);
  });
});

test("dispatch treats legacy sessions without tier_level as tier_3", () => {
  withTempHome(async () => {
    const domain = "legacy.example.com";
    const dir = sessionDir(domain);
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(statePath(domain), `${JSON.stringify({
      target: domain,
      target_url: `https://${domain}`,
      phase: "HUNT",
    }, null, 2)}\n`);

    const result = await executeTool("bounty_halmos_run", {
      target_domain: domain,
      harness_path: "/nonexistent",
    });

    assert.notEqual(result.error && result.error.code, "TIER_BLOCKED");
  });
});
