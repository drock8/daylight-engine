"use strict";

const fs = require("fs");
const path = require("path");
const {
  mcpPermissionForTool,
} = require("../../adapters/claude/config.js");
const {
  mcpToolNamesForRole,
  roleDefinition,
} = require("../../mcp/lib/role-model.js");
const {
  substituteCapabilityPackVerifierTable,
} = require("../../mcp/lib/capability-packs-rendering.js");

const DEFAULT_ROOT = path.join(__dirname, "..", "..");

const CLAUDE_LAUNCH_TEMPLATES = Object.freeze({
  "{{SPAWN_RECON_AGENT}}": [
    "```text",
    "deep_mode false: Agent(subagent_type: \"recon-agent\", name: \"recon\", prompt: \"DOMAIN=[domain] SESSION=~/bounty-agent-sessions/[domain]\")",
    "```",
  ].join("\n"),
  "{{SPAWN_DEEP_RECON_AGENT}}": [
    "```text",
    "deep_mode true: Agent(subagent_type: \"deep-recon-agent\", name: \"deep-recon\", prompt: \"DOMAIN=[domain] SESSION=~/bounty-agent-sessions/[domain]\")",
    "```",
  ].join("\n"),
  "{{SPAWN_SURFACE_ROUTER_AGENT}}": [
    "```text",
    "Agent(subagent_type: \"surface-router-agent\", name: \"surface-router\", prompt: \"Domain: [domain]. Session: ~/bounty-agent-sessions/[domain]. Confirm attack_surface.json exists and has surfaces, then call bounty_route_surfaces({ target_domain: '[domain]' }) and use .data. If routing fails or returns zero surfaces, report the error and stop. Otherwise return route count, capability-pack counts, and surface_routes_path.\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_AGENT}}": [
    "```",
    "Agent(subagent_type: \"[assignment.hunter_agent]\", name: \"hunter-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "Capability pack: [assignment.capability_pack]. Brief profile: [assignment.brief_profile]. Hunter agent: [assignment.hunter_agent].",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]', egress_profile: '[egress_profile]', block_internal_hosts: false }) and use .data, including run_context.",
    "Use surface_type, bug_class_hints, high_value_flows, evidence, surface_limits, coverage_summary, traffic_summary, audit_summary, circuit_breaker_summary, ranking_summary, intel_hints, and static_scan_hints as prioritization inputs for this one assigned surface.",
    "Egress profile: [egress_profile]. Pass this exact value as egress_profile on every bounty_http_scan call.",
    "Prefer traffic_summary endpoints, replay through bounty_http_scan with target_domain and egress_profile, log bounty_log_coverage after meaningful tests, and log before switching away from promising traffic-derived endpoints.",
    "New token-contract scans must use bounty_import_static_artifact then bounty_static_scan; never scan arbitrary paths.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Auth: call bounty_list_auth_profiles, use attacker profile for primary testing, victim profile for IDOR/access-control confirmation, legacy auth as a single profile, or unauthenticated testing if auth is absent.",
    "Geofence rule: after 3+ consecutive INTERNAL_ERROR, timeout, connection reset, or network_unreachable_target results on target-owned hosts, log blocked/unreachable coverage and dead-end context, write or prepare the handoff, and request orchestrator egress rotation instead of retrying.",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, optional chain_notes, content, and any dead_ends / waf_blocked_endpoints / lead_surface_ids. Then call bounty_finalize_hunter_run with target_domain, wave, agent, and surface_id. If finalization fails, fix the structured handoff and retry finalization. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_EVM_AGENT}}": [
    "```",
    "Agent(subagent_type: \"hunter-evm-agent\", name: \"hunter-evm-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
    "Confirm surface_type is smart_contract; surface.chain_family and surface.chain_id are required.",
    "Use bob_spec_status for trust_assumptions, invariants, known_issues, and severity_system metadata. Use rpc_pool.endpoints for non-MCP reads.",
    "Workflow: bounty_evm_fetch_source -> read sources via Read -> bounty_evm_role_table to map the trust boundary -> scaffold a Foundry test under harness_path/test/ via Write -> bounty_foundry_run with chain_id and pinned fork_block -> record bypass_attempts[] entries citing the actual harness path + test name in attempt_summary.",
    "If forge is not in PATH or all fork_attempts fail, set surface_status: partial and record blocked_harness_runs[] with kind: foundry_fork or rpc_endpoint.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, content, optional bypass_attempts, blocked_harness_runs, chain_notes, dead_ends, lead_surface_ids. Then call bounty_finalize_hunter_run. If finalization fails, fix the handoff and retry. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_SVM_AGENT}}": [
    "```",
    "Agent(subagent_type: \"hunter-svm-agent\", name: \"hunter-svm-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
    "Confirm surface_type is smart_contract AND surface.chain_family is svm; surface.chain_id is the Solana cluster.",
    "Use bob_spec_status for trust_assumptions, invariants, known_issues, and severity_system metadata. Use rpc_pool.endpoints for non-MCP reads.",
    "Workflow: bounty_svm_fetch_program (confirm upgrade authority) -> bounty_svm_fetch_account (read multisig + state accounts) -> scaffold an Anchor test under harness_path/tests/ via Write -> bounty_anchor_run with cluster and optional pinned fork_slot -> record bypass_attempts[] entries citing the actual harness path + test description in attempt_summary.",
    "If anchor is not in PATH or all fork_attempts fail, set surface_status: partial and record blocked_harness_runs[] with kind: anchor_fork.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, content, optional bypass_attempts, blocked_harness_runs, chain_notes, dead_ends, lead_surface_ids. Then call bounty_finalize_hunter_run. If finalization fails, fix the handoff and retry. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_MOVE_AGENT}}": [
    "```",
    "Agent(subagent_type: \"hunter-move-agent\", name: \"hunter-move-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
    "Confirm surface_type is smart_contract AND surface.chain_family is one of {aptos, sui}. surface.chain_id is the network name (Aptos: mainnet/testnet/devnet; Sui: mainnet/testnet/devnet/localnet).",
    "Use bob_spec_status for trust_assumptions, invariants, known_issues, and severity_system metadata. Use rpc_pool.endpoints for non-MCP reads.",
    "Aptos workflow: bounty_aptos_fetch_module (enumerate exposed_functions, structs, friends) -> bounty_aptos_fetch_resource (read capability tokens, ownership records, treasury balances) -> scaffold an `aptos move test` harness under harness_path/sources/ via Write -> bounty_aptos_run with network and optional pinned fork_version -> record bypass_attempts[] citing the actual harness path + test name in attempt_summary.",
    "Sui workflow: bounty_sui_fetch_package (enumerate entry functions and friend relationships) -> bounty_sui_fetch_object (inspect Owner=Immutable/Shared/AddressOwner/ObjectOwner, Move type, capability fields) -> scaffold a `sui move test` harness under harness_path/sources/ via Write -> bounty_sui_run with network and optional pinned fork_checkpoint -> record bypass_attempts[] citing the actual harness path + test name in attempt_summary.",
    "If aptos / sui CLI is not in PATH or all fork_attempts fail, set surface_status: partial and record blocked_harness_runs[] with kind: aptos_fork or sui_fork.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, content, optional bypass_attempts, blocked_harness_runs, chain_notes, dead_ends, lead_surface_ids. Then call bounty_finalize_hunter_run. If finalization fails, fix the handoff and retry. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_SUBSTRATE_AGENT}}": [
    "```",
    "Agent(subagent_type: \"hunter-substrate-agent\", name: \"hunter-substrate-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
    "Confirm surface_type is smart_contract AND surface.chain_family is substrate. surface.chain_id is the network name (polkadot/kusama/astar/shiden/rococo/westend/localnet).",
    "Use bob_spec_status for trust_assumptions, invariants, known_issues, and severity_system metadata. Use rpc_pool.endpoints for non-MCP reads.",
    "Workflow: bounty_substrate_fetch_runtime (confirm chain identity + spec_version) -> bounty_substrate_fetch_storage (read pallet_contracts.ContractInfoOf for code_hash and admin) -> scaffold an ink! `cargo test` harness under harness_path/ via Write (uses #[ink::test] for unit or #[ink_e2e::test] for E2E) -> bounty_substrate_run with network and optional pinned fork_block -> record bypass_attempts[] citing the actual harness path + test name in attempt_summary.",
    "If cargo or substrate-contracts-node is not in PATH or all fork_attempts fail, set surface_status: partial and record blocked_harness_runs[] with kind: substrate_fork.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, content, optional bypass_attempts, blocked_harness_runs, chain_notes, dead_ends, lead_surface_ids. Then call bounty_finalize_hunter_run. If finalization fails, fix the handoff and retry. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_HUNTER_COSMWASM_AGENT}}": [
    "```",
    "Agent(subagent_type: \"hunter-cosmwasm-agent\", name: \"hunter-cosmwasm-w[wave]-a[agent]\", run_in_background: true, prompt: \"",
    "Domain: [domain]",
    "Wave: w[wave]",
    "Agent: a[agent]",
    "Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]",
    "First action: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
    "Confirm surface_type is smart_contract AND surface.chain_family is cosmwasm. surface.chain_id is the network name (osmosis/juno/neutron/archway/sei/stargaze/terra/kava/localnet).",
    "Use bob_spec_status for trust_assumptions, invariants, known_issues, and severity_system metadata. Use rpc_pool.endpoints for non-MCP reads.",
    "Workflow: bounty_cosmwasm_fetch_contract (confirm contract exists, capture code_id + admin) -> bounty_cosmwasm_smart_query (inspect public Config / Owner / Balance entrypoints) -> scaffold a cw-multi-test integration test under harness_path/tests/ via Write -> bounty_cosmwasm_run with network and optional pinned fork_block -> record bypass_attempts[] citing the actual harness path + test name in attempt_summary.",
    "If cargo is not in PATH or all fork_attempts fail, set surface_status: partial and record blocked_harness_runs[] with kind: cosmwasm_fork.",
    "Checkpoint mode: [normal|paranoid|yolo].",
    "Final: call bounty_write_wave_handoff exactly once with target_domain, wave, agent, surface_id, surface_status, handoff_token, summary, content, optional bypass_attempts, blocked_harness_runs, chain_notes, dead_ends, lead_surface_ids. Then call bounty_finalize_hunter_run. If finalization fails, fix the handoff and retry. After finalization succeeds, emit `BOB_HUNTER_DONE {\"target_domain\":\"[domain]\",\"wave\":\"w[wave]\",\"agent\":\"a[agent]\",\"surface_id\":\"[surface_id]\"}` for Claude compatibility.",
    "\")",
    "```",
  ].join("\n"),
  "{{SPAWN_CHAIN_AGENT}}": [
    "```",
    "Agent(subagent_type: \"chain-builder\", name: \"chain\", prompt: \"Domain: [domain]. Egress profile: [egress_profile]. Session: ~/bounty-agent-sessions/[domain]. Read findings, wave handoffs, auth profiles, HTTP audit, and prior chain attempts through MCP. Test plausible chains with bounty_http_scan as needed, passing egress_profile on every scan, and write every outcome through bounty_write_chain_attempt. Do not read findings.md, chains.md, or markdown handoffs.\")",
    "```",
  ].join("\n"),
  "{{SPAWN_BRUTALIST_VERIFIER}}": [
    "```",
    "Agent(subagent_type: \"brutalist-verifier\", name: \"brutalist\", prompt: \"Session: ~/bounty-agent-sessions/[domain]. Egress profile: [egress_profile]. Call bounty_read_findings and bounty_read_chain_attempts for [domain], call bounty_list_auth_profiles before authenticated replays, pass egress_profile on every bounty_http_scan replay, verify each finding, then write only through bounty_write_verification_round(round='brutalist').\")",
    "```",
  ].join("\n"),
  "{{SPAWN_BALANCED_VERIFIER}}": [
    "```",
    "Agent(subagent_type: \"balanced-verifier\", name: \"balanced\", prompt: \"Session: ~/bounty-agent-sessions/[domain]. Egress profile: [egress_profile]. Call bounty_read_findings, bounty_read_chain_attempts, and bounty_read_verification_round(round='brutalist'), call bounty_list_auth_profiles before authenticated replays, pass egress_profile on every bounty_http_scan replay, review brutalist decisions, then write only through bounty_write_verification_round(round='balanced').\")",
    "```",
  ].join("\n"),
  "{{SPAWN_FINAL_VERIFIER}}": [
    "```",
    "Agent(subagent_type: \"final-verifier\", name: \"final-verify\", prompt: \"Session: ~/bounty-agent-sessions/[domain]. Egress profile: [egress_profile]. Call bounty_read_findings for [domain], call bounty_read_verification_round(round='balanced'), call bounty_list_auth_profiles before authenticated replays, re-run only reportable survivors with fresh requests using egress_profile, then write only through bounty_write_verification_round(round='final').\")",
    "```",
  ].join("\n"),
  "{{SPAWN_EVIDENCE_AGENT}}": [
    "```",
    "Agent(subagent_type: \"evidence-agent\", name: \"evidence\", prompt: \"Domain: [domain]. Egress profile: [egress_profile]. Session: ~/bounty-agent-sessions/[domain]. Call bounty_read_findings, bounty_read_verification_round(round='final'), bounty_read_http_audit, and bounty_list_auth_profiles; collect bounded redacted samples for every final reportable finding using bounty_http_scan with target_domain and egress_profile; write only through bounty_write_evidence_packs.\")",
    "```",
  ].join("\n"),
  "{{SPAWN_GRADER_AGENT}}": [
    "```",
    "Agent(subagent_type: \"grader\", name: \"grader\", prompt: \"Domain: [domain]. Session: ~/bounty-agent-sessions/[domain]. Call bounty_read_findings, bounty_read_chain_attempts, bounty_read_verification_round(round='final'), and bounty_read_evidence_packs, score survivors, then write only through bounty_write_grade_verdict.\")",
    "```",
  ].join("\n"),
  "{{SPAWN_REPORTER_AGENT}}": [
    "```",
    "Agent(subagent_type: \"report-writer\", name: \"reporter\", prompt: \"Domain: [domain]. Session: ~/bounty-agent-sessions/[domain]. Call bounty_read_findings, bounty_read_chain_attempts, bounty_read_verification_round(round='final'), bounty_read_evidence_packs, and bounty_read_grade_verdict, then write report.md. For SUBMIT, include only confirmed chain evidence. For SKIP/no reportables, write a concise no-findings closeout with verification, chain-attempt, and blocker summary.\")",
    "```",
  ].join("\n"),
});

const CLAUDE_ROLE_SPECS = Object.freeze({
  orchestrator: Object.freeze({
    role_id: "orchestrator",
    kind: "skill",
    output_path: path.join(".claude", "skills", "bob-hunt", "SKILL.md"),
    name: "bob-hunt",
    disable_model_invocation: true,
    argument_hint: "[target-url | resume <domain> [force-merge]] [--deep] [--egress <profile>]",
    local_tools: Object.freeze(["Task", "Read"]),
  }),
  status: Object.freeze({
    role_id: "status",
    kind: "skill",
    output_path: path.join(".claude", "skills", "bob-status", "SKILL.md"),
    name: "bob-status",
    disable_model_invocation: true,
    argument_hint: "[--last | <target_domain>]",
    local_tools: Object.freeze([
      "Read",
      "Glob",
      "Bash(find *)",
      "Bash(ls *)",
      "Bash(node *)",
      "Bash(stat *)",
      "Bash(test *)",
    ]),
  }),
  debug: Object.freeze({
    role_id: "debug",
    kind: "skill",
    output_path: path.join(".claude", "skills", "bob-debug", "SKILL.md"),
    name: "bob-debug",
    disable_model_invocation: true,
    argument_hint: "[--last | <target_domain>] [--deep]",
    local_tools: Object.freeze([
      "Read",
      "Glob",
      "Grep",
      "Bash(find *)",
      "Bash(ls *)",
      "Bash(stat *)",
      "Bash(test *)",
    ]),
  }),
  recon: Object.freeze({
    role_id: "recon",
    kind: "agent",
    output_path: path.join(".claude", "agents", "recon-agent.md"),
    name: "recon-agent",
    description: "Runs bounded normal recon \u2014 subdomain enum, live hosts, archived URLs, nuclei, JS extraction \u2014 and produces attack_surface.json",
    model: "opus",
    color: "cyan",
    local_tools: Object.freeze(["Bash", "Read", "Write", "Glob", "Grep"]),
  }),
  "deep-recon": Object.freeze({
    role_id: "deep-recon",
    kind: "agent",
    output_path: path.join(".claude", "agents", "deep-recon-agent.md"),
    name: "deep-recon-agent",
    description: "Runs bounded passive discovery and produces compact attack_surface, deep-summary, and surface lead artifacts",
    model: "opus",
    color: "cyan",
    local_tools: Object.freeze(["Bash", "Read", "Write", "Glob", "Grep"]),
  }),
  "surface-router": Object.freeze({
    role_id: "surface-router",
    kind: "agent",
    output_path: path.join(".claude", "agents", "surface-router-agent.md"),
    name: "surface-router-agent",
    description: "Calls the MCP surface router after recon and reports the capability-pack summary",
    model: "sonnet",
    color: "blue",
    mcp_server: true,
    local_tools: Object.freeze(["Read"]),
  }),
  hunter: Object.freeze({
    role_id: "hunter",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-agent.md"),
    name: "hunter-agent",
    description: "Tests one attack surface for vulnerabilities \u2014 spawned per-surface with injected context from the orchestrator",
    model: "opus",
    color: "yellow",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Grep", "Glob"]),
  }),
  "hunter-evm": Object.freeze({
    role_id: "hunter-evm",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-evm-agent.md"),
    name: "hunter-evm-agent",
    description: "EVM smart-contract bug bounty hunter \u2014 spawned per smart_contract surface, scaffolds and runs Foundry tests against the public RPC ladder",
    model: "opus",
    color: "magenta",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Write", "Grep", "Glob"]),
  }),
  "hunter-svm": Object.freeze({
    role_id: "hunter-svm",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-svm-agent.md"),
    name: "hunter-svm-agent",
    description: "SVM (Solana) smart-contract bug bounty hunter \u2014 spawned per smart_contract surface with chain_family=svm, scaffolds and runs Anchor tests against the public Solana RPC ladder",
    model: "opus",
    color: "cyan",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Write", "Grep", "Glob"]),
  }),
  "hunter-move": Object.freeze({
    role_id: "hunter-move",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-move-agent.md"),
    name: "hunter-move-agent",
    description: "Move (Aptos + Sui) smart-contract bug bounty hunter \u2014 spawned per smart_contract surface with chain_family in {aptos, sui}, scaffolds and runs aptos move test or sui move test against the public Move RPC ladders",
    model: "opus",
    color: "blue",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Write", "Grep", "Glob"]),
  }),
  "hunter-substrate": Object.freeze({
    role_id: "hunter-substrate",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-substrate-agent.md"),
    name: "hunter-substrate-agent",
    description: "Substrate / ink! smart-contract bug bounty hunter \u2014 spawned per smart_contract surface with chain_family=substrate, scaffolds and runs cargo test on ink! contracts against the public Substrate JSON-RPC ladder",
    model: "opus",
    color: "pink",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Write", "Grep", "Glob"]),
  }),
  "hunter-cosmwasm": Object.freeze({
    role_id: "hunter-cosmwasm",
    kind: "agent",
    output_path: path.join(".claude", "agents", "hunter-cosmwasm-agent.md"),
    name: "hunter-cosmwasm-agent",
    description: "CosmWasm smart-contract bug bounty hunter \u2014 spawned per smart_contract surface with chain_family=cosmwasm, scaffolds and runs cargo test with cw-multi-test against the public CosmWasm REST ladder",
    model: "opus",
    color: "yellow",
    max_turns: 200,
    background: true,
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read", "Write", "Grep", "Glob"]),
  }),
  chain: Object.freeze({
    role_id: "chain",
    kind: "agent",
    output_path: path.join(".claude", "agents", "chain-builder.md"),
    name: "chain-builder",
    description: "Analyzes proven findings for credible exploit chains that elevate severity",
    model: "opus",
    color: "purple",
    mcp_server: true,
    local_tools: Object.freeze(["Write"]),
  }),
  "brutalist-verifier": Object.freeze({
    role_id: "brutalist-verifier",
    kind: "agent",
    output_path: path.join(".claude", "agents", "brutalist-verifier.md"),
    name: "brutalist-verifier",
    description: "Round 1 verification \u2014 re-runs PoCs with maximum skepticism, checks severity inflation, filters non-bugs",
    model: "sonnet",
    color: "red",
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read"]),
    // External @brutalist/mcp tools for the adversarial roast layer.
    // roast_cli_debate is intentionally excluded: the debate orchestrator
    // spawns multiple CLI agents and is too time-expensive for a per-finding
    // loop. Single-shot roast is the correct primitive here.
    extra_mcp_tools: Object.freeze([
      "mcp__brutalist__roast",
      "mcp__brutalist__brutalist_discover",
      "mcp__brutalist__cli_agent_roster",
    ]),
    // Brutalist MCP is optional \u2014 registered for availability but not gated.
    // Graceful fallback when missing is the brutalist-verifier prompt's job.
    extra_mcp_servers: Object.freeze(["brutalist"]),
  }),
  "balanced-verifier": Object.freeze({
    role_id: "balanced-verifier",
    kind: "agent",
    output_path: path.join(".claude", "agents", "balanced-verifier.md"),
    name: "balanced-verifier",
    description: "Round 2 verification \u2014 reviews brutalist decisions for false negatives and severity over-corrections",
    model: "opus",
    color: "blue",
    mcp_server: true,
    local_tools: Object.freeze(["Bash", "Read"]),
  }),
  "final-verifier": Object.freeze({
    role_id: "final-verifier",
    kind: "agent",
    output_path: path.join(".claude", "agents", "final-verifier.md"),
    name: "final-verifier",
    description: "Round 3 verification \u2014 re-runs only REPORTABLE findings with fresh requests as final confirmation",
    model: "sonnet",
    color: "green",
    mcp_server: true,
    local_tools: Object.freeze(["Bash"]),
  }),
  evidence: Object.freeze({
    role_id: "evidence",
    kind: "agent",
    output_path: path.join(".claude", "agents", "evidence-agent.md"),
    name: "evidence-agent",
    description: "Collects bounded pre-grade evidence packs for final reportable findings (HTTP via bounty_http_scan; SC via family runners)",
    model: "sonnet",
    color: "teal",
    mcp_server: true,
    local_tools: Object.freeze([]),
  }),
  grader: Object.freeze({
    role_id: "grader",
    kind: "agent",
    output_path: path.join(".claude", "agents", "grader.md"),
    name: "grader",
    description: "Scores verified findings on 5 axes and issues SUBMIT/HOLD/SKIP verdict",
    model: "sonnet",
    color: "orange",
    mcp_server: true,
    local_tools: Object.freeze([]),
  }),
  reporter: Object.freeze({
    role_id: "reporter",
    kind: "agent",
    output_path: path.join(".claude", "agents", "report-writer.md"),
    name: "report-writer",
    description: "Generates submission-ready bug bounty report from verified and graded findings",
    model: "sonnet",
    color: "green",
    mcp_server: true,
    // Read is needed so the reporter can pick up validated chain narratives
    // from chains.md (chain-builder writes prose; no MCP tool exposes it).
    local_tools: Object.freeze(["Write", "Read"]),
  }),
});

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())));
}

function claudeMcpToolsForRole(roleId) {
  return mcpToolNamesForRole(roleId).map(mcpPermissionForTool);
}

function claudeAllowedToolsForRole(roleId) {
  const spec = CLAUDE_ROLE_SPECS[roleId];
  if (!spec) throw new Error(`Missing Claude role spec for ${roleId}`);
  return uniqueStrings([
    ...(spec.local_tools || []),
    ...claudeMcpToolsForRole(roleId),
    ...(spec.extra_mcp_tools || []),
  ]);
}

function renderSkillFrontmatter(spec) {
  const allowedTools = claudeAllowedToolsForRole(spec.role_id);
  return [
    "---",
    `name: ${spec.name}`,
    `disable-model-invocation: ${spec.disable_model_invocation ? "true" : "false"}`,
    `argument-hint: ${JSON.stringify(spec.argument_hint)}`,
    "allowed-tools:",
    ...allowedTools.map((tool) => `  - ${tool}`),
    "---",
  ].join("\n");
}

function renderAgentFrontmatter(spec) {
  const lines = [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    `tools: ${claudeAllowedToolsForRole(spec.role_id).join(", ")}`,
    `model: ${spec.model}`,
    `color: ${spec.color}`,
  ];
  if (spec.max_turns) lines.push(`maxTurns: ${spec.max_turns}`);
  if (spec.background) lines.push("background: true");
  if (spec.mcp_server) {
    const mcpServers = uniqueStrings(["bountyagent", ...(spec.extra_mcp_servers || [])]);
    lines.push("mcpServers:");
    for (const server of mcpServers) lines.push(`  - ${server}`);
    // requiredMcpServers stays at bountyagent only — extra servers are optional
    // (graceful fallback). Bumping a server here makes the agent fail to spawn
    // when the server is missing, which we explicitly do not want for brutalist.
    lines.push("requiredMcpServers:", "  - bountyagent");
  }
  lines.push("---");
  return lines.join("\n");
}

function roleBody(roleId, { root = DEFAULT_ROOT } = {}) {
  const role = roleDefinition(roleId);
  const body = fs.readFileSync(path.join(root, role.prompt_body), "utf8").replace(/^\n+/, "");
  return renderClaudePromptBody(roleId, body);
}

function renderClaudePromptBody(roleId, body) {
  let document = body;
  if (roleId === "status") {
    document = document.replace(
      "{{STATUS_UPDATE_CACHE_COMMAND}}",
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/bob-update.js" status "$CLAUDE_PROJECT_DIR" --json',
    );
  }
  document = document
    .replace(/Use host-normal agent permissions by default/g, "Use normal Agent permissions by default")
    .replace(/Hunter waves MUST use the host's asynchronous\/background worker mechanism when available\./g, "Hunter waves MUST use `run_in_background: true`.")
    .replace(/host stop hooks are only adapter guardrails/g, "Claude `SubagentStop` is only an adapter guardrail")
    .replace(/Paste in the current agent session\./g, "Paste in Claude Code.");
  for (const [placeholder, template] of Object.entries(CLAUDE_LAUNCH_TEMPLATES)) {
    document = document.split(placeholder).join(template);
  }
  // Lazily-rendered, registry-driven placeholders. Substitution lives in
  // mcp/lib/capability-packs-rendering.js so the Codex renderer consumes
  // the same logic. Adding a pack to capability-packs.js updates every
  // consumer prompt at next regeneration.
  document = substituteCapabilityPackVerifierTable(document);
  return document
    .replace(/\/bob:hunt/g, "/bob-hunt")
    .replace(/\/bob:status/g, "/bob-status")
    .replace(/\/bob:debug/g, "/bob-debug")
    .replace(/\/bob:update/g, "/bob-update");
}

function renderClaudeRole(roleId, options = {}) {
  const spec = CLAUDE_ROLE_SPECS[roleId];
  if (!spec) throw new Error(`Missing Claude role spec for ${roleId}`);
  const frontmatter = spec.kind === "skill"
    ? renderSkillFrontmatter(spec)
    : renderAgentFrontmatter(spec);
  const separator = spec.kind === "agent" ? "\n\n" : "\n";
  return `${frontmatter}${separator}${roleBody(roleId, options)}`;
}

function claudeRoleOutputPath(roleId, { root = DEFAULT_ROOT } = {}) {
  const spec = CLAUDE_ROLE_SPECS[roleId];
  if (!spec) throw new Error(`Missing Claude role spec for ${roleId}`);
  return path.join(root, spec.output_path);
}

function updateClaudeRoleFile(roleId, { check = false, root = DEFAULT_ROOT } = {}) {
  const filePath = claudeRoleOutputPath(roleId, { root });
  const document = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  const nextDocument = renderClaudeRole(roleId, { root });
  if (document === nextDocument) return false;
  if (check) {
    throw new Error(`${path.relative(root, filePath)} is stale; run node scripts/generate-claude-roles.js`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextDocument, "utf8");
  return true;
}

function updateClaudeRoleFiles({ check = false, root = DEFAULT_ROOT, roleIds = Object.keys(CLAUDE_ROLE_SPECS) } = {}) {
  let changed = false;
  for (const roleId of roleIds) {
    changed = updateClaudeRoleFile(roleId, { check, root }) || changed;
  }
  return changed;
}

module.exports = {
  CLAUDE_ROLE_SPECS,
  claudeAllowedToolsForRole,
  claudeMcpToolsForRole,
  claudeRoleOutputPath,
  renderClaudePromptBody,
  renderClaudeRole,
  updateClaudeRoleFile,
  updateClaudeRoleFiles,
};
