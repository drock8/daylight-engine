# SEGMENTATION-PLAN.md

Segmentation plan for Daylight Engine — reshaping the forked Hacker Bob codebase into four cumulative service tiers for Zer0Daylight.

**Status:** Draft — awaiting Derrick's review. No code changes made.

---

## Phase 1 — Repository Discovery

### 1.1 Project Overview

| Attribute | Value |
|---|---|
| Language | JavaScript (Node.js, no TypeScript) |
| Runtime | Node.js 20+ |
| Framework | MCP (Model Context Protocol) server + Claude Agent SDK orchestration |
| Build system | None (no transpilation/bundling — raw `.js` files) |
| Entry point | `bin/hacker-bob.js` (CLI) → `mcp/server.js` (MCP server facade) |
| Invocation model | Installed into a host project (Claude Code, Codex, or generic MCP client) as a plugin; orchestrated via LLM agent spawning |
| Packaging | npm package (`daylight-engine@0.1.0`); `npm pack` / `npx hacker-bob install <dir>` |
| Dependencies | `@anthropic-ai/claude-agent-sdk`, `proxy-agent`, `psl` (3 runtime deps) |
| Total files | ~461 files, ~120 core modules in `mcp/lib/`, 108 registered MCP tools |
| Test infra | 48 test files using Node.js built-in test runner (`node --test`) |
| CI | GitHub Actions: `ci.yml` (matrix Node 20/22), `release.yml`, `scorecard.yml` |
| Adapters | Claude Code, Codex (OpenAI), Generic MCP — adapter pattern in `adapters/` |

### 1.2 License Finding

**License:** Apache License 2.0 (full text in `LICENSE`).
**Copyright:** 2026 Michail Vasileiadis (original); 2026 Derrick Siu / Zer0Daylight (derivative — documented in `NOTICE`).

#### What Apache 2.0 permits for our tiering model

| Question | Answer |
|---|---|
| Can we create a free edition + paid editions? | **Yes.** Apache 2.0 allows sublicensing, commercial use, and proprietary derivative works. We can gate features behind paid tiers without violating the license. |
| Can we distribute a closed-source paid edition? | **Yes.** Apache 2.0 does not require derivative source disclosure (unlike GPL/AGPL). We can ship compiled/obfuscated paid tiers. |
| Can we gate capabilities behind a license key or config? | **Yes.** The license imposes no restriction on how the software is configured, deployed, or feature-gated. |
| Must we preserve attribution? | **Yes.** We must retain `LICENSE`, `NOTICE`, and any original copyright headers. We already do this. The `NOTICE` file documents both the original and derivative attribution. |
| Can we use the name "Hacker Bob" in customer-facing context? | **No** (Apache 2.0 §6 — trademarks not granted). We already use "Daylight Engine" externally. No exposure risk. |
| Copyleft / AGPL concerns? | **None.** Apache 2.0 is permissive. No copyleft obligations. No network-use clauses. |
| Patent grant? | **Yes.** Apache 2.0 includes an express patent grant from contributors. Covers our derivative use. |

**Verdict:** The license is fully compatible with a free+paid tiered model, including gating, closed-source editions, and commercial distribution. No license blockers.

### 1.3 Capability Inventory

108 MCP tools registered in `mcp/lib/tools/index.js`. The table below groups them by function and classifies each tool's **interaction class**, which is the backbone of tier assignment.

**Interaction class definitions:**
- **Observational** — Zero interaction with the target. Reads only public/already-available data, or operates on local session state.
- **Passive-active** — Touches the target but non-intrusively (e.g., HTTP GET, banner grab, DNS lookup). Does not modify target state.
- **Active/exploitative** — Probes, exploits, gains access, or modifies target state. Includes test-harness execution against live or forked targets.

#### A. Network Reconnaissance & HTTP Scanning

| # | Tool | What it does | Interaction | Files | Ext. Dependencies |
|---|------|-------------|-------------|-------|-------------------|
| 1 | `bounty_http_scan` | HTTP request with auto-analysis (headers, tech stack, secrets, misconfigs) | **Passive-active** | `tools/http-scan.js`, `lib/http-scan.js` | Network (HTTP client) |
| 2 | `bounty_read_http_audit` | Read HTTP request audit log from session | Observational | `tools/read-http-audit.js` | Local FS |
| 3 | `bounty_public_intel` | Fetch HackerOne program policy, stats, scopes | Observational | `tools/public-intel.js`, `lib/public-intel.js` | HackerOne API |
| 4 | `bounty_signup_detect` | Detect signup/registration endpoints (banner analysis) | **Passive-active** | `tools/signup-detect.js` | HTTP/DOM analysis |
| 5 | `bounty_import_http_traffic` | Import HTTP traffic logs (Burp/HAR) | Observational (local) | `tools/import-http-traffic.js` | FS, parsers |
| 6 | `bounty_extract_routes` | Regex-based route extraction from source code | Observational (local) | `tools/extract-routes.js` | Pattern matching |
| 7 | `bounty_static_scan` | Static code analysis on previously imported artifacts | Observational (local) | `tools/static-scan.js` | Static analysis |

#### B. Authentication & Multi-Account Testing

| # | Tool | What it does | Interaction | Files | Ext. Dependencies |
|---|------|-------------|-------------|-------|-------------------|
| 8 | `bounty_auto_signup` | Automated browser registration with CAPTCHA solving | **Active/exploitative** | `tools/auto-signup.js`, `mcp/auto-signup.js` | Patchright (Playwright), CapSolver |
| 9 | `bounty_temp_email` | Temporary email provider for signup workflows | **Passive-active** | `tools/temp-email.js`, `lib/temp-email.js` | Temp email APIs |
| 10 | `bounty_run_auth_differential` | Multi-account permission differential (auth bypass detection) | **Active/exploitative** | `tools/run-auth-differential.js` | `bounty_http_scan`, auth profiles |
| 11 | `bounty_read_auth_differential_results` | Read auth differential results | Observational (local) | `tools/read-auth-differential-results.js` | FS |
| 12 | `bounty_run_doc_delta` | Doc-vs-behavior API contract divergence testing | **Active/exploitative** | `tools/run-doc-delta.js` | `bounty_http_scan`, schema corpus |
| 13 | `bounty_read_doc_delta_results` | Read doc-delta results | Observational (local) | `tools/read-doc-delta-results.js` | FS |
| 14 | `bounty_auth_store` | Store/retrieve auth credentials per profile | Observational (local) | `tools/auth-store.js` | Encrypted FS |
| 15 | `bounty_list_auth_profiles` | List available auth profiles | Observational (local) | `tools/list-auth-profiles.js` | FS |

#### C. Blockchain Read-Only Queries

| # | Tool | What it does | Interaction | Files | Ext. Dependencies |
|---|------|-------------|-------------|-------|-------------------|
| 16 | `bounty_evm_call` | Read-only eth_call via public RPC | Observational | `tools/evm-call.js` | Public Ethereum RPCs |
| 17 | `bounty_evm_storage_read` | Read storage slot (eth_getStorageAt) | Observational | `tools/evm-storage-read.js` | Public Ethereum RPCs |
| 18 | `bounty_evm_fetch_source` | Fetch verified contract source (Sourcify/Etherscan) | Observational | `tools/evm-fetch-source.js` | Sourcify, Etherscan API |
| 19 | `bounty_evm_role_table` | Bulk role-membership check via RPC | Observational | `tools/evm-role-table.js` | Public Ethereum RPCs |
| 20 | `bounty_aptos_fetch_module` | Read Aptos module ABI | Observational | `tools/aptos-fetch-module.js` | Public Aptos REST |
| 21 | `bounty_aptos_fetch_resource` | Read Aptos account resource | Observational | `tools/aptos-fetch-resource.js` | Public Aptos REST |
| 22 | `bounty_cosmwasm_fetch_contract` | Read CosmWasm contract metadata | Observational | `tools/cosmwasm-fetch-contract.js` | Public Cosmos REST |
| 23 | `bounty_cosmwasm_smart_query` | Read-only CosmWasm smart query | Observational | `tools/cosmwasm-smart-query.js` | Public Cosmos REST |
| 24 | `bounty_substrate_fetch_runtime` | Read Substrate runtime version/chain | Observational | `tools/substrate-fetch-runtime.js` | Public Substrate RPC |
| 25 | `bounty_substrate_fetch_storage` | Read Substrate storage (SCALE-encoded) | Observational | `tools/substrate-fetch-storage.js` | Public Substrate RPC |
| 26 | `bounty_sui_fetch_object` | Read Sui object (ownership, type, content) | Observational | `tools/sui-fetch-object.js` | Public Sui RPC |
| 27 | `bounty_sui_fetch_package` | Read Sui Move module ABI | Observational | `tools/sui-fetch-package.js` | Public Sui RPC |
| 28 | `bounty_svm_fetch_account` | Read Solana account info | Observational | `tools/svm-fetch-account.js` | Public Solana RPC |
| 29 | `bounty_svm_fetch_program` | Fetch Solana program metadata (upgrade authority) | Observational | `tools/svm-fetch-program.js` | Public Solana RPC |

#### D. Blockchain Test Execution (Fork/Local Harness)

| # | Tool | What it does | Interaction | Files | Ext. Dependencies |
|---|------|-------------|-------------|-------|-------------------|
| 30 | `bounty_foundry_run` | Run Foundry forge tests (fork-pinned) | **Active/exploitative** | `tools/foundry-run.js` | Foundry (forge), RPC |
| 31 | `bounty_halmos_run` | Symbolic execution via Halmos | **Active/exploitative** | `tools/halmos-run.js` | Halmos (Python), pip |
| 32 | `bounty_anchor_run` | Run Anchor tests (Solana fork) | **Active/exploitative** | `tools/anchor-run.js` | Anchor CLI |
| 33 | `bounty_aptos_run` | Run Aptos Move tests | **Active/exploitative** | `tools/aptos-run.js` | Aptos CLI |
| 34 | `bounty_cosmwasm_run` | Run CosmWasm cargo tests | **Active/exploitative** | `tools/cosmwasm-run.js` | Cargo |
| 35 | `bounty_substrate_run` | Run ink! Substrate tests | **Active/exploitative** | `tools/substrate-run.js` | Cargo, ink! |
| 36 | `bounty_sui_run` | Run Sui Move tests | **Active/exploitative** | `tools/sui-run.js` | Sui CLI |
| 37 | `bounty_run_invariant_for_finding` | Generate + run Foundry invariant test from finding | **Active/exploitative** | `tools/run-invariant-for-finding.js` | Foundry, template corpus |

#### E. Session State & Pipeline Management

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 38 | `bounty_init_session` | Initialize session (target, auth, phases) | Observational (local) | `tools/init-session.js` |
| 39 | `bounty_transition_phase` | Transition between phases (FSM) | Observational (local) | `tools/transition-phase.js` |
| 40 | `bounty_read_session_state` | Read persisted session state | Observational (local) | `tools/read-session-state.js` |
| 41 | `bounty_read_session_summary` | Read phase-by-phase progress | Observational (local) | `tools/read-session-summary.js` |
| 42 | `bounty_read_state_summary` | Read condensed state metadata | Observational (local) | `tools/read-state-summary.js` |
| 43–50 | Wave tools (`start_wave`, `start_next_wave`, `wave_status`, `wave_handoff_status`, `merge_wave_handoffs`, `apply_wave_merge`, `write_handoff`, `write_wave_handoff`) | Wave orchestration and merge | Observational (local) | `tools/start-wave.js` etc. |
| 51 | `bounty_finalize_hunter_run` | Finalize hunter wave run | Observational (local) | `tools/finalize-hunter-run.js` |
| 52 | `bounty_read_wave_handoffs` | Read wave handoff data | Observational (local) | `tools/read-wave-handoffs.js` |

#### F. Attack Surface Discovery & Routing

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 53 | `bounty_build_surface_graph` | Build attack surface graph | Observational (local) | `tools/build-surface-graph.js` |
| 54 | `bounty_query_surface_graph` | Query surface graph | Observational (local) | `tools/query-surface-graph.js` |
| 55 | `bounty_build_symbol_surface_index` | Index routes by file:line → surface | Observational (local) | `tools/build-symbol-surface-index.js` |
| 56 | `bounty_summarize_diff_impact` | Diff → impacted surfaces | Observational (local) | `tools/summarize-diff-impact.js` |
| 57 | `bounty_route_surfaces` | Classify surfaces into capability packs | Observational (local) | `tools/route-surfaces.js` |
| 58–60 | Surface lead tools (`record`, `read`, `promote`) | Surface lead management | Observational (local) | `tools/record-surface-leads.js` etc. |

#### G. Findings, Evidence & Grading

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 61 | `bounty_record_finding` | Record a vulnerability finding | Observational (local) | `tools/record-finding.js` |
| 62 | `bounty_read_findings` | Read findings | Observational (local) | `tools/read-findings.js` |
| 63 | `bounty_list_findings` | List finding summaries | Observational (local) | `tools/list-findings.js` |
| 64 | `bounty_index_finding` | Index finding with feature vector | Observational (local) | `tools/index-finding.js` |
| 65 | `bounty_query_findings_index` | Query findings by similarity | Observational (local) | `tools/query-findings-index.js` |
| 66 | `bounty_write_evidence_packs` | Write evidence packs | Observational (local) | `tools/write-evidence-packs.js` |
| 67 | `bounty_read_evidence_packs` | Read evidence packs | Observational (local) | `tools/read-evidence-packs.js` |
| 68 | `bounty_write_grade_verdict` | Write grade verdict (SUBMIT/HOLD/SKIP) | Observational (local) | `tools/write-grade-verdict.js` |
| 69 | `bounty_read_grade_verdict` | Read grade verdict | Observational (local) | `tools/read-grade-verdict.js` |
| 70 | `bounty_report_written` | Mark report as written | Observational (local) | `tools/report-written.js` |

#### H. Chain State & Exploit Tracking

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 71–76 | Chain tools (`write_chain_attempt`, `read_chain_attempts`, `append_chain_node`, `query_chain_tree`, `chain_frontier`, `chain_ancestry`) | Chain state tree management | Observational (local) | `tools/write-chain-attempt.js` etc. |

#### I. Verification & Audit

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 77 | `bounty_write_verification_round` | Persist verification round | Observational (local) | `tools/write-verification-round.js` |
| 78 | `bounty_read_verification_round` | Read verification round | Observational (local) | `tools/read-verification-round.js` |
| 79 | `bounty_read_verification_context` | Read verification context | Observational (local) | `tools/read-verification-context.js` |
| 80 | `bounty_diff_verification_attempts` | Compare verification attempts | Observational (local) | `tools/diff-verification-attempts.js` |
| 81 | `bounty_build_verification_adjudication` | Build adjudication records | Observational (local) | `tools/build-verification-adjudication.js` |
| 82 | `bounty_ingest_audit_report` | Parse markdown audit report | Observational (local) | `tools/ingest-audit-report.js` |
| 83 | `bounty_query_audit_reports` | Query ingested audits | Observational (local) | `tools/query-audit-reports.js` |
| 84 | `bounty_ingest_schema_doc` | Ingest API schema into corpus | Observational (local) | `tools/ingest-schema-doc.js` |
| 85 | `bounty_query_schema_contracts` | Query schema corpus | Observational (local) | `tools/query-schema-contracts.js` |

#### J. Invariant & CVE Tools

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 86 | `bounty_suggest_invariants` | Suggest invariant test templates | Observational (local) | `tools/suggest-invariants.js` |
| 87 | `bounty_read_invariant_runs` | Read invariant test results | Observational (local) | `tools/read-invariant-runs.js` |

Note: `cve-feed-parser.js` and `cve-scope-matcher.js` exist as library modules but are **not exposed as standalone MCP tools** — they're used internally by other modules for CVE correlation.

#### K. Telemetry, Analytics & Capability Management

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 88 | `bounty_read_tool_telemetry` | Read tool-call metrics | Observational (local) | `tools/read-tool-telemetry.js` |
| 89 | `bounty_read_capability_metrics` | Aggregate metrics by capability | Observational (local) | `tools/read-capability-metrics.js` |
| 90 | `bounty_read_pipeline_analytics` | Phase progress, wave health | Observational (local) | `tools/read-pipeline-analytics.js` |
| 91 | `bounty_log_coverage` | Log coverage checkpoint | Observational (local) | `tools/log-coverage.js` |
| 92 | `bounty_log_dead_ends` | Log dead-end branches | Observational (local) | `tools/log-dead-ends.js` |
| 93 | `bounty_log_technique_attempt` | Log technique attempt | Observational (local) | `tools/log-technique-attempt.js` |

#### L. Hunter Brief & Capability Pack Management

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 94 | `bounty_read_hunter_brief` | Read hunter assignment brief | Observational (local) | `tools/read-hunter-brief.js` |
| 95 | `bounty_read_capability_playbook` | Read capability playbook | Observational (local) | `tools/read-capability-playbook.js` |
| 96 | `bounty_select_technique_packs` | Select technique packs for phase | Observational (local) | `tools/select-technique-packs.js` |
| 97 | `bounty_read_technique_pack` | Read technique pack | Observational (local) | `tools/read-technique-pack.js` |
| 98 | `bounty_evaluate_capabilities` | Run capability evaluation harness | Observational (local) | `tools/evaluate-capabilities.js` |
| 99 | `bounty_get_context_budget` | Return context budget for pack | Observational (local) | `tools/get-context-budget.js` |

#### M. Operator & Artifact Tools

| # | Tool | What it does | Interaction | Files |
|---|------|-------------|-------------|-------|
| 100 | `bounty_import_static_artifact` | Import static artifact (source, bytecode) | Observational (local) | `tools/import-static-artifact.js` |
| 101 | `bounty_set_operator_note` | Set operator instruction | Observational (local) | `tools/set-operator-note.js` |
| 102 | `bounty_clear_operator_note` | Clear operator note | Observational (local) | `tools/clear-operator-note.js` |
| 103 | `bounty_clear_terminal_block` | Clear phase transition block | Observational (local) | `tools/clear-terminal-block.js` |

#### N. Recon Agents (Not MCP Tools — Shell-Based)

The RECON phase is not implemented as MCP tools. Instead, two agent prompts (`prompts/roles/recon.md`, `prompts/roles/deep-recon.md`) contain hardcoded Bash scripts that run external recon tools:

| Recon Capability | What it does | Interaction | External Tool |
|---|---|---|---|
| Subdomain enumeration | Passive subdomain discovery | Observational | `subfinder`, `amass`, `assetfinder`, `chaos` |
| Certificate transparency | CT log query via crt.sh API | Observational | `curl` + crt.sh |
| Passive DNS (deep mode) | DNS resolution, CNAME chains | Observational | `dnsx` |
| TLS certificate analysis (deep) | SAN extraction, cert metadata | Observational | `tlsx` |
| Subdomain takeover probe (deep) | Dangling CNAME fingerprinting | **Passive-active** | `subzy` |
| Live host probing | HTTP probing for live hosts + tech detect | **Passive-active** | `httpx` |
| Web crawling | Spidering for URL discovery | **Passive-active** | `katana` |
| Wayback/CDX URL harvesting | Historical URL retrieval | Observational | `curl` + Wayback API |
| Vulnerability scanning | Known-CVE / misconfig scanning | **Active/exploitative** | `nuclei` |
| Family discovery | First-party related domain/host discovery | **Passive-active** | `curl` + Python script |

#### Interaction Class Summary

| Class | MCP Tool Count | Recon (Shell) Count | Total |
|---|---|---|---|
| Observational (read-only, zero target interaction) | ~82 | 4 | ~86 |
| Passive-active (non-intrusive target touch) | 4 | 4 | 8 |
| Active/exploitative (probes, exploits, modifies) | 12 | 1 | 13 |
| Local-only (session state, no network) | ~10 (subset of observational) | — | ~10 |

### 1.4 Architecture Map

```
┌──────────────────────────────────────────────────┐
│                  HOST SURFACE                     │
│  (Claude Code / Codex / Generic MCP Client)       │
│                                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Claude       │ │ Codex        │ │ Generic    │ │
│  │ Adapter      │ │ Adapter      │ │ MCP Adapter│ │
│  └──────┬───────┘ └──────┬───────┘ └─────┬──────┘ │
└─────────┼────────────────┼───────────────┼────────┘
          │                │               │
          └────────────────┼───────────────┘
                           │
              ┌────────────▼────────────┐
              │    MCP Server Facade    │
              │    (mcp/server.js)      │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │     Tool Dispatch       │
              │   (mcp/lib/dispatch.js) │
              │  ┌───────────────────┐  │
              │  │  Tool Registry    │  │
              │  │  (108 tools)      │  │
              │  ├───────────────────┤  │
              │  │  Tool Policy      │  │
              │  │  Tool Validation  │  │
              │  │  Tool Telemetry   │  │
              │  └───────────────────┘  │
              └────────────┬────────────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
    ▼                      ▼                      ▼
┌─────────┐    ┌──────────────────┐    ┌──────────────┐
│ Session  │    │ Tool Runtimes    │    │ Capability   │
│ State    │    │ (http-scan,      │    │ Packs &      │
│ Layer    │    │  foundry-run,    │    │ Routing      │
│          │    │  evm-client,     │    │              │
│ FSM,     │    │  auth-diff, etc) │    │ Wave Plan,   │
│ Storage, │    │                  │    │ Surface      │
│ Phase    │    │                  │    │ Router       │
│ Gates    │    │                  │    │              │
└─────────┘    └──────────────────┘    └──────────────┘
                           │
              ┌────────────▼────────────┐
              │  Session Artifacts      │
              │  ~/bounty-agent-        │
              │  sessions/{domain}/     │
              │                         │
              │  state.json             │
              │  attack_surface.json    │
              │  findings.jsonl         │
              │  evidence-packs.json    │
              │  report.md              │
              └─────────────────────────┘
```

#### Key Coupling Points

1. **Phase FSM ↔ Wave Merging** — `phase-gates.js` and `waves.js` share coverage computation logic. Tightly coupled but both are session-local (no network interaction).
2. **Capability Packs ↔ Tool Registry ↔ Agent Prompts** — Adding a capability pack requires changes in `capability-packs.js`, role bundles in `tool-registry.js`, and agent prompt regeneration. Centralized but multi-file.
3. **Orchestrator Prompt** — `prompts/roles/orchestrator.md` (27KB) hard-codes spawn templates, phase logic, and handoff fields. Changes require prompt regeneration via scripts.
4. **Recon is Shell-Based** — Unlike all other capabilities which are MCP tools, RECON runs as Bash scripts embedded in agent prompts. This is actually advantageous for tiering — recon can be forked/modified independently of the MCP tool layer.

#### Separation-Favorable Properties

- **Role bundles** already gate which tools each agent can see — a natural tier boundary mechanism.
- **Capability packs** already define self-contained hunting profiles (web, evm, svm, etc.) — extending this to tier-level gating is architecturally natural.
- **Session state** is local filesystem — no shared database or network state between runs.
- **Tool metadata flags** (`network_access`, `scope_required`, `mutating`) already classify tools by risk level.

### 1.5 Existing Tests, CI, Docs

| Category | Status |
|---|---|
| Unit tests | 48 files, comprehensive coverage of core modules (MCP server, contracts, parsers, runners) |
| Integration tests | `doc-delta-e2e.test.js`, policy replay harness |
| CI | GitHub Actions matrix (Node 20/22), runs full suite |
| Linting/type checking | None (raw JS, no TypeScript, no ESLint configured) |
| Documentation | Extensive: `README.md`, `CONTRIBUTING.md`, `DISCLAIMER.md`, `SECURITY.md`, `CLAUDE.md`, `docs/` (architecture specs, adapter docs, roadmap, 35 release notes) |
| Release process | `release-check.js` validation, `CHANGELOG.md` maintained |

---

## Phase 2 — Capability → Tier Mapping

### 2.1 Tier Assignment Table

For each capability, the tier is determined by its interaction class and the tier definitions. The assignment follows the cumulative model: Tier 0 ⊂ 1 ⊂ 2 ⊂ 3.

#### Recon Phase (Shell-Based)

| Capability | Interaction | Proposed Tier | Justification |
|---|---|---|---|
| Subdomain enumeration (subfinder, amass, assetfinder, chaos) | Observational | **Tier 0** | Passive DNS/CT — no target interaction |
| Certificate transparency (crt.sh) | Observational | **Tier 0** | Public CT logs, no target interaction |
| Passive DNS resolution (dnsx) | Observational | **Tier 0** | DNS is public infrastructure, no target touch |
| TLS certificate metadata (tlsx) | **Passive-active** | **Tier 1** | Connects to target TLS port — crosses the Tier 0 safety boundary |
| Subdomain takeover probing (subzy) | **Passive-active** | **Tier 1** | Connects to targets to fingerprint dangling CNAMEs |
| Live host probing (httpx) | **Passive-active** | **Tier 1** | Sends HTTP requests to targets |
| Web crawling (katana) | **Passive-active** | **Tier 1** | Actively spiders target websites |
| Wayback/CDX URL harvesting | Observational | **Tier 0** | Reads archive.org — no target interaction |
| Vulnerability scanning (nuclei) | **Active/exploitative** | **Tier 1** | Sends probe payloads to targets |
| Family discovery (curl + analysis) | **Passive-active** | **Tier 1** | Fetches target pages |

#### MCP Tools

| Capability | Interaction | Proposed Tier | Justification |
|---|---|---|---|
| `bounty_http_scan` | Passive-active | **Tier 1** | Sends HTTP requests to target |
| `bounty_public_intel` | Observational | **Tier 0** | Reads public HackerOne data (no target interaction) |
| `bounty_signup_detect` | Passive-active | **Tier 1** | Probes target for signup endpoints |
| `bounty_auto_signup` | Active/exploitative | **Tier 2** | Creates accounts on target (intent-requiring) |
| `bounty_temp_email` | Passive-active | **Tier 1** | Third-party email API (supports auth workflows) |
| `bounty_run_auth_differential` | Active/exploitative | **Tier 2** | Multi-account auth bypass testing (intent-requiring) |
| `bounty_run_doc_delta` | Active/exploitative | **Tier 2** | Active API contract probing (intent-requiring) |
| All blockchain read-only queries (#16–29) | Observational | **Tier 0** | Read public chain state — zero target interaction |
| All blockchain test runners (#30–37) | Active/exploitative | **Tier 3** | Fork-based exploit execution, symbolic execution, invariant testing — adversarial discovery |
| `bounty_foundry_run` | Active/exploitative | **Tier 2 (basic) / Tier 3 (invariants, Halmos)** | Split: single-test replay = Tier 2 verification; invariant/symbolic = Tier 3 novel discovery |
| `bounty_halmos_run` | Active/exploitative | **Tier 3** | Symbolic execution for novel zero-day discovery |
| `bounty_run_invariant_for_finding` | Active/exploitative | **Tier 3** | Invariant generation + execution — novel discovery |
| All session state tools (#38–52) | Local only | **Tier 0** (shared infrastructure) | Pipeline infrastructure, no network interaction |
| All surface discovery tools (#53–60) | Local only | **Tier 0** (shared infrastructure) | Local processing of already-gathered data |
| All findings/evidence/grading tools (#61–70) | Local only | **Tier 0** (shared infrastructure) | Local state management |
| All chain state tools (#71–76) | Local only | **Tier 2** | Chain-phase evidence tracking |
| All verification tools (#77–85) | Local only | **Tier 1** | Verification pipeline infrastructure |
| All telemetry/analytics (#88–93) | Local only | **Tier 0** (shared infrastructure) | Observational metadata |
| All hunter brief/capability tools (#94–99) | Local only | **Tier 0** (shared infrastructure) | Pack management |
| CVE feed parser + scope matcher | Local only | **Tier 0** | Matches already-observed tech to known CVEs — pure computation on public data |
| Bypass tables (`.hacker-bob/bypass-tables/`) | Local only | **Tier 2** | Attack pattern knowledge for manual testing |

### 2.2 Tier Summary

#### Tier 0 / First Look (FREE — Observational Only)

**Available capabilities from existing codebase:**
- Subdomain enumeration (subfinder, amass, assetfinder, chaos)
- Certificate transparency (crt.sh API)
- Passive DNS resolution (dnsx — note: ONLY the resolution query, not any active probing)
- Wayback/CDX historical URL harvesting
- Blockchain read-only queries (all 14 tools — eth_call, storage read, fetch source, etc.)
- Public intel (HackerOne program data)
- CVE feed parsing + scope matching (match observed tech stack to known CVEs)
- All session/pipeline infrastructure tools (local state management)

**What needs to be built for Tier 0:**
1. **Passive-only recon script** — A new recon agent prompt that strips out all passive-active tools (httpx, katana, nuclei, curl-to-target, subzy). Must use ONLY subfinder/amass/chaos (API-based), crt.sh (API-based), passive DNS (resolution only), and Wayback/CDX (archive API).
2. **Business-language report generator** — The existing reporter agent produces technical bug-bounty reports. Tier 0 needs a completely different output: plain-language risk interpretation for non-technical business owners. Risk framed as breach/reputation/compliance impact, not CVE lists.
3. **Domain-only input** — The existing `bounty_init_session` accepts `target_domain` and `target_url`. Tier 0 needs to accept only a domain name (no URL probing).
4. **Email-gated delivery** — Report delivery gated to email at the queried domain. New capability needed.
5. **Anti-abuse controls** — Rate limiting, domain verification, preventing recon-as-a-service abuse.

**Tagline validation:** "Free exposure check" — **Supportable.** Passive recon + CVE matching + CT logs can genuinely reveal exposure (leaked subdomains, known-vulnerable versions inferred from public data, certificate issues, dangling DNS). The interpretation layer is what makes it valuable vs. raw data dumps from incumbents.

#### Tier 1 / Daylight (Baseline Hygiene — Entry Paid)

**Adds over Tier 0:**
- `bounty_http_scan` (HTTP probing with auto-analysis)
- Live host probing (`httpx`)
- Web crawling (`katana`)
- TLS probing (`tlsx`)
- Subdomain takeover detection (`subzy`)
- Vulnerability scanning (`nuclei` — known CVEs, misconfigurations)
- Signup detection (`bounty_signup_detect`)
- Temp email support (`bounty_temp_email`)
- Full RECON phase (normal mode — all 7 Bash steps)
- Verification pipeline (all verification tools)
- VERIFY + GRADE + REPORT phases

**What needs to be built for Tier 1:**
1. **Tier-aware orchestrator** — Modified orchestrator prompt that limits the phase pipeline to RECON → HUNT (1 wave, no auth) → VERIFY → GRADE → REPORT.
2. **Single-wave constraint** — Wave planner capped at 1 wave for Tier 1.
3. **No-auth mode enforced** — AUTH phase skipped (already supported via `--no-auth` flag).

**Tagline validation:** "Baseline hygiene" — **Supportable.** Automated scanning catches exposed versions, weak headers, known CVEs, misconfigurations, missing patches. This is exactly what automated scanners do.

#### Tier 2 / Spotlight (Assessment — Human-Driven)

**Adds over Tier 1:**
- `bounty_auto_signup` (account creation for access-control testing)
- `bounty_run_auth_differential` (multi-account permission bypass)
- `bounty_run_doc_delta` (API contract divergence testing)
- AUTH phase (full 4-tier signup flow)
- CHAIN phase (exploit chaining)
- Multi-wave HUNT (wave planner uncapped)
- Deep recon mode (`--deep`)
- Bypass tables (attack patterns for manual testing support)
- `bounty_foundry_run` (single-test PoC replay for verification)
- All chain-specific test runners (basic usage — single test replay)

**What needs to be built for Tier 2:**
1. **Auth differential playbooks** — Already exist as C2 and C4 playbooks. Just need tier gating.
2. **Multi-wave enablement** — Already supported. Just needs tier config to enable.

**Tagline validation:** "Full hands-on assessment" — **Supportable.** Auth bypass testing, business logic flaw discovery, multi-account differential, API contract testing — these are exactly the intent-requiring flaws scanners miss.

#### Tier 3 / Hypernova (Adversarial — Elite)

**Adds over Tier 2:**
- `bounty_halmos_run` (symbolic execution for novel discovery)
- `bounty_run_invariant_for_finding` (invariant generation + execution)
- Invariant template corpus (full access)
- Deep recon with lead promotion (exhaustive discovery)
- Multi-wave HUNT with 3 verification rounds
- All test runners at full capability (not just replay — novel test generation)

**What needs to be built for Tier 3:**
1. **3-round verification** — Already supported architecturally (brutalist, balanced, final rounds). Just needs config to require all three.
2. **Exhaustive wave planning** — Already supported via existing wave mechanics. Needs config for higher wave/coverage thresholds.

**Tagline validation:** "Elite attack simulation" — **Supportable.** Symbolic execution, invariant-based fuzzing, multi-chain exploit chaining, novel zero-day discovery. This is genuine adversarial capability.

### 2.3 Gap Analysis

| Gap | Tier Affected | Severity | Notes |
|---|---|---|---|
| **No passive-only recon mode exists** | Tier 0 | **Critical** | Current RECON always uses active tools (httpx, nuclei, katana, curl). A new observational-only recon script must be built. |
| **No business-language report format** | Tier 0 | **Critical** | Reporter outputs technical bug-bounty reports. Tier 0 needs a completely different report targeting non-technical business owners. |
| **No email-gated delivery** | Tier 0 | **Critical** | No mechanism exists to gate report delivery to domain-verified email. Must be built. |
| **No domain-only input mode** | Tier 0 | **Medium** | `bounty_init_session` accepts `target_url` as required alongside `target_domain`. Tier 0 should accept domain only. |
| **No anti-abuse / rate limiting** | Tier 0 | **Medium** | No mechanism to prevent free-tier abuse. Must be built for the hosted service. |
| **No tier configuration system** | All | **High** | The engine has no concept of tiers. A tier config that controls which tools, phases, and capabilities are available must be added. |
| **No hosted/SaaS runtime** | All | **High** | Currently CLI-only, designed for operator workstations. A hosted service wrapper is needed at minimum for Tier 0. |
| **Web-only RECON** | Tier 0 | **Low** | The existing recon is entirely web-focused. Blockchain read-only tools exist but aren't part of the recon flow. For Tier 0, web-domain recon is sufficient. |

### 2.4 Can the Codebase Produce Tier 0 Today?

**No.** The current codebase cannot produce a Tier 0 (observational-only, domain-input) scan. Specific reasons:

1. **RECON is always active** — Even the "normal" recon script uses `httpx` (active probing), `nuclei` (vulnerability scanning), `katana` (crawling), and `curl` against the target. There is no passive-only codepath.
2. **No report format for non-experts** — The reporter agent produces technical vulnerability reports for bug bounty submission. Tier 0 needs business-framed risk interpretation.
3. **No domain-only input** — The orchestrator requires a target URL, not just a domain name.
4. **No email gating** — No mechanism exists for domain-email verification or report delivery gating.

However, the building blocks exist:
- Subdomain tools (subfinder, amass, etc.) are already used in recon and are observational.
- crt.sh integration exists in deep-recon.
- CVE feed parser and scope matcher exist as library modules.
- Blockchain read-only tools are already observational.
- The session/findings/report pipeline is reusable.

**Estimated effort to build Tier 0:** Medium — new passive recon agent prompt, new business-report agent prompt, tier config system, email gating, and a lightweight hosted wrapper.

---

## Phase 3 — Separation Architecture

### 3.1 Options Evaluated

#### Option A: Feature-Gating in One Codebase (Runtime Flags)

A single deployment contains all tiers. A `tier_level` config (0–3) at session init determines which tools are available, which phases run, and which recon script is used.

| Criterion | Assessment |
|---|---|
| Engineering effort | **Low.** Add tier config to `bounty_init_session`, gate tools in `dispatch.js` by comparing `tool.min_tier` against session tier, add `tier` field to each tool registration. |
| Coupling fit | **Good.** The existing role-bundle system already gates tool access per agent. Adding tier-level gating is a natural extension. |
| Maintenance burden | **Low.** Single codebase, single test suite, single CI pipeline. |
| License interaction | **Clean.** Apache 2.0 allows any configuration/gating model. |
| Security / blast radius | **RISKY for Tier 0.** A misconfiguration, bug in the gating layer, or prompt injection could escalate a Tier 0 session to active capabilities. The safety boundary is a runtime check, not a structural guarantee. |
| Upstream sync | **Best.** Single fork, single merge target. |

#### Option B: Shared Core + Separate Editions

One `@daylight/core` package with session/pipeline infrastructure. Thin tier-specific builds (`@daylight/first-look`, `@daylight/daylight`, etc.) import only the tools and agents they need.

| Criterion | Assessment |
|---|---|
| Engineering effort | **High.** Requires splitting the current monolith into packages, managing cross-package dependencies, setting up a monorepo build (e.g., npm workspaces). |
| Coupling fit | **Moderate.** Most modules are already fairly decoupled via the tool registry, but the recon phase (shell scripts in prompts) and orchestrator prompt (27KB monolith) resist clean package boundaries. |
| Maintenance burden | **Moderate.** Multiple packages to version, test, and publish. But shared core reduces duplication. |
| License interaction | **Clean.** |
| Security / blast radius | **Good.** Tier 0 edition literally cannot import active tools — they're in a different package. Structural guarantee. |
| Upstream sync | **Harder.** Upstream merges must be mapped to the right sub-package. |

#### Option C: Tier 0 Separate, Paid Tiers Together (Recommended)

Tier 0 (First Look) is built as a **lightweight, standalone service** — its own codebase with only observational capabilities, new passive-recon logic, and the business-report generator. It shares utility code with the main engine but cannot import or execute any active tool.

Tiers 1–3 remain in the main daylight-engine codebase, gated by runtime tier config (Option A for the paid tiers). This hybrid gives the strongest safety guarantee where it matters most (the Tier 0 → Tier 1 boundary) while keeping the paid tiers simple.

| Criterion | Assessment |
|---|---|
| Engineering effort | **Medium.** Build Tier 0 as a new thin project that imports shared utilities from daylight-engine. Paid tier gating is the lightweight Option A approach. |
| Coupling fit | **Excellent.** Tier 0's capabilities (passive recon, CVE matching, business reporting) don't overlap with the MCP tool pipeline. They're fundamentally different code that happens to use some shared parsing/CVE libraries. |
| Maintenance burden | **Low-Medium.** Two codebases, but Tier 0 is small and stable (observational-only capabilities rarely change). Paid tier maintenance is single-codebase. |
| License interaction | **Clean.** |
| Security / blast radius | **Excellent for Tier 0.** Structural isolation — the Tier 0 service literally cannot call `bounty_http_scan` or any active tool because they don't exist in its dependency tree. This is a **provable guarantee**, not a runtime check. |
| Upstream sync | **Good.** Main engine is still a single fork. Tier 0 is mostly new code with minimal upstream dependency. |

### 3.2 Recommendation: Option C (Tier 0 Separate + Paid Tiers Gated)

**Why Option C wins:**

1. **The Tier 0 → Tier 1 boundary is the single most important safety constraint.** You called it out explicitly. Option C is the only architecture that provides a **structural guarantee** — not a runtime check, not a flag, not a policy. The active tools literally don't exist in the Tier 0 deployment. A bug, misconfiguration, or prompt injection cannot escalate to active scanning because there's nothing to escalate to.

2. **Tier 0 is fundamentally different code.** The free tier needs: passive-only recon (new), business-language reporting (new), email-gated delivery (new), anti-abuse controls (new), and a hosted web service wrapper (new). Almost none of this exists in the current codebase. Building it inside the existing engine would be awkward — shoehorning a lightweight web service into a CLI-first bug-bounty framework.

3. **Paid tiers are naturally incremental.** Tiers 1–3 differ in depth/breadth of the same capabilities — more waves, more phases, more verification rounds. Runtime gating (tier config + tool min_tier) handles this cleanly. The existing `--no-auth`, `--deep`, and checkpoint mode flags already demonstrate this pattern.

4. **Upstream sync is preserved.** The main engine stays as a single fork of hacker-bob. Tier 0 is mostly new code with minimal upstream dependency (maybe shared CVE parser, shared constants).

### 3.3 Architecture Detail

```
┌─────────────────────────────────┐    ┌──────────────────────────────────────┐
│      TIER 0: FIRST LOOK        │    │     TIERS 1-3: DAYLIGHT ENGINE       │
│      (Standalone Service)       │    │     (Single Codebase, Tier-Gated)    │
│                                 │    │                                      │
│  ┌───────────────────────────┐  │    │  ┌────────────────────────────────┐  │
│  │  Passive Recon Module     │  │    │  │  Full MCP Server + 108 Tools   │  │
│  │  - subfinder/amass API    │  │    │  │  (gated by session tier_level) │  │
│  │  - crt.sh API             │  │    │  │                                │  │
│  │  - passive DNS            │  │    │  │  tier_1: http_scan, nuclei,    │  │
│  │  - Wayback/CDX API        │  │    │  │          httpx, katana, ...    │  │
│  │  - NO httpx/nuclei/katana │  │    │  │  tier_2: + auth_differential,  │  │
│  │  - NO http_scan           │  │    │  │          + auto_signup, ...     │  │
│  │  - NO curl-to-target      │  │    │  │  tier_3: + halmos, invariants, │  │
│  └───────────────────────────┘  │    │  │          + symbolic exec        │  │
│                                 │    │  └────────────────────────────────┘  │
│  ┌───────────────────────────┐  │    │                                      │
│  │  CVE Matcher              │  │    │  ┌────────────────────────────────┐  │
│  │  (shared lib from engine) │  │    │  │  Tier Config Module            │  │
│  └───────────────────────────┘  │    │  │  - tier_level in session state │  │
│                                 │    │  │  - min_tier on each tool       │  │
│  ┌───────────────────────────┐  │    │  │  - phase pipeline per tier     │  │
│  │  Business Report Writer   │  │    │  │  - wave/verification limits    │  │
│  │  (new — plain language)   │  │    │  └────────────────────────────────┘  │
│  └───────────────────────────┘  │    │                                      │
│                                 │    │  ┌────────────────────────────────┐  │
│  ┌───────────────────────────┐  │    │  │  Orchestrator + Agents         │  │
│  │  Email Gate & Delivery    │  │    │  │  (tier-aware spawn templates)  │  │
│  │  (new)                    │  │    │  └────────────────────────────────┘  │
│  └───────────────────────────┘  │    │                                      │
│                                 │    │  Phases available by tier:           │
│  ┌───────────────────────────┐  │    │  T1: RECON→HUNT(1w)→VERIFY→GRADE    │
│  │  Web Service Wrapper      │  │    │      →REPORT                        │
│  │  (API / queue listener)   │  │    │  T2: RECON→AUTH→HUNT(multi)→CHAIN   │
│  └───────────────────────────┘  │    │      →VERIFY→GRADE→REPORT           │
│                                 │    │  T3: RECON(deep)→AUTH→HUNT(exhaust)  │
│  INPUT: domain name only       │    │      →CHAIN→VERIFY(3-round)→GRADE    │
│  OUTPUT: business risk report   │    │      →REPORT                        │
│  DELIVERY: domain-email gated  │    │                                      │
└─────────────────────────────────┘    └──────────────────────────────────────┘
                │                                       │
                └───────────┬───────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │  Shared Utilities     │
                │  (extracted package)  │
                │  - cve-feed-parser    │
                │  - cve-scope-matcher  │
                │  - validation.js      │
                │  - constants.js       │
                │  - storage.js         │
                └───────────────────────┘
                            │
                ┌───────────▼───────────┐
                │  Supabase Queue       │
                │  (Zer0Daylight site   │
                │   → engine comms)     │
                └───────────────────────┘
```

### 3.4 Output Model Recommendations

| Tier | Primary Output | Format | Delivery |
|---|---|---|---|
| **Tier 0 / First Look** | Business risk report | HTML email + hosted web page | Email-gated to domain address; public link with token |
| **Tier 1 / Daylight** | Technical vulnerability report | Markdown + PDF | Delivered via dashboard / email to customer |
| **Tier 2 / Spotlight** | Detailed assessment report | Markdown + PDF + evidence packs | Dashboard + scheduled review call |
| **Tier 3 / Hypernova** | Full audit report + PoC artifacts | Markdown + PDF + evidence + test harnesses | Dashboard + debrief call + remediation support |

**Tier 0 strongly implies a hosted component.** The domain-in → email-out → business-report flow cannot be a CLI experience for the end customer (they're non-technical business owners). Tier 0 must be a web service: the Zer0Daylight website submits a domain + email, the First Look service runs a passive scan, generates a business report, and delivers via email. This aligns with the Phase 1 architecture (Supabase queue between website and engine).

**Tiers 1–3 can start as CLI** (Derrick runs manually in terminal — Phase 1 concierge model) and migrate to hosted later.

### 3.5 Safety Constraint Enforcement

#### Constraint 1: Tier 0 → Tier 1 Boundary (No Active Capabilities)

**Enforcement:** Structural isolation. The Tier 0 service is a separate codebase that does not import, include, or have access to any MCP tool with `network_access: true` or `scope_required: true`. The `bounty_http_scan`, `bounty_auto_signup`, `bounty_run_auth_differential`, and all test runners do not exist in its dependency tree.

**Verification:** Tier 0's `package.json` lists only passive dependencies. A CI check can verify that no active tool module is importable from the Tier 0 entry point (static import graph analysis).

**Prompt safety:** Tier 0's recon agent prompt contains only observational Bash commands (subfinder API, crt.sh API, passive DNS, Wayback API). No `httpx`, `nuclei`, `katana`, `curl`-to-target, or any tool that sends packets to the target domain.

#### Constraint 2: Active Capabilities Gated Behind Authorization

**Enforcement (Tiers 1–3):** The existing `bounty_init_session` already requires `target_domain` and `target_url`. We add:
- `tier_level` (1/2/3) to session init — determines available tools and phases.
- `authorization_token` — proof of domain ownership / testing authorization (verified against Supabase).
- Tool dispatch in `dispatch.js` checks `tool.min_tier <= session.tier_level` before execution. Tools above the session tier return `TIER_BLOCKED` error.
- All active tools already have `scope_required: true` and are gated by the existing session authority system.

**All active capabilities are off by default** — they require explicit session initialization with a tier level and authorization.

#### Constraint 3: No Accidental Privilege Escalation

**Enforcement:**
- Tier 0: Structural — cannot escalate because active code doesn't exist.
- Tiers 1–3: `tier_level` is set once at `bounty_init_session` and stored in `state.json`. `transition_phase` and tool dispatch validate against persisted tier level. The tier cannot be changed mid-session (no "upgrade" path in the FSM). A new session must be initialized at the higher tier.
- Tool registry validation: Each tool's `min_tier` is a frozen constant in the tool module, not a runtime-configurable value.

#### Constraint 4: Tier 0 Anti-Abuse (Email Gating)

**Enforcement:** The First Look service requires an email address at the queried domain as the delivery target. Flow:
1. User enters domain name on Zer0Daylight website.
2. User enters business email. Default: must be `*@{queried-domain}` or a subdomain thereof.
3. Verification email sent with confirmation link.
4. Scan runs only after email verification.
5. Report delivered only to the verified email.

**Verification fallback:** For legitimate businesses on generic email (Gmail/Outlook), a fallback path: user must verify domain ownership via DNS TXT record or meta tag. This prevents the free tool from being used as recon-as-a-service against arbitrary third parties.

---

## Phase 4 — Benchmark Harness (Tier 0 Competitiveness)

### 4.1 Design

The benchmark harness validates that Tier 0 (First Look) delivers competitive value — not by matching free incumbents on raw data volume, but by winning on interpretation, precision, and time-to-insight.

#### Test Corpus (20–50 targets)

| Category | Count | Source | Consent |
|---|---|---|---|
| Zer0Daylight-owned domains | 3–5 | Our own infrastructure | Self-authorized |
| Deliberately vulnerable test ranges | 5–10 | OWASP Juice Shop, DVWA, HackTheBox free, etc. | Open-license / designed for testing |
| Design partner domains | 5–15 | Early customers who opt in | Written consent documenting passive-only scope |
| Public-facing well-known domains | 5–10 | Major public sites (for passive recon baseline only) | Passive-only — no consent needed for public CT/DNS data |

**Consent documentation:** All targets have documented authorization in `benchmark/CONSENT.md`, regardless of passivity. Each entry records: domain, consent source, date, scope (passive-only), and contact.

#### Metrics

| Metric | What it Measures | Goal | How Scored |
|---|---|---|---|
| **Coverage** | % of union baseline (Amass + Subfinder + Shodan InternetDB + crt.sh) that Tier 0 surfaces | Not embarrass ourselves (≥60% of union) | Automated: compare Tier 0 output against union set, compute intersection/union ratio |
| **Precision / FP rate** | % of Tier 0 findings that are genuine (not stale, not misattributed, not unreachable) | **Win** (≥90% precision) | Manual verification of random sample (20 findings per corpus run) + automated staleness check (re-query after N days) |
| **Time-to-first-insight** | Wall-clock seconds from domain input to first actionable finding | **Win** (< 60s) | Automated: timestamp first finding in output vs. scan start time |
| **Interpretability** | Can a non-expert correctly state their top risk after reading the report? | **The wedge metric — must win** | Scored via user study (see below) |
| **Freshness** | How stale are Tier 0 findings compared to current target state? | < 24h staleness for DNS/cert data | Automated: compare Tier 0 output against fresh queries, measure age of oldest data point |

#### Interpretability Scoring

This is the hardest metric and the one that matters most. Proposed method:

1. **Panel recruitment:** 5–10 non-technical participants (small business owners, marketing managers, ops staff — not developers or security professionals).
2. **Protocol:** Each participant receives 3 Tier 0 reports (for different test domains). After reading each report, they answer:
   - "What is the single biggest risk to this business right now?" (open text)
   - "How confident are you in that assessment?" (1–5 scale)
   - "What would you do next?" (open text)
3. **Scoring:** Two security professionals independently grade each response:
   - **Correct identification** (0/1): Did the participant identify a genuine top risk?
   - **Specificity** (0/1): Was the response specific (not just "we might get hacked")?
   - **Actionability** (0/1): Did the "what next" suggest a reasonable action?
4. **Aggregate:** Interpretability score = average across participants × 3 dimensions. Target: ≥70%.

**Comparison:** Run the same protocol with raw output from Shodan, Amass, and crt.sh presented as-is. Tier 0 should score significantly higher because we interpret the data; incumbents dump it.

#### Named Free Competitors

| Competitor | What it does | Our advantage |
|---|---|---|
| Shodan (free + InternetDB API) | Port/service discovery, banner grabbing | We interpret; they dump raw data |
| Censys | Certificate + host search | We contextualize risk; they provide search results |
| Amass | Subdomain enumeration | We match to CVEs and frame as business risk |
| Subfinder | Fast subdomain discovery | We add interpretation layer |
| theHarvester | Email + subdomain + IP enumeration | We provide actionable report, not raw lists |
| Recon-ng | Modular OSINT framework | We're turnkey, not a framework requiring expertise |
| crt.sh | Certificate transparency search | We parse and correlate; they show raw CT log entries |
| Passive DNS providers | Historical DNS data | We use as input, not as output |

#### Harness Mechanics

```
benchmark/
├── CONSENT.md              # Authorization documentation
├── corpus.json             # Target list with metadata
├── runners/
│   ├── tier0.js            # Run Tier 0 First Look scan
│   ├── amass.js            # Run Amass baseline
│   ├── subfinder.js        # Run Subfinder baseline
│   ├── shodan.js           # Run Shodan InternetDB query
│   ├── crtsh.js            # Run crt.sh query
│   └── union-baseline.js   # Compute union of all baselines
├── scorers/
│   ├── coverage.js         # Coverage % computation
│   ├── precision.js        # FP rate sampling
│   ├── time-to-insight.js  # Timing measurement
│   ├── freshness.js        # Staleness computation
│   └── interpretability.js # Survey result ingestion
├── results/                # Timestamped run results
│   └── {YYYY-MM-DD}/
├── reports/                # Human-readable comparison reports
└── README.md               # Harness documentation
```

**Execution:** `npm run benchmark` runs all tools on the full corpus, same day, same machine. Results stored as structured JSON. Comparison report generated automatically. Designed to run in CI on every release (except interpretability, which requires human subjects).

---

## Phase 5 — Implementation Roadmap

### Milestone 1: Tier Configuration System (Foundation)

**What changes:**
- Add `min_tier` field to every tool definition in `mcp/lib/tools/*.js` (integer 0–3).
- Add `tier_level` parameter to `bounty_init_session` input schema; persist in `state.json`.
- Add tier check to `dispatch.js`: if `tool.min_tier > session.tier_level`, return `{ ok: false, error: { code: "TIER_BLOCKED" } }`.
- Add phase pipeline config per tier (which phases are available, wave limits, verification round counts).
- Update `tool-registry.js` validation to require `min_tier` field.

**How tested:**
- Unit tests: dispatch rejects tools above tier, accepts tools at/below tier.
- Unit tests: init-session validates tier_level.
- Integration test: full scan at tier_1 cannot call tier_2+ tools.
- Existing test suite passes (all tools assigned a min_tier, backward compatible).

**Upstream sync:** Minimal impact — new field on tool modules, new param on init-session. Upstream merges just need `min_tier` added to any new tools.

**Risk:** Low. Additive change, no existing behavior modified.

### Milestone 2: Tier 0 / First Look Service (MVP)

**What changes:**
- New directory: `first-look/` (or separate repo — TBD based on preference).
- Passive-only recon module: subfinder API, crt.sh API, passive DNS (resolution-only via `dig`/`dnsx`), Wayback/CDX API. No httpx, nuclei, katana, curl-to-target.
- CVE matching: Extract `cve-feed-parser.js` and `cve-scope-matcher.js` as shared utilities (or copy — they're small, ~200 lines each).
- Business report generator: New LLM prompt that takes passive recon data + CVE matches and produces a plain-language risk report.
- Email-gated delivery: Simple email verification flow + report delivery.
- Web service wrapper: Listens on Supabase queue for scan requests from the Zer0Daylight website. Runs passive scan. Delivers report via email.
- Anti-abuse: Rate limiting (per-domain, per-IP), domain-email verification.

**How tested:**
- Unit tests: passive recon produces expected output for test domains.
- Integration test: end-to-end scan of a Zer0Daylight-owned domain produces a report.
- **Safety test:** Static analysis confirms no active tool/module is importable from the First Look entry point.
- Manual test: report is readable and useful to a non-technical person.

**Upstream sync:** No impact on main engine. First Look is new code.

**Risk:** Medium. New code, new service, new deployment. But scope is small and well-defined.

**Rollback:** First Look is standalone — can be disabled/removed without affecting paid tiers.

### Milestone 3: Paid Tier Gating (Tiers 1–3)

**What changes:**
- Assign `min_tier` values to all 108 tools per the Phase 2 mapping.
- Modify orchestrator prompt to be tier-aware: skip AUTH phase for tier_1, limit waves for tier_1, require 3 verification rounds for tier_3, etc.
- Add tier-specific orchestrator templates (or tier-conditional sections in the existing orchestrator prompt).
- Update wave planner to respect tier-level wave caps.
- Update verification pipeline to respect tier-level round requirements.

**How tested:**
- Unit tests: tier_1 session skips AUTH, limits to 1 wave.
- Unit tests: tier_2 session enables AUTH, multi-wave, chain phase.
- Unit tests: tier_3 session enables deep recon, 3 verification rounds.
- Full integration: run a tier_1 scan against test target, verify output matches expectations.
- Existing test suite passes.

**Upstream sync:** Moderate impact — orchestrator prompt changes need reconciliation with upstream prompt updates. Tier fields on tools need adding to upstream-added tools.

**Risk:** Medium. Orchestrator prompt modification is the highest-risk change — it's 27KB and tightly coupled to phase logic.

### Milestone 4: Benchmark Harness

**What changes:**
- New `benchmark/` directory with runners, scorers, corpus, and consent documentation.
- CI job to run automated metrics (coverage, time-to-insight, freshness) on every release.
- Documentation for manual interpretability testing protocol.

**How tested:**
- Harness runs successfully against test corpus.
- Automated metrics produce structured JSON output.
- Comparison report generates correctly.

**Upstream sync:** No impact. New directory, no existing code modified.

**Risk:** Low. Additive, no behavioral changes.

### Milestone 5: Integration & Polish

**What changes:**
- Wire Tier 0 to Zer0Daylight website via Supabase queue.
- Wire paid tiers to Supabase queue (scan request → engine → report delivery).
- End-to-end testing of full customer journey: domain input → email verification → scan → report → paid tier upsell.
- Documentation: tier comparison page, API docs, deployment guide.

**How tested:**
- End-to-end: submit domain on website, receive Tier 0 report via email.
- End-to-end: Derrick initiates Tier 1 scan via CLI, report generated.
- Load testing: Tier 0 handles concurrent scan requests.

**Upstream sync:** No impact on engine code.

**Risk:** Medium. Integration work across multiple systems (website, engine, Supabase, email).

### Milestone Order & Dependencies

```
M1 (Tier Config) ──→ M3 (Paid Tier Gating)
                          │
M2 (First Look)  ────────┤
                          │
M4 (Benchmark)   ────────┤
                          │
                     M5 (Integration)
```

M1 and M2 can proceed in parallel. M3 depends on M1. M4 and M5 depend on M2 and M3.

**Recommended order:** M1 → M2 (parallel) → M3 → M4 → M5.

---

## Open Questions for Derrick

1. **Tier 0 location:** ~~Separate repo or within daylight-engine?~~ **Decided: Separate repo.** Built from scratch for strongest isolation guarantee.

2. **Blockchain in Tier 0:** ~~Include smart contract exposure checks?~~ **Decided: No.** Web-domain only for MVP.

3. **Recon tool dependencies:** ~~Install on VPS, API-only, or containerize?~~ **Decided: Containerize.** Docker container with all passive recon tools pre-installed.

4. **Tier naming in code:** ~~Store public names in engine?~~ **Decided: No.** Engine uses `tier_0`–`tier_3` only. Public names (First Look/Daylight/Spotlight/Hypernova) are website display only.

5. **Existing pricing alignment:** ~~Update memory?~~ **Decided: Yes.** Memory updated to reflect new tier naming (First Look / Daylight / Spotlight / Hypernova). Old names (Teaser/Starter/Pro/Eclipse) are superseded.

6. **Paid tier auth mode for Tier 1:** ~~Should Tier 1 be hardcoded to `--no-auth`?~~ **Decided: Yes.** Tier 1 is hardcoded `--no-auth`. Auth testing is exclusively a Tier 2+ capability. This keeps a clean tier boundary — auth testing (broken access controls, account takeover, business-logic flaws) is the defining capability jump that justifies the Tier 2 price.

7. **Interpretability benchmark timeline:** ~~Block launch or add later?~~ **Decided: Launch first, benchmark later.** Automated metrics (coverage, precision, time-to-insight) sufficient for initial validation.

---

**End of SEGMENTATION-PLAN.md. No code has been modified. Awaiting review before any implementation begins.**
