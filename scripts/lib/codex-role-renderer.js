"use strict";

const fs = require("fs");
const path = require("path");
const {
  roleDefinition,
} = require("../../mcp/lib/role-model.js");
const {
  codexRoleSpec,
} = require("../../adapters/codex/role-specs.js");
const {
  substituteCapabilityPackVerifierTable,
} = require("../../mcp/lib/capability-packs-rendering.js");

const DEFAULT_ROOT = path.join(__dirname, "..", "..");
const CODEX_WORKER_CONTRACT_ROLE_IDS = Object.freeze([
  "recon",
  "deep-recon",
  "surface-router",
  "hunter",
  "hunter-evm",
  "hunter-svm",
  "hunter-move",
  "hunter-substrate",
  "hunter-cosmwasm",
  "chain",
  "brutalist-verifier",
  "balanced-verifier",
  "final-verifier",
  "evidence",
  "grader",
  "reporter",
]);

const CODEX_SKILL_SPECS = Object.freeze({
  hunt: Object.freeze({
    role_id: "orchestrator",
    output_path: path.join("adapters", "codex", "skills", "bob-hunt", "SKILL.md"),
    name: "bob-hunt",
    description: "Run or resume a Hacker Bob bug bounty hunt in Codex using the shared MCP runtime.",
  }),
  status: Object.freeze({
    role_id: "status",
    output_path: path.join("adapters", "codex", "skills", "bob-status", "SKILL.md"),
    name: "bob-status",
    description: "Read Hacker Bob session state, wave status, findings, verification, and grade summaries in Codex.",
  }),
  debug: Object.freeze({
    role_id: "debug",
    output_path: path.join("adapters", "codex", "skills", "bob-debug", "SKILL.md"),
    name: "bob-debug",
    description: "Debug Hacker Bob sessions in Codex using MCP telemetry and local session artifacts.",
  }),
  update: Object.freeze({
    output_path: path.join("adapters", "codex", "skills", "bob-update", "SKILL.md"),
    name: "bob-update",
    description: "Check for Hacker Bob package updates and guide project-local update installation from Codex.",
  }),
});

function renderFrontmatter(spec) {
  return [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    "---",
  ].join("\n");
}

function roleBody(roleId, { root = DEFAULT_ROOT } = {}) {
  const role = roleDefinition(roleId);
  return fs.readFileSync(path.join(root, role.prompt_body), "utf8").replace(/^\n+/, "");
}

function workerLabel(roleId) {
  const spec = codexRoleSpec(roleId);
  return `${spec.bob_role} -> Codex ${spec.agent_type}`;
}

function codexLaunchTemplates() {
  return Object.freeze({
    "{{SPAWN_RECON_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("recon")}.`,
      "- agent_type: \"worker\"",
      "- message: include `Bob role: recon-agent`, `DOMAIN=[domain]`, `SESSION=~/bounty-agent-sessions/[domain]`, and the full `recon` contract from Codex Worker Role Contracts below.",
      "Wait with `wait_agent` before continuing. After reading the result and checking `attack_surface.json`, call `close_agent` for the host agent.",
      "```",
    ].join("\n"),
    "{{SPAWN_DEEP_RECON_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("deep-recon")}.`,
      "- agent_type: \"worker\"",
      "- message: include `Bob role: deep-recon-agent`, `DOMAIN=[domain]`, `SESSION=~/bounty-agent-sessions/[domain]`, and the full `deep-recon` contract from Codex Worker Role Contracts below.",
      "Wait with `wait_agent` before continuing. After reading the result, call `close_agent` for the host agent.",
      "```",
    ].join("\n"),
    "{{SPAWN_SURFACE_ROUTER_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("surface-router")}.`,
      "- agent_type: \"worker\"",
      "- message: include `Bob role: surface-router-agent`, `Domain: [domain]`, `Session: ~/bounty-agent-sessions/[domain]`, and instruct the worker to confirm `attack_surface.json` exists and call `bounty_route_surfaces({ target_domain: '[domain]' })`. Include the full `surface-router` contract from Codex Worker Role Contracts below.",
      "Wait with `wait_agent`. If routing fails or returns zero surfaces, report the error and stop. After reading the result, call `close_agent` for the host agent.",
      "```",
    ].join("\n"),
    "{{SPAWN_HUNTER_AGENT}}": [
      "```text",
      "For each assignment, use Codex spawn_agent for the hunter family chosen by the MCP capability router (`assignment.hunter_agent` from bounty_start_wave.data.assignments[] — one of hunter-agent, hunter-evm-agent, hunter-svm-agent, hunter-move-agent, hunter-substrate-agent, or hunter-cosmwasm-agent).",
      "- agent_type: \"worker\"",
      "- message: include the compact run header below plus the full contract for `assignment.hunter_agent` from Codex Worker Role Contracts.",
      "- Header fields: Domain: [domain]; Wave: w[wave]; Agent: a[agent]; Surface: [surface_id]; Capability pack: [assignment.capability_pack]; Brief profile: [assignment.brief_profile]; Hunter agent: [assignment.hunter_agent]; Handoff token: [only this agent's handoff_token from bounty_start_wave.data.assignments]; Checkpoint mode: [normal|paranoid|yolo].",
      "- First action inside the worker: call bounty_read_hunter_brief({ target_domain: '[domain]', wave: 'w[wave]', agent: 'a[agent]' }) and use .data.",
      "- Track the local mapping `host_agent_id -> w[wave]/a[agent]/surface_id`; Bob's `aN` value is authoritative even if Codex displays a different nickname.",
      "- Respect Codex capacity. Launch only as many workers as the host accepts, keep the rest queued, and start queued assignments only after completed agents are closed.",
      "- Do not set `fork_context: true` when also setting `agent_type`; use a direct worker spawn unless Codex requires a different host default.",
      "Wait for worker completion notifications or `wait_agent` results. Do not merge in the launch turn.",
      "```",
    ].join("\n"),
    "{{SPAWN_CHAIN_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("chain")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: chain-builder. Domain: [domain]. Session: ~/bounty-agent-sessions/[domain].` Include the full `chain` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, validate expected output, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_BRUTALIST_VERIFIER}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("brutalist-verifier")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: brutalist-verifier. Session: ~/bounty-agent-sessions/[domain]. Target: [domain].` Include the full `brutalist-verifier` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read the MCP verification artifact, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_BALANCED_VERIFIER}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("balanced-verifier")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: balanced-verifier. Session: ~/bounty-agent-sessions/[domain]. Target: [domain].` Include the full `balanced-verifier` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read the MCP verification artifact, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_FINAL_VERIFIER}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("final-verifier")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: final-verifier. Session: ~/bounty-agent-sessions/[domain]. Target: [domain].` Include the full `final-verifier` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read the MCP verification artifact, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_GRADER_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("grader")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: grader. Domain: [domain]. Session: ~/bounty-agent-sessions/[domain].` Include the full `grader` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read `bounty_read_grade_verdict.data`, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_REPORTER_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("reporter")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: report-writer. Domain: [domain]. Session: ~/bounty-agent-sessions/[domain].` Include the full `reporter` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read the report, then `close_agent`.",
      "```",
    ].join("\n"),
    "{{SPAWN_EVIDENCE_AGENT}}": [
      "```text",
      `Use Codex spawn_agent for ${workerLabel("evidence")}.`,
      "- agent_type: \"worker\"",
      "- message: `Bob role: evidence-agent. Session: ~/bounty-agent-sessions/[domain]. Egress profile: [egress_profile].` Include the full `evidence` contract from Codex Worker Role Contracts.",
      "Wait with `wait_agent`, read `bounty_read_evidence_packs.data`, then `close_agent`.",
      "```",
    ].join("\n"),
    // Chain-specific hunter spawn references. The orchestrator embeds these
    // as type catalogue entries; the routed `assignment.hunter_agent` from
    // the MCP capability router is the runtime dispatch — Codex picks the
    // matching worker contract from the role appendix in this skill.
    "{{SPAWN_HUNTER_EVM_AGENT}}": [
      "```text",
      `For smart_contract_evm assignments: spawn Codex worker for ${workerLabel("hunter-evm")}.`,
      "- agent_type: \"worker\"",
      "- message: include the standard SC run header (Domain, Wave, Agent, Surface, Capability pack, Brief profile, Hunter agent, Handoff token, Checkpoint mode) plus the full `hunter-evm` contract from Codex Worker Role Contracts.",
      "```",
    ].join("\n"),
    "{{SPAWN_HUNTER_SVM_AGENT}}": [
      "```text",
      `For smart_contract_svm assignments: spawn Codex worker for ${workerLabel("hunter-svm")}.`,
      "- agent_type: \"worker\"",
      "- message: include the standard SC run header plus the full `hunter-svm` contract from Codex Worker Role Contracts.",
      "```",
    ].join("\n"),
    "{{SPAWN_HUNTER_MOVE_AGENT}}": [
      "```text",
      `For smart_contract_aptos and smart_contract_sui assignments: spawn Codex worker for ${workerLabel("hunter-move")}.`,
      "- agent_type: \"worker\"",
      "- message: include the standard SC run header plus the full `hunter-move` contract from Codex Worker Role Contracts. The hunter dispatches between bounty_aptos_* and bounty_sui_* internally based on surface.chain_family.",
      "```",
    ].join("\n"),
    "{{SPAWN_HUNTER_SUBSTRATE_AGENT}}": [
      "```text",
      `For smart_contract_substrate assignments: spawn Codex worker for ${workerLabel("hunter-substrate")}.`,
      "- agent_type: \"worker\"",
      "- message: include the standard SC run header plus the full `hunter-substrate` contract from Codex Worker Role Contracts.",
      "```",
    ].join("\n"),
    "{{SPAWN_HUNTER_COSMWASM_AGENT}}": [
      "```text",
      `For smart_contract_cosmwasm assignments: spawn Codex worker for ${workerLabel("hunter-cosmwasm")}.`,
      "- agent_type: \"worker\"",
      "- message: include the standard SC run header plus the full `hunter-cosmwasm` contract from Codex Worker Role Contracts.",
      "```",
    ].join("\n"),
  });
}

function applyCodexHostText(document) {
  return document
    .replace(
      "{{STATUS_UPDATE_CACHE_COMMAND}}",
      "node -e \"const update=require('./mcp/lib/update-check.js'); console.log(JSON.stringify(update.readUpdateCache(process.cwd()) || null, null, 2));\"",
    )
    .replace(/Use host-normal agent permissions by default/g, "Use Codex worker-agent permissions by default")
    .replace(/Hunter waves MUST use the host's asynchronous\/background worker mechanism when available\./g, "Hunter waves MUST use Codex `spawn_agent` workers and must respect host capacity.")
    .replace(/host stop hooks are only adapter guardrails/g, "Codex has no Bob stop hook; MCP finalization is the correctness boundary")
    .replace(/Claude Code enforces `maxTurns` as a turn budget, not a raw tool-call budget\./g, "The host may enforce turn budgets differently from raw tool-call budgets.")
    .replace(/Paste in the current agent session\./g, "Paste in the current Codex session.")
    .replace(/for Claude compatibility/g, "for host compatibility")
    .replace(/Claude transcript windows/g, "Codex session log windows")
    .replace(/Claude transcripts/g, "Codex session logs")
    .replace(/Claude transcript JSONL files/g, "Codex session log files")
    .replace(/Claude project JSONL files/g, "Codex session log files")
    .replace(/Claude Code/g, "Codex")
    .replace(/Do not use the `Task` tool by default\./g, "Do not spawn agents by default.")
    .replace(/Do not use `Task`\./g, "Do not spawn agents.")
    .replace(/\/bob-hunt/g, "$bob-hunt")
    .replace(/\/bob-status/g, "$bob-status")
    .replace(/\/bob-debug/g, "$bob-debug")
    .replace(/\/bob-update/g, "$bob-update")
    .replace(/\/bob:hunt/g, "$bob-hunt")
    .replace(/\/bob:status/g, "$bob-status")
    .replace(/\/bob:debug/g, "$bob-debug")
    .replace(/\/bob:update/g, "$bob-update");
}

function replaceLaunchTemplates(document) {
  let next = document;
  for (const [placeholder, template] of Object.entries(codexLaunchTemplates())) {
    next = next.split(placeholder).join(template);
  }
  return next;
}

function codexOrchestratorPreamble() {
  return [
    "## Codex Agent Mapping",
    "- Bob named roles are logical roles; Codex host agents are spawned as `worker` agents.",
    "- Bob `wN`, `aN`, `surface_id`, and `handoff_token` values are durable truth. Codex host agent IDs and nicknames are local execution metadata only.",
    "- If Codex does not expose Bob MCP tools yet, use tool discovery for `bounty_*` tools before falling back to local artifact reads.",
    "- This workflow requires background worker agents. Proceed only when the operator's request clearly authorizes Hacker Bob or agent execution; otherwise ask before spawning.",
    "",
  ].join("\n");
}

function codexRoleContractAppendix({ root = DEFAULT_ROOT } = {}) {
  const sections = [
    "",
    "## Codex Worker Role Contracts",
    "When spawning a Codex worker, include the matching contract below in that worker's message along with the run-specific header. These contracts replace host-native named subagents in Codex.",
  ];
  for (const roleId of CODEX_WORKER_CONTRACT_ROLE_IDS) {
    sections.push(
      "",
      `### ${roleId}`,
      `BEGIN ${roleId} CONTRACT`,
      // Substitute the capability-pack verifier table inside Codex worker
      // contracts too — verifier/evidence prompts embed the placeholder
      // and Codex workers read it from the appendix in bob-hunt SKILL.md.
      substituteCapabilityPackVerifierTable(applyCodexHostText(roleBody(roleId, { root })).trimEnd()),
      `END ${roleId} CONTRACT`,
    );
  }
  return sections.join("\n");
}

function renderCodexPromptBody(roleId, body, options = {}) {
  let document = applyCodexHostText(body);
  document = replaceLaunchTemplates(document);
  document = substituteCapabilityPackVerifierTable(document);
  if (roleId === "orchestrator") {
    document = document.replace("## Hard Rules\n", `${codexOrchestratorPreamble()}## Hard Rules\n`);
    document += `${codexRoleContractAppendix(options)}\n`;
  }
  return document;
}

function renderUpdateSkill() {
  return [
    "# Hacker Bob Update",
    "",
    "Use this when the operator asks to check, plan, or apply Hacker Bob updates from Codex.",
    "",
    "## Read Cache",
    "Read the passive local cache without network access:",
    "```bash",
    "node -e \"const update=require('./mcp/lib/update-check.js'); console.log(JSON.stringify(update.readUpdateCache(process.cwd()) || null, null, 2));\"",
    "```",
    "",
    "## Check Latest",
    "Run this only when the operator explicitly asks to check for updates:",
    "```bash",
    "node -e \"const update=require('./mcp/lib/update-check.js'); update.checkForUpdate(process.cwd(), { includeChangelog: true }).then((result) => console.log(update.renderUpdatePlan(result))).catch((error) => { console.error(error.message || String(error)); process.exit(1); });\"",
    "```",
    "",
    "## Apply Update",
    "Ask before updating. When confirmed, run from the project root:",
    "```bash",
    "npx -y hacker-bob@latest install \"$PWD\"",
    "```",
    "",
    "After installation, tell the operator to restart Codex in this project before continuing.",
    "",
  ].join("\n");
}

function renderCodexSkill(skillId, options = {}) {
  const spec = CODEX_SKILL_SPECS[skillId];
  if (!spec) throw new Error(`Missing Codex skill spec for ${skillId}`);
  const body = spec.role_id
    ? renderCodexPromptBody(spec.role_id, roleBody(spec.role_id, options), options)
    : renderUpdateSkill();
  return `${renderFrontmatter(spec)}\n\n${body}`;
}

function codexSkillOutputPath(skillId, { root = DEFAULT_ROOT } = {}) {
  const spec = CODEX_SKILL_SPECS[skillId];
  if (!spec) throw new Error(`Missing Codex skill spec for ${skillId}`);
  return path.join(root, spec.output_path);
}

function updateCodexSkillFile(skillId, { check = false, root = DEFAULT_ROOT } = {}) {
  const filePath = codexSkillOutputPath(skillId, { root });
  const nextDocument = renderCodexSkill(skillId, { root });
  const document = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (document === nextDocument) return false;
  if (check) {
    throw new Error(`${path.relative(root, filePath)} is stale; run node scripts/generate-codex-skills.js`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextDocument, "utf8");
  return true;
}

function updateCodexSkillFiles({ check = false, root = DEFAULT_ROOT, skillIds = Object.keys(CODEX_SKILL_SPECS) } = {}) {
  let changed = false;
  for (const skillId of skillIds) {
    changed = updateCodexSkillFile(skillId, { check, root }) || changed;
  }
  return changed;
}

module.exports = {
  CODEX_SKILL_SPECS,
  codexSkillOutputPath,
  renderCodexPromptBody,
  renderCodexSkill,
  updateCodexSkillFile,
  updateCodexSkillFiles,
};
