const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { TOOLS, TOOL_MANIFEST } = require("../mcp/server.js");
const {
  bountyagentSkillAllowedTools,
  defaultClaudeSettings,
  defaultGlobalMcpPermissions,
  isOrchestratorOnlyMutator,
  permissionsForRoleBundles,
} = require("../mcp/lib/claude-config.js");
const {
  AGENT_TOOL_SPECS,
  toolsForSpec,
} = require("../scripts/generate-agent-tools.js");
const {
  CAPABILITY_PACKS,
  hunterAgentNamesForCapabilityPacks,
} = require("../mcp/lib/capability-packs.js");

const ROOT = path.join(__dirname, "..");

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function lineCount(relativePath) {
  return readFile(relativePath).trimEnd().split(/\r?\n/).length;
}

function sourceAllowedMcpTools() {
  const settings = JSON.parse(readFile(".claude/settings.json"));
  return new Set(
    settings.permissions.allow
      .filter((tool) => tool.startsWith("mcp__bountyagent__"))
      .map((tool) => tool.replace(/^mcp__bountyagent__/, "")),
  );
}

function scriptAllowedMcpTools(relativePath) {
  return new Set(
    Array.from(readFile(relativePath).matchAll(/"mcp__bountyagent__(bounty_[A-Za-z0-9_]+)"/g))
      .map((match) => match[1]),
  );
}

function generatedAllowedMcpTools() {
  return new Set(
    defaultClaudeSettings().permissions.allow
      .filter((tool) => tool.startsWith("mcp__bountyagent__"))
      .map((tool) => tool.replace(/^mcp__bountyagent__/, "")),
  );
}

function orchestratorReferencedMcpTools() {
  return new Set(
    Array.from(readFile(".claude/skills/bob-hunt/SKILL.md").matchAll(/\b(bounty_[A-Za-z0-9_]+)\b/g))
      .map((match) => match[1]),
  );
}

function allMarkdown(relativeDir) {
  return fs.readdirSync(path.join(ROOT, relativeDir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(relativeDir, name));
}

function settingsHookMatchers() {
  const settings = JSON.parse(readFile(".claude/settings.json"));
  return new Set((settings.hooks.PreToolUse || []).map((entry) => entry.matcher));
}

function parseFrontmatter(document, fileLabel) {
  const match = document.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${fileLabel} is missing YAML frontmatter`);

  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const parsed = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!parsed) continue;
    frontmatter[parsed[1]] = parsed[2];
  }
  return frontmatter;
}

function parseYamlListFrontmatter(document, key, fileLabel) {
  const match = document.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${fileLabel} is missing YAML frontmatter`);
  const lines = match[1].split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `${fileLabel} is missing ${key}`);
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("  - ")) break;
    values.push(line.slice(4));
  }
  return values;
}

test("hunter frontmatter excludes Write and still exposes wave handoff MCP tools", () => {
  const document = readFile(".claude/agents/hunter-agent.md");
  const frontmatter = parseFrontmatter(document, "hunter-agent.md");
  const tools = frontmatter.tools.split(/\s*,\s*/).filter(Boolean);

  assert.ok(!tools.includes("Write"));
  assert.ok(tools.includes("Bash"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_write_wave_handoff"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_record_finding"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_list_auth_profiles"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_log_coverage"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_http_audit"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_import_static_artifact"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_static_scan"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_record_surface_leads"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_surface_leads"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_get_context_budget"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_select_technique_packs"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_technique_pack"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_log_technique_attempt"));
  assert.ok(!tools.includes("mcp__bountyagent__bounty_import_http_traffic"));
  assert.ok(!tools.includes("mcp__bountyagent__bounty_public_intel"));
  assert.ok(!tools.includes("mcp__bountyagent__bounty_auth_manual"));
  assert.ok(!tools.includes("mcp__bountyagent__bounty_read_handoff"));
});

test("surface-router-agent is thin and cannot hunt or write directly", () => {
  const document = readFile(".claude/agents/surface-router-agent.md");
  const frontmatter = parseFrontmatter(document, "surface-router-agent.md");
  const tools = frontmatter.tools.split(/\s*,\s*/).filter(Boolean);

  assert.deepEqual(tools, [
    "Read",
    "mcp__bountyagent__bounty_route_surfaces",
    "mcp__bountyagent__bounty_get_context_budget",
  ]);
  assert.match(document, /mcpServers:\s*\n\s*-\s*bountyagent/);
  assert.match(document, /bounty_route_surfaces/);
  assert.match(document, /surface-routes\.json/);
  assert.doesNotMatch(frontmatter.tools, /Bash|Write|bounty_http_scan|curl|browser/i);
  assert.match(document, /Do not do recon, hunting, auth, HTTP requests, browser work, Bash, or direct file writes/);
});

test("generated hunter-agent tools come from the hunter-web bundle", () => {
  const spec = AGENT_TOOL_SPECS["hunter-agent.md"];
  assert.deepEqual(spec.roleBundles, ["hunter-web"]);
  assert.deepEqual(
    toolsForSpec(spec).filter((tool) => tool.startsWith("mcp__bountyagent__")).sort(),
    permissionsForRoleBundles(["hunter-web"]).sort(),
  );
});

test("manifest, settings, and generated Claude config keep global MCP permissions narrowed", () => {
  const manifestTools = new Set(Object.keys(TOOL_MANIFEST));
  const registeredTools = new Set(TOOLS.map((tool) => tool.name));
  const sourceAllowed = sourceAllowedMcpTools();
  const generatedAllowed = generatedAllowedMcpTools();
  const expectedGlobalAllowed = new Set(
    defaultGlobalMcpPermissions().map((tool) => tool.replace(/^mcp__bountyagent__/, "")),
  );

  assert.deepEqual([...manifestTools].sort(), [...registeredTools].sort());
  assert.deepEqual([...sourceAllowed].sort(), [...expectedGlobalAllowed].sort());
  assert.deepEqual([...generatedAllowed].sort(), [...expectedGlobalAllowed].sort());

  for (const [toolName, metadata] of Object.entries(TOOL_MANIFEST)) {
    assert.equal(typeof metadata.global_preapproval, "boolean", `${toolName} missing global_preapproval`);
    assert.equal(
      sourceAllowed.has(toolName),
      metadata.global_preapproval,
      `${toolName} source global preapproval mismatch`,
    );
    assert.equal(
      generatedAllowed.has(toolName),
      metadata.global_preapproval,
      `${toolName} generated global preapproval mismatch`,
    );
    if (isOrchestratorOnlyMutator(toolName)) {
      assert.ok(!sourceAllowed.has(toolName), `${toolName} should not be globally pre-approved`);
    }
  }
  assert.equal(TOOL_MANIFEST.bounty_merge_wave_handoffs.global_preapproval, false);
  assert.equal(TOOL_MANIFEST.bounty_merge_wave_handoffs.mutating, false);
  assert.deepEqual(TOOL_MANIFEST.bounty_read_tool_telemetry.role_bundles, ["orchestrator"]);
  assert.equal(TOOL_MANIFEST.bounty_read_tool_telemetry.global_preapproval, false);
  assert.equal(TOOL_MANIFEST.bounty_read_tool_telemetry.mutating, false);
  assert.deepEqual(TOOL_MANIFEST.bounty_read_pipeline_analytics.role_bundles, ["orchestrator"]);
  assert.equal(TOOL_MANIFEST.bounty_read_pipeline_analytics.global_preapproval, false);
  assert.equal(TOOL_MANIFEST.bounty_read_pipeline_analytics.mutating, false);
  assert.deepEqual(TOOL_MANIFEST.bounty_route_surfaces.role_bundles, ["orchestrator", "router"]);
  assert.equal(TOOL_MANIFEST.bounty_route_surfaces.global_preapproval, false);
  assert.equal(TOOL_MANIFEST.bounty_route_surfaces.mutating, true);
  assert.deepEqual(TOOL_MANIFEST.bounty_record_surface_leads.role_bundles, ["hunter", "hunter-web", "orchestrator"]);
  assert.equal(TOOL_MANIFEST.bounty_record_surface_leads.global_preapproval, true);
  assert.equal(TOOL_MANIFEST.bounty_read_surface_leads.global_preapproval, true);
  assert.equal(TOOL_MANIFEST.bounty_promote_surface_leads.global_preapproval, false);
  assert.equal(TOOL_MANIFEST.bounty_promote_surface_leads.mutating, true);
  assert.deepEqual(TOOL_MANIFEST.bounty_get_context_budget.role_bundles, ["hunter", "hunter-web", "orchestrator", "router"]);
  assert.deepEqual(TOOL_MANIFEST.bounty_select_technique_packs.role_bundles, ["hunter", "hunter-web", "orchestrator"]);
  assert.deepEqual(TOOL_MANIFEST.bounty_read_technique_pack.role_bundles, ["hunter", "hunter-web", "orchestrator"]);
  assert.deepEqual(TOOL_MANIFEST.bounty_log_technique_attempt.role_bundles, ["hunter", "hunter-web", "orchestrator"]);
  assert.equal(TOOL_MANIFEST.bounty_get_context_budget.mutating, false);
  assert.equal(TOOL_MANIFEST.bounty_select_technique_packs.mutating, false);
  assert.equal(TOOL_MANIFEST.bounty_read_technique_pack.mutating, false);
  assert.equal(TOOL_MANIFEST.bounty_log_technique_attempt.mutating, true);
  assert.deepEqual(TOOL_MANIFEST.bounty_log_technique_attempt.session_artifacts_written, ["technique-attempts.jsonl"]);
  assert.deepEqual(TOOL_MANIFEST.bounty_write_evidence_packs.role_bundles, ["evidence"]);
  assert.deepEqual(TOOL_MANIFEST.bounty_read_evidence_packs.role_bundles, ["evidence", "grader", "reporter", "orchestrator"]);
  assert.ok(!sourceAllowed.has("bounty_merge_wave_handoffs"));
  assert.ok(!sourceAllowed.has("bounty_read_tool_telemetry"));
  assert.ok(!sourceAllowed.has("bounty_read_pipeline_analytics"));
  assert.ok(!sourceAllowed.has("bounty_route_surfaces"));
  assert.ok(!generatedAllowed.has("bounty_merge_wave_handoffs"));
  assert.ok(!generatedAllowed.has("bounty_read_tool_telemetry"));
  assert.ok(!generatedAllowed.has("bounty_read_pipeline_analytics"));
  assert.ok(!generatedAllowed.has("bounty_route_surfaces"));
  assert.ok(!sourceAllowed.has("bounty_promote_surface_leads"));
  assert.ok(sourceAllowed.has("bounty_record_surface_leads"));
  assert.ok(sourceAllowed.has("bounty_read_surface_leads"));
  assert.ok(sourceAllowed.has("bounty_get_context_budget"));
  assert.ok(sourceAllowed.has("bounty_select_technique_packs"));
  assert.ok(sourceAllowed.has("bounty_read_technique_pack"));
  assert.ok(sourceAllowed.has("bounty_log_technique_attempt"));
  assert.ok(sourceAllowed.has("bounty_wave_handoff_status"));
  assert.ok(sourceAllowed.has("bounty_write_evidence_packs"));
  assert.ok(sourceAllowed.has("bounty_read_evidence_packs"));

  const hookMatchers = settingsHookMatchers();
  for (const [toolName, metadata] of Object.entries(TOOL_MANIFEST)) {
    if (!metadata.hook_required) continue;
    assert.ok(hookMatchers.has(`mcp__bountyagent__${toolName}`), `${toolName} requires a scope hook`);
  }
});

test("MCP-dependent agents declare official mcpServers bountyagent metadata", () => {
  const agents = [
    "surface-router-agent",
    "hunter-agent",
    "brutalist-verifier",
    "balanced-verifier",
    "final-verifier",
    "evidence-agent",
    "grader",
    "chain-builder",
    "report-writer",
  ];
  for (const agent of agents) {
    const document = readFile(`.claude/agents/${agent}.md`);
    assert.match(
      document,
      /mcpServers:\s*\n\s*-\s*bountyagent/,
      `${agent}.md missing mcpServers: bountyagent`
    );
  }
});

test("recon agents remain MCP-free", () => {
  for (const agent of ["recon-agent", "deep-recon-agent"]) {
    const document = readFile(`.claude/agents/${agent}.md`);
    assert.doesNotMatch(document, /mcpServers:/, `${agent} should not declare MCP servers`);
    assert.doesNotMatch(document, /requiredMcpServers:/, `${agent} should not require MCP servers`);
    assert.doesNotMatch(document, /mcp__/i, `${agent} should not expose MCP tools`);
  }
});

test("global rules stay small and keep scope plus MCP-owned artifact guardrails", () => {
  for (const ruleFile of [".claude/rules/hunting.md", ".claude/rules/reporting.md"]) {
    const document = readFile(ruleFile);
    assert.ok(lineCount(ruleFile) <= 60, `${ruleFile} is too large for always-active context`);
    assert.match(document, /scope/i, `${ruleFile} must mention scope`);
    assert.match(document, /MCP-owned artifacts/i, `${ruleFile} must mention MCP-owned artifacts`);
  }
});

test("bob-hunt skill stays orchestration-sized and preserves FSM shape", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  assert.ok(lineCount(".claude/skills/bob-hunt/SKILL.md") <= 240, "bob-hunt skill is too large");
  assert.match(orchestrator, /RECON\s*→\s*AUTH\s*→\s*HUNT\s*→\s*CHAIN\s*→\s*VERIFY\s*→\s*GRADE\s*→\s*REPORT/);
  for (const phase of ["RECON", "AUTH", "HUNT", "CHAIN", "VERIFY", "GRADE", "REPORT", "EXPLORE"]) {
    assert.match(orchestrator, new RegExp(`PHASE [0-9]+: ${phase}|${phase}`), `missing ${phase}`);
  }
  assert.match(orchestrator, /must never call `bounty_write_wave_handoff`/);
  assert.match(orchestrator, /must never write handoff JSON directly/);
});

test("orchestrator validates brutalist and balanced rounds before proceeding", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  assert.match(
    orchestrator,
    /After the brutalist agent completes, validate/,
    "Missing post-brutalist validation"
  );
  assert.match(
    orchestrator,
    /bounty_read_verification_round.*round.*brutalist/,
    "Missing brutalist read-back validation call"
  );
  assert.match(
    orchestrator,
    /After the balanced agent completes, validate/,
    "Missing post-balanced validation"
  );
  assert.match(
    orchestrator,
    /bounty_read_verification_round.*round.*balanced/,
    "Missing balanced read-back validation call"
  );
});

test("evidence-agent exists, is MCP-only, and cannot mutate unrelated artifacts", () => {
  const document = readFile(".claude/agents/evidence-agent.md");
  const frontmatter = parseFrontmatter(document, "evidence-agent.md");
  const tools = frontmatter.tools.split(/\s*,\s*/).filter(Boolean);
  const generatedTools = toolsForSpec(AGENT_TOOL_SPECS["evidence-agent.md"]);
  const allowedTools = [
    "mcp__bountyagent__bounty_http_scan",
    "mcp__bountyagent__bounty_read_http_audit",
    "mcp__bountyagent__bounty_read_findings",
    "mcp__bountyagent__bounty_read_verification_round",
    "mcp__bountyagent__bounty_write_evidence_packs",
    "mcp__bountyagent__bounty_read_evidence_packs",
    "mcp__bountyagent__bounty_list_auth_profiles",
  ];

  assert.deepEqual(AGENT_TOOL_SPECS["evidence-agent.md"], {
    roleBundles: ["evidence"],
    extras: [],
  });
  assert.deepEqual(generatedTools.sort(), allowedTools.sort());
  assert.deepEqual(tools.sort(), allowedTools.sort());
  assert.match(document, /final reportable findings only/);
  assert.match(document, /All target requests must go through `bounty_http_scan` with `target_domain`/);
  assert.match(document, /bounty_write_evidence_packs/);
  assert.doesNotMatch(frontmatter.tools, /Bash|Write|bounty_record_finding|bounty_write_wave_handoff|bounty_write_grade_verdict/);
  assert.doesNotMatch(frontmatter.tools, /bounty_write_chain_attempt|bounty_transition_phase/);
});

test("bob-hunt spawns evidence before grade and validates evidence packs", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  const evidenceIndex = orchestrator.indexOf('subagent_type: "evidence-agent"');
  const gradeTransitionIndex = orchestrator.indexOf('to_phase: "GRADE"');
  const graderIndex = orchestrator.indexOf('subagent_type: "grader"');

  assert.ok(evidenceIndex > 0, "missing evidence-agent spawn");
  assert.ok(gradeTransitionIndex > evidenceIndex, "GRADE transition must happen after evidence-agent");
  assert.ok(graderIndex > gradeTransitionIndex, "grader must spawn after GRADE transition");
  assert.match(orchestrator, /bounty_read_evidence_packs\(\{ target_domain: "\[domain\]" \}\)/);
  assert.match(orchestrator, /write only through bounty_write_evidence_packs/);
});

test("bob-hunt closes no-finding verification through SKIP grade and report", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  const grader = readFile(".claude/agents/grader.md");
  const reporter = readFile(".claude/agents/report-writer.md");

  assert.doesNotMatch(orchestrator, /If no result has `reportable: true`, report `No reportable vulnerabilities`[\s\S]{0,80}stop/);
  assert.match(orchestrator, /no result has `reportable: true`[\s\S]*continue through GRADE and REPORT/);
  assert.match(orchestrator, /On `SUBMIT` or `SKIP`, transition to REPORT/);
  assert.match(grader, /terminal SKIP verdict with `total_score: 0`, `findings: \[\]`/);
  assert.match(reporter, /no-findings closeout/);
});

test("settings.json registers session guards for Bash, Read, and Write", () => {
  const settings = JSON.parse(readFile(".claude/settings.json"));
  const preToolUse = settings.hooks.PreToolUse;

  const bashEntry = preToolUse.find((e) => e.matcher === "Bash");
  assert.ok(bashEntry, "No Bash matcher in PreToolUse");
  assert.ok(
    bashEntry.hooks.some((h) => h.command.includes("session-write-guard.sh")),
    "session-write-guard.sh not registered for Bash"
  );
  assert.ok(
    bashEntry.hooks.some((h) => h.command.includes("session-read-guard.sh")),
    "session-read-guard.sh not registered for Bash"
  );

  const readEntry = preToolUse.find((e) => e.matcher === "Read");
  assert.ok(readEntry, "No Read matcher in PreToolUse");
  assert.ok(
    readEntry.hooks.some((h) => h.command.includes("session-read-guard.sh")),
    "session-read-guard.sh not registered for Read"
  );

  const writeEntry = preToolUse.find((e) => e.matcher === "Write");
  assert.ok(writeEntry, "No Write matcher in PreToolUse");
  assert.ok(
    writeEntry.hooks.some((h) => h.command.includes("session-write-guard.sh")),
    "session-write-guard.sh not registered for Write"
  );
});

test("prompts do not tell agents to read auth.json directly", () => {
  for (const relativePath of [
    ".claude/commands/bob-update.md",
    ".claude/skills/bob-hunt/SKILL.md",
    ".claude/skills/bob-status/SKILL.md",
    ".claude/skills/bob-debug/SKILL.md",
    ...allMarkdown(".claude/agents"),
  ]) {
    const document = readFile(relativePath);
    assert.doesNotMatch(document, /auth\.json/i, `${relativePath} should use auth MCP tools`);
  }
});

test("chain-builder uses structured MCP chain attempts without Bash, Write, or markdown dependency", () => {
  const document = readFile(".claude/agents/chain-builder.md");
  const frontmatter = parseFrontmatter(document, "chain-builder.md");
  const tools = frontmatter.tools.split(/\s*,\s*/).filter(Boolean);

  assert.ok(!tools.includes("Bash"));
  assert.ok(!tools.includes("Write"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_write_chain_attempt"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_chain_attempts"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_http_scan"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_http_audit"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_list_auth_profiles"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_findings"));
  assert.ok(tools.includes("mcp__bountyagent__bounty_read_wave_handoffs"));
  assert.match(document, /bounty_read_wave_handoffs/);
  assert.match(document, /bounty_write_chain_attempt/);
  assert.doesNotMatch(document, /handoff-w\*\.md/);
});

test("orchestrator has no blanket bypassPermissions rule", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  assert.doesNotMatch(orchestrator, /Every Agent tool call MUST use `mode: "bypassPermissions"`/);
  assert.doesNotMatch(orchestrator, /mode:\s*"bypassPermissions"/);
});

test("bob-hunt skill allowed-tools match orchestrator and auth bundles", () => {
  const skill = readFile(".claude/skills/bob-hunt/SKILL.md");
  const allowedTools = parseYamlListFrontmatter(skill, "allowed-tools", "bob-hunt/SKILL.md");
  const expectedTools = bountyagentSkillAllowedTools();
  assert.deepEqual(allowedTools.sort(), expectedTools.slice().sort());
  assert.deepEqual(
    allowedTools.filter((tool) => tool.startsWith("mcp__bountyagent__")).sort(),
    permissionsForRoleBundles(["orchestrator", "auth"]).sort(),
  );
  assert.ok(allowedTools.includes("Task"));
  assert.ok(allowedTools.includes("Read"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_merge_wave_handoffs"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_read_tool_telemetry"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_read_pipeline_analytics"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_route_surfaces"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_read_session_summary"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_set_operator_note"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_clear_operator_note"));
  assert.ok(!allowedTools.includes("mcp__bountyagent__bounty_write_wave_handoff"));
});

test("bob skills declare hyphen-form names so each skill backs a single /bob-* slash command", () => {
  const huntSkill = readFile(".claude/skills/bob-hunt/SKILL.md");
  const statusSkill = readFile(".claude/skills/bob-status/SKILL.md");
  const debugSkill = readFile(".claude/skills/bob-debug/SKILL.md");

  assert.match(huntSkill, /^name: bob-hunt$/m);
  assert.match(statusSkill, /^name: bob-status$/m);
  assert.match(debugSkill, /^name: bob-debug$/m);
});

test("bob-update command delegates to the installer and lives at .claude/commands/bob-update.md", () => {
  const updateCommand = readFile(".claude/commands/bob-update.md");

  assert.match(updateCommand, /hacker-bob-cc@latest install/);
  assert.match(updateCommand, /Update now\?/);
  assert.match(updateCommand, /fully restart Claude Code/);
  assert.deepEqual(
    parseYamlListFrontmatter(updateCommand, "allowed-tools", "bob-update.md").sort(),
    ["AskUserQuestion", "Bash"].sort(),
  );
  // Bash tool subprocesses do not always inherit CLAUDE_PROJECT_DIR; the
  // command body must use the ${CLAUDE_PROJECT_DIR:-$PWD} fallback so it
  // resolves to the project dir even when the harness does not export the
  // variable into the assistant's Bash tool environment.
  assert.doesNotMatch(
    updateCommand,
    /\$CLAUDE_PROJECT_DIR(?!:-)/,
    "bob-update.md must use ${CLAUDE_PROJECT_DIR:-$PWD}, not bare $CLAUDE_PROJECT_DIR",
  );
  assert.match(updateCommand, /\$\{CLAUDE_PROJECT_DIR:-\$PWD\}/);
});

test("bob-status skill is compact, read-only, and points to next commands", () => {
  const skill = readFile(".claude/skills/bob-status/SKILL.md");
  const allowedTools = parseYamlListFrontmatter(skill, "allowed-tools", "bob-status/SKILL.md");
  const forbiddenTools = [
    "Task",
    "Write",
    "Grep",
    "mcp__bountyagent__bounty_start_wave",
    "mcp__bountyagent__bounty_apply_wave_merge",
    "mcp__bountyagent__bounty_merge_wave_handoffs",
    "mcp__bountyagent__bounty_transition_phase",
    "mcp__bountyagent__bounty_auth_store",
    "mcp__bountyagent__bounty_write_handoff",
    "mcp__bountyagent__bounty_write_wave_handoff",
    "mcp__bountyagent__bounty_write_verification_round",
    "mcp__bountyagent__bounty_write_evidence_packs",
    "mcp__bountyagent__bounty_write_grade_verdict",
    "mcp__bountyagent__bounty_record_finding",
    "mcp__bountyagent__bounty_http_scan",
    "mcp__bountyagent__bounty_import_http_traffic",
    "mcp__bountyagent__bounty_public_intel",
    "mcp__bountyagent__bounty_import_static_artifact",
    "mcp__bountyagent__bounty_static_scan",
    "mcp__bountyagent__bounty_auto_signup",
    "mcp__bountyagent__bounty_temp_email",
    "mcp__bountyagent__bounty_signup_detect",
    "mcp__bountyagent__bounty_log_coverage",
    "mcp__bountyagent__bounty_log_dead_ends",
    "mcp__bountyagent__bounty_read_tool_telemetry",
  ];

  assert.match(skill, /not a debug review/i);
  assert.match(skill, /No args or `--last`/);
  assert.match(skill, /bounty_read_pipeline_analytics\(\{ target_domain, include_events: false, limit: 20 \}\)/);
  assert.match(skill, /bounty_read_session_summary\(\{ target_domain \}\)/);
  assert.match(skill, /bounty_read_state_summary\(\{ target_domain \}\)/);
  assert.match(skill, /bounty_wave_status\(\{ target_domain \}\)/);
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_read_evidence_packs"));
  assert.ok(allowedTools.includes("mcp__bountyagent__bounty_read_session_summary"));
  assert.match(skill, /evidence status/);
  assert.match(skill, /bounty_read_pipeline_analytics\.data\.sessions\[0\]\.evidence/);
  assert.match(skill, /bounty_read_evidence_packs\(\{ target_domain \}\)/);
  assert.match(skill, /\/bob-hunt resume <target_domain>/);
  assert.match(skill, /\/bob-debug --deep <target_domain>/);
  // Bash tool subprocesses do not always inherit CLAUDE_PROJECT_DIR; the
  // bob-update.js invocation must use the ${CLAUDE_PROJECT_DIR:-$PWD}
  // fallback so it resolves even when the harness does not export the
  // variable into the assistant's Bash tool environment.
  assert.doesNotMatch(
    skill,
    /\$CLAUDE_PROJECT_DIR(?!:-)/,
    "bob-status SKILL.md must use ${CLAUDE_PROJECT_DIR:-$PWD}, not bare $CLAUDE_PROJECT_DIR",
  );
  for (const tool of forbiddenTools) {
    assert.ok(!allowedTools.includes(tool), `${tool} must not be allowed in bob-status`);
  }
  for (const tool of allowedTools.filter((entry) => entry.startsWith("mcp__bountyagent__"))) {
    const toolName = tool.replace(/^mcp__bountyagent__/, "");
    assert.equal(TOOL_MANIFEST[toolName].mutating, false, `${toolName} must be read-only`);
    assert.equal(TOOL_MANIFEST[toolName].network_access, false, `${toolName} must not touch the network`);
  }
});

test("bob-debug skill is telemetry-first and supports latest, explicit, and deep modes", () => {
  const skill = readFile(".claude/skills/bob-debug/SKILL.md");

  assert.match(skill, /bounty_read_pipeline_analytics\(\{ target_domain, include_events: true, limit: 100 \}\)/);
  assert.match(skill, /bounty_read_tool_telemetry\(\{ target_domain, include_agent_runs: true, limit: 100 \}\)/);
  assert.match(skill, /bounty_read_session_summary\(\{ target_domain \}\)/);
  assert.match(skill, /No args or `--last`/);
  assert.match(skill, /`<target_domain>`/);
  assert.match(skill, /`--deep`/);
  assert.match(skill, /telemetry explicitly identifies a policy\/refusal stuck signal/);
  assert.match(skill, /pipeline-events\.jsonl[\s\S]*state\.json[\s\S]*grade\.json[\s\S]*report\.md[\s\S]*directory mtime/);
  assert.match(skill, /Artifact fallback mode: telemetry MCP unavailable or incomplete\./);
  assert.match(skill, /Policy replay candidates/);
  assert.match(skill, /evidence status/);
  assert.match(skill, /bounty_read_evidence_packs\(\{ target_domain \}\)/);
  assert.match(skill, /refusal or policy-stall turns/);
  assert.match(skill, /Policy Replay Escalation/);
  assert.match(skill, /testing\/policy-replay\/replay\.mjs --case/);
  assert.match(skill, /testing\/policy-replay\/tune\.mjs --transcript/);
  assert.match(skill, /recommended_prompt_change/);
  assert.match(skill, /do not edit the prompt yourself from `\/bob-debug`/);
  assert.match(skill, /Claude Code Session Traceability/);
  assert.match(skill, /agent_runs\.latest_run\.transcript_path/);
  assert.match(skill, /~\/\.claude\/projects/);
  assert.match(skill, /Session artifacts: <absolute session dir>/);
  assert.match(skill, /Claude Code session: <root transcript path or root transcript not found>/);
  assert.match(skill, /report presence, and Claude Code session traceability/);
});

test("bob-debug skill allowed-tools are read-only and exclude mutators", () => {
  const skill = readFile(".claude/skills/bob-debug/SKILL.md");
  const allowedTools = parseYamlListFrontmatter(skill, "allowed-tools", "bob-debug/SKILL.md");
  const expectedReadOnlyMcpTools = [
    "mcp__bountyagent__bounty_read_pipeline_analytics",
    "mcp__bountyagent__bounty_read_tool_telemetry",
    "mcp__bountyagent__bounty_read_session_summary",
    "mcp__bountyagent__bounty_read_state_summary",
    "mcp__bountyagent__bounty_wave_status",
    "mcp__bountyagent__bounty_read_wave_handoffs",
    "mcp__bountyagent__bounty_read_findings",
    "mcp__bountyagent__bounty_read_verification_round",
    "mcp__bountyagent__bounty_read_evidence_packs",
    "mcp__bountyagent__bounty_read_grade_verdict",
  ];
  const forbiddenTools = [
    "Task",
    "Write",
    "mcp__bountyagent__bounty_start_wave",
    "mcp__bountyagent__bounty_apply_wave_merge",
    "mcp__bountyagent__bounty_merge_wave_handoffs",
    "mcp__bountyagent__bounty_transition_phase",
    "mcp__bountyagent__bounty_auth_store",
    "mcp__bountyagent__bounty_write_handoff",
    "mcp__bountyagent__bounty_write_wave_handoff",
    "mcp__bountyagent__bounty_write_verification_round",
    "mcp__bountyagent__bounty_write_evidence_packs",
    "mcp__bountyagent__bounty_write_grade_verdict",
    "mcp__bountyagent__bounty_record_finding",
    "mcp__bountyagent__bounty_http_scan",
    "mcp__bountyagent__bounty_import_http_traffic",
    "mcp__bountyagent__bounty_public_intel",
    "mcp__bountyagent__bounty_import_static_artifact",
    "mcp__bountyagent__bounty_static_scan",
    "mcp__bountyagent__bounty_auto_signup",
    "mcp__bountyagent__bounty_temp_email",
    "mcp__bountyagent__bounty_signup_detect",
    "mcp__bountyagent__bounty_log_coverage",
    "mcp__bountyagent__bounty_log_dead_ends",
  ];

  assert.ok(allowedTools.includes("Read"));
  assert.ok(allowedTools.includes("Glob"));
  assert.ok(allowedTools.includes("Grep"));
  assert.ok(
    allowedTools.includes("Bash(node testing/policy-replay/replay.mjs *)"),
    "bob-debug must be able to run bounded replay diagnostics",
  );
  assert.ok(
    allowedTools.includes("Bash(node testing/policy-replay/tune.mjs *)"),
    "bob-debug must be able to run bounded prompt tune diagnostics",
  );
  for (const tool of expectedReadOnlyMcpTools) {
    assert.ok(allowedTools.includes(tool), `${tool} missing from bob-debug allowed-tools`);
  }
  for (const tool of forbiddenTools) {
    assert.ok(!allowedTools.includes(tool), `${tool} must not be allowed in bob-debug`);
  }
  for (const tool of allowedTools.filter((entry) => entry.startsWith("mcp__bountyagent__"))) {
    const toolName = tool.replace(/^mcp__bountyagent__/, "");
    assert.equal(TOOL_MANIFEST[toolName].mutating, false, `${toolName} must be read-only`);
    assert.equal(TOOL_MANIFEST[toolName].network_access, false, `${toolName} must not touch the network`);
  }
});

test("normal Bob workflows do not invoke live policy replay automatically outside bob-debug", () => {
  const workflowFiles = [
    ".claude/skills/bob-hunt/SKILL.md",
    ".claude/skills/bob-status/SKILL.md",
    ...allMarkdown(".claude/agents"),
  ];

  for (const file of workflowFiles) {
    const content = readFile(file);
    assert.doesNotMatch(
      content,
      /testing\/policy-replay\/(?:replay|bench)\.mjs|replay:policy/,
      `${file} must not invoke policy replay automatically`,
    );
  }
});

test("installer and dev-sync ship the bob commands, the three skills, and prune deprecated paths", () => {
  const install = readFile("install.sh");
  const installer = readFile("scripts/install.js");
  const devSync = readFile("dev-sync.sh");

  assert.match(install, /bin\/hacker-bob\.js/);

  // Installer copies bob-update.md and proactively removes the legacy hunt/status/debug/update.md shims and the legacy bountyagent* skill directories so upgrades from <=1.1.1 don't leave orphan slash entries.
  assert.match(installer, /"bob-update\.md"/);
  assert.match(installer, /"bob-egress\.md"/);
  assert.match(installer, /removeIfExists\(path\.join\(claudeDir, "commands", "bob", "hunt\.md"\)\)/);
  assert.match(installer, /removeIfExists\(path\.join\(claudeDir, "commands", "bob", "status\.md"\)\)/);
  assert.match(installer, /removeIfExists\(path\.join\(claudeDir, "commands", "bob", "debug\.md"\)\)/);
  assert.match(installer, /removeIfExists\(path\.join\(claudeDir, "commands", "bob", "update\.md"\)\)/);
  assert.match(installer, /removeRecursiveIfExists\(path\.join\(claudeDir, "skills", "bountyagent"\)\)/);
  assert.match(installer, /removeRecursiveIfExists\(path\.join\(claudeDir, "skills", "bountyagentstatus"\)\)/);
  assert.match(installer, /removeRecursiveIfExists\(path\.join\(claudeDir, "skills", "bountyagentdebug"\)\)/);

  // dev-sync.sh mirrors the installer: copy bob-update.md to commands/, rm legacy paths.
  assert.match(devSync, /cp "\$SCRIPT_DIR\/\.claude\/commands\/bob-update\.md"/);
  assert.match(devSync, /cp "\$SCRIPT_DIR\/\.claude\/commands\/bob-egress\.md"/);
  assert.match(devSync, /rm -f "\$CLAUDE_DIR\/commands\/bob\/hunt\.md" "\$CLAUDE_DIR\/commands\/bob\/status\.md" "\$CLAUDE_DIR\/commands\/bob\/debug\.md" "\$CLAUDE_DIR\/commands\/bob\/update\.md"/);
  assert.match(devSync, /rm -rf "\$CLAUDE_DIR\/skills\/bountyagent" "\$CLAUDE_DIR\/skills\/bountyagentstatus" "\$CLAUDE_DIR\/skills\/bountyagentdebug"/);

  assert.match(installer, /"bob-status"/);
  assert.match(devSync, /\.claude\/skills\/bob-status\/SKILL\.md/);
  assert.match(installer, /"bob-debug"/);
  assert.match(devSync, /\.claude\/skills\/bob-debug\/SKILL\.md/);
  assert.match(installer, /"bob-hunt"/);
  assert.match(devSync, /\.claude\/skills\/bob-hunt\/SKILL\.md/);
  assert.match(installer, /bob-egress\.js/);
  assert.match(devSync, /bob-egress\.js/);
});

test("root-orchestrator MCP calls are covered by skill allowed-tools", () => {
  const allowedTools = new Set(parseYamlListFrontmatter(
    readFile(".claude/skills/bob-hunt/SKILL.md"),
    "allowed-tools",
    "bob-hunt/SKILL.md",
  ).filter((tool) => tool.startsWith("mcp__bountyagent__"))
    .map((tool) => tool.replace(/^mcp__bountyagent__/, "")));

  for (const tool of orchestratorReferencedMcpTools()) {
    const metadata = TOOL_MANIFEST[tool];
    if (!metadata || (!metadata.role_bundles.includes("orchestrator") && !metadata.role_bundles.includes("auth"))) {
      continue;
    }
    assert.ok(allowedTools.has(tool), `${tool} missing from bob-hunt skill allowed-tools`);
  }
});

test("recon agent preserves exactly seven Bash collection calls", () => {
  const reconPrompt = readFile(".claude/agents/recon-agent.md");
  const bashBlocks = Array.from(reconPrompt.matchAll(/```bash\n/g));

  assert.equal(bashBlocks.length, 7);
  assert.match(reconPrompt, /Use exactly the 7 Bash calls below, in order/);
  assert.match(reconPrompt, /Do not make any additional Bash calls/);
});

test("normal recon agent is single-purpose and has no deep-only contract", () => {
  const reconPrompt = readFile(".claude/agents/recon-agent.md");

  assert.doesNotMatch(reconPrompt, /\[MODE\]|MODE=/);
  assert.doesNotMatch(reconPrompt, /amass/);
  assert.doesNotMatch(reconPrompt, /assetfinder/);
  assert.doesNotMatch(reconPrompt, /chaos/);
  assert.doesNotMatch(reconPrompt, /surface-leads\.json/);
  assert.doesNotMatch(reconPrompt, /deep-summary\.json/);
});

test("recon attack_surface schema keeps required fields and adds optional enrichment", () => {
  const reconPrompt = readFile(".claude/agents/recon-agent.md");

  for (const field of [
    "id",
    "hosts",
    "tech_stack",
    "endpoints",
    "interesting_params",
    "nuclei_hits",
    "priority",
  ]) {
    assert.match(reconPrompt, new RegExp(`"${field}"`), `missing required field ${field}`);
  }

  for (const field of [
    "surface_type",
    "bug_class_hints",
    "high_value_flows",
    "evidence",
    "ranking",
  ]) {
    assert.match(reconPrompt, new RegExp(`"${field}"`), `missing optional field ${field}`);
  }

  assert.match(reconPrompt, /Required per-surface fields remain/);
  assert.match(reconPrompt, /Optional enrichment fields are additive/);
});

test("deep recon agent preserves exactly seven Bash collection calls", () => {
  const deepReconPrompt = readFile(".claude/agents/deep-recon-agent.md");
  const bashBlocks = Array.from(deepReconPrompt.matchAll(/```bash\n/g));

  assert.equal(bashBlocks.length, 7);
  assert.match(deepReconPrompt, /Use exactly the 7 Bash calls below, in order/);
  assert.match(deepReconPrompt, /Do not make any additional Bash calls/);
});

test("deep recon stays passive, broad, and writes compact ranked lead artifacts", () => {
  const deepReconPrompt = readFile(".claude/agents/deep-recon-agent.md");

  assert.match(deepReconPrompt, /Passive subdomain and CT aggregation/i);
  assert.match(deepReconPrompt, /crt\.sh/);
  assert.match(deepReconPrompt, /amass/);
  assert.match(deepReconPrompt, /assetfinder/);
  assert.match(deepReconPrompt, /chaos/);
  assert.match(deepReconPrompt, /CDX\/Wayback/);
  assert.match(deepReconPrompt, /JS extraction/i);
  assert.match(deepReconPrompt, /takeover_candidates/);
  assert.match(deepReconPrompt, /tech\/CVE hints/);
  assert.match(deepReconPrompt, /sibling-domain-candidates\.txt/);
  assert.match(deepReconPrompt, /brand-sibling-probe-candidates\.txt/);
  assert.match(deepReconPrompt, /Brand-linked sibling properties lightly probed/);
  assert.match(deepReconPrompt, /Sibling domain candidates recorded for review/);
  assert.match(deepReconPrompt, /deep-summary\.json/);
  assert.match(deepReconPrompt, /surface-leads\.json/);
  assert.match(deepReconPrompt, /Do not duplicate every URL/);
  assert.match(deepReconPrompt, /Do not dump raw URLs, JavaScript bodies, or scanner output into prose/);
});

test("deep recon target family probing stays bounded and sibling liveness is gated", () => {
  const deepReconPrompt = readFile(".claude/agents/deep-recon-agent.md");
  const familyStart = deepReconPrompt.indexOf("4. First-party family discovery");
  const familyEnd = deepReconPrompt.indexOf("5. Archived URLs with CDX/Wayback");
  const cdxEnd = deepReconPrompt.indexOf("6. JS extraction and endpoint clustering");
  const step7Start = deepReconPrompt.indexOf("7. Compact summaries, ranked leads, and attack surface");
  assert.ok(familyStart >= 0 && familyEnd > familyStart, "missing deep recon family discovery section");
  assert.ok(step7Start > cdxEnd, "missing deep recon compact summary section");
  const familySection = deepReconPrompt.slice(familyStart, familyEnd);
  const cdxSection = deepReconPrompt.slice(familyEnd, cdxEnd);
  const jsSection = deepReconPrompt.slice(cdxEnd, step7Start);
  const step7Section = deepReconPrompt.slice(step7Start);
  const liveUrlsEnd = step7Section.indexOf(': > "$SESSION/nuclei_results.txt"');
  assert.ok(liveUrlsEnd > 0, "missing deep recon live_urls builder");
  const liveUrlsBuilder = step7Section.slice(0, liveUrlsEnd);

  assert.match(familySection, /Target-domain family probing remains bounded/i);
  assert.match(familySection, /do not probe the broad `sibling-domain-candidates\.txt` set/i);
  assert.match(familySection, /host == domain or host\.endswith\("\." \+ domain\)/);
  assert.match(familySection, /sibling-domain-candidates\.txt/);
  assert.match(familySection, /brand-sibling-probe-candidates\.txt/);
  assert.match(familySection, /same-TLD-only repeat evidence stays record-only/i);
  assert.match(familySection, /label\.startswith\(target_label\)/);
  assert.match(familySection, /if brand_related:\n\s+brand_siblings\.append\(host\)/);
  assert.match(familySection, /-l "\$SESSION\/brand-sibling-probe-candidates\.txt"/);
  assert.match(step7Section, /def add_lead\([\s\S]*promote=None\)/);
  assert.match(step7Section, /Brand-linked sibling properties lightly probed[\s\S]*\*brand_sibling_live\[:5\][\s\S]*55, promote=True/);
  assert.doesNotMatch(step7Section, /Brand-linked sibling properties queued for review[\s\S]{0,300}promote=True/);
  assert.doesNotMatch(familySection, /httpx[\s\S]*sibling-domain-candidates\.txt/i);
  assert.doesNotMatch(familySection, /-l "\$SESSION\/sibling-domain-candidates\.txt"/);
  assert.doesNotMatch(cdxSection, /sibling-domain-candidates\.txt/);
  for (const needle of ["brand-sibling-probe-candidates.txt", "brand_sibling_live.txt"]) {
    const escapedNeedle = needle.replace(/\./g, "\\.");
    assert.doesNotMatch(cdxSection, new RegExp(escapedNeedle));
    assert.doesNotMatch(jsSection, new RegExp(escapedNeedle));
    assert.doesNotMatch(liveUrlsBuilder, new RegExp(escapedNeedle));
  }
});

test("recon prompts remain enrichment-only without new commands or imported toolsets", () => {
  for (const agent of ["recon-agent", "deep-recon-agent"]) {
    const reconPrompt = readFile(`.claude/agents/${agent}.md`);

    assert.doesNotMatch(reconPrompt, /\/bob-hunt/, `${agent} should not mention slash commands`);
    assert.doesNotMatch(reconPrompt, /slash commands?/i, `${agent} should not mention slash commands`);
    assert.doesNotMatch(reconPrompt, /claude-bug-bounty/i, `${agent} should not import external prompts`);
    assert.doesNotMatch(reconPrompt, /scripts\/|tools\//i, `${agent} should not require repo scripts or tools`);
    assert.doesNotMatch(reconPrompt, /mcp__/i, `${agent} should not use MCP tools`);
  }
});

test("installer and dev-sync copy and configure session guards", () => {
  const install = readFile("scripts/install.js");
  const devSync = readFile("dev-sync.sh");

  assert.match(install, /session-write-guard\.sh/);
  assert.match(install, /session-read-guard\.sh/);
  assert.match(devSync, /cp "\$SCRIPT_DIR\/\.claude\/hooks\/session-write-guard\.sh"/);
  assert.match(devSync, /cp "\$SCRIPT_DIR\/\.claude\/hooks\/session-read-guard\.sh"/);
  assert.match(install, /hunter-subagent-stop\.js/);
  assert.match(devSync, /cp "\$SCRIPT_DIR\/\.claude\/hooks\/hunter-subagent-stop\.js"/);
  assert.match(install, /bob-hunt/);
  assert.match(devSync, /\.claude\/skills\/bob-hunt\/SKILL\.md/);
  assert.match(install, /bob-update\.md/);
  assert.match(devSync, /\.claude\/commands\/bob-update\.md/);
  assert.match(install, /"mcp", "lib", "tools"/);
  assert.match(devSync, /mcp\/lib\/tools/);
  assert.match(install, /merge-claude-config\.js/);
  assert.match(devSync, /merge-claude-config\.js/);

  const hookText = JSON.stringify(defaultClaudeSettings().hooks.PreToolUse);
  assert.match(hookText, /"matcher":"Bash"[\s\S]*session-write-guard\.sh/);
  assert.match(hookText, /"matcher":"Bash"[\s\S]*session-read-guard\.sh/);
  assert.match(hookText, /"matcher":"Read"[\s\S]*session-read-guard\.sh/);
  assert.match(hookText, /"matcher":"Write"[\s\S]*session-write-guard\.sh/);
  assert.match(JSON.stringify(defaultClaudeSettings().hooks.SubagentStop), /hunter-subagent-stop\.js/);
  assert.match(JSON.stringify(defaultClaudeSettings().hooks.SessionStart), /bob-check-update\.js/);
  assert.match(JSON.stringify(defaultClaudeSettings()), /\$\{CLAUDE_PROJECT_DIR:-\$PWD\}/);
  assert.doesNotMatch(JSON.stringify(defaultClaudeSettings()), /\$CLAUDE_PROJECT_DIR(?!:-)/);
});

test("SubagentStop hooks cover every routed capability-pack hunter agent", () => {
  const expectedHunters = hunterAgentNamesForCapabilityPacks().sort();
  const configuredHunters = (defaultClaudeSettings().hooks.SubagentStop || [])
    .filter((entry) => (entry.hooks || []).some((hook) => /hunter-subagent-stop\.js/.test(hook.command)))
    .map((entry) => entry.matcher)
    .sort();

  assert.deepEqual(configuredHunters, expectedHunters);
});

test("capability packs expose versioned context budgets for routed hunters", () => {
  for (const pack of Object.values(CAPABILITY_PACKS)) {
    assert.equal(pack.capability_pack_version, 1);
    assert.ok(pack.hunter_agent);
    assert.ok(pack.brief_profile);
    assert.deepEqual(pack.context_budget, {
      brief_max_tokens: 2500,
      candidate_pack_limit: 5,
      full_pack_read_limit: 2,
      attempt_log_required: true,
      team_escalation_allowed: false,
    });
  }
});

test("verifier and grader examples use F-N finding IDs", () => {
  for (const agent of ["brutalist-verifier", "balanced-verifier", "final-verifier", "grader"]) {
    const document = readFile(`.claude/agents/${agent}.md`);
    assert.doesNotMatch(document, /\bw\d+-a\d+-\d+\b/, `${agent}.md contains stale wave-agent finding IDs`);
    assert.match(document, /finding_id:\s*"F-\d+"/, `${agent}.md missing F-N finding_id example`);
  }
});

test("verifiers can read request audit summaries without direct file access", () => {
  for (const agent of ["brutalist-verifier", "balanced-verifier", "final-verifier"]) {
    const document = readFile(`.claude/agents/${agent}.md`);
    const frontmatter = parseFrontmatter(document, `${agent}.md`);
    assert.match(frontmatter.tools, /mcp__bountyagent__bounty_read_http_audit/);
    assert.match(document, /bounty_read_http_audit/);
    assert.doesNotMatch(document, /http-audit\.jsonl/);
  }
});

test("verifiers, grader, and reporter consume structured chain attempts instead of chains.md", () => {
  for (const agent of ["brutalist-verifier", "balanced-verifier", "final-verifier", "grader", "report-writer"]) {
    const document = readFile(`.claude/agents/${agent}.md`);
    const frontmatter = parseFrontmatter(document, `${agent}.md`);
    assert.match(frontmatter.tools, /mcp__bountyagent__bounty_read_chain_attempts/, `${agent} missing read-chain tool`);
    assert.match(document, /bounty_read_chain_attempts/, `${agent} missing read-chain instruction`);
    assert.doesNotMatch(document, /chains\.md/, `${agent} should not depend on chains.md`);
  }

  const grader = readFile(".claude/agents/grader.md");
  assert.match(grader, /confirmed chain attempts/i);
  assert.match(grader, /Denied attempts/i);

  const reporter = readFile(".claude/agents/report-writer.md");
  assert.match(reporter, /Include chain evidence only when the chain attempt outcome is `confirmed`/);
});

test("grader and report-writer consume evidence packs", () => {
  for (const agent of ["grader", "report-writer"]) {
    const document = readFile(`.claude/agents/${agent}.md`);
    const frontmatter = parseFrontmatter(document, `${agent}.md`);
    assert.match(frontmatter.tools, /mcp__bountyagent__bounty_read_evidence_packs/, `${agent} missing read evidence tool`);
    assert.match(document, /bounty_read_evidence_packs/, `${agent} missing read evidence instruction`);
    assert.match(document, /evidence packs/i, `${agent} must use evidence packs`);
  }
});

test("REPORT phase uses compact session summary instead of root reading report markdown", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestrator, /After the report writer finishes[\s\S]*bounty_read_session_summary/);
  assert.match(orchestrator, /result\.data\.summary\.report\.path/);
  assert.match(orchestrator, /Do not read `report\.md` in the root orchestrator/);
});

test("resume instructions continue from MCP summaries and do not reconstruct from markdown", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestrator, /First call `bounty_read_state_summary\(\{ target_domain \}\)`/);
  assert.match(orchestrator, /do not reconstruct resume state from markdown/i);
  assert.match(orchestrator, /handoff markdown/);
});

test("non-hunter agents require compact final markers and forbid raw final payloads", () => {
  const expectations = {
    "chain-builder": "BOB_CHAIN_DONE",
    "brutalist-verifier": "BOB_VERIFY_DONE",
    "balanced-verifier": "BOB_VERIFY_DONE",
    "final-verifier": "BOB_VERIFY_DONE",
    "evidence-agent": "BOB_EVIDENCE_DONE",
    "grader": "BOB_GRADE_DONE",
    "report-writer": "BOB_REPORT_DONE",
  };

  for (const [agent, marker] of Object.entries(expectations)) {
    const document = readFile(`.claude/agents/${agent}.md`);
    assert.match(document, new RegExp(marker), `${agent} missing ${marker}`);
    assert.match(document, /compact summary-only|compact and end/i, `${agent} must require compact final text`);
    assert.match(document, /raw requests[\s\S]*raw responses[\s\S]*(cookies|tokens|authorization headers)/i, `${agent} must forbid raw final payloads`);
  }
});

test("orchestrator documents --no-auth flag and skips AUTH when set", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");
  assert.match(
    orchestrator,
    /--no-auth/,
    "Missing --no-auth flag documentation"
  );
  assert.match(
    orchestrator,
    /--no-auth.*skip/is,
    "Missing --no-auth skip behavior"
  );
  assert.match(
    orchestrator,
    /auth_status.*unauthenticated/,
    "Missing unauthenticated transition when --no-auth is set"
  );
});

test("orchestrator documents deep mode persistence, recon mode, and lead debt", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestrator, /argument-hint: .*--deep/);
  assert.match(orchestrator, /`--deep` enables broader script-heavy recon/);
  assert.match(orchestrator, /bounty_init_session\(\{ target_domain, target_url, deep_mode \}\)/);
  assert.match(orchestrator, /persisted `state\.deep_mode` keeps deep behavior/);
  assert.match(orchestrator, /deep_mode false: Agent\(subagent_type: "recon-agent"/);
  assert.match(orchestrator, /deep_mode true: Agent\(subagent_type: "deep-recon-agent"/);
  assert.doesNotMatch(orchestrator, /MODE=\[normal\|deep\]/);
  assert.match(orchestrator, /bounty_promote_surface_leads\(\{ target_domain, limit: 8, min_score: 60 \}\)/);
  assert.match(orchestrator, /bounty_read_surface_leads\(\{ target_domain, limit: 20 \}\)/);
  assert.match(orchestrator, /maximum 8/);
  assert.match(orchestrator, /high-confidence unpromoted leads/);
  assert.match(orchestrator, /surface_leads/);
});

test("orchestrator documents checkpoint modes and MCP-owned traffic/audit/intel/static state", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestrator, /--paranoid/);
  assert.match(orchestrator, /--normal/);
  assert.match(orchestrator, /--yolo/);
  assert.match(orchestrator, /If no checkpoint flag is supplied, use `--normal`/);
  assert.match(orchestrator, /bounty_import_http_traffic[\s\S]*traffic\.jsonl/);
  assert.match(orchestrator, /bounty_http_scan[\s\S]*http-audit\.jsonl/);
  assert.match(orchestrator, /bounty_public_intel[\s\S]*public-intel\.json/);
  assert.match(orchestrator, /bounty_import_static_artifact[\s\S]*static-imports/);
  assert.match(orchestrator, /bounty_static_scan[\s\S]*static-scan-results\.jsonl/);
});

test("orchestrator documents operator-controlled egress without random proxy or TOR guidance", () => {
  const files = [
    ".claude/skills/bob-hunt/SKILL.md",
    ".claude/skills/bob-status/SKILL.md",
    ".claude/skills/bob-debug/SKILL.md",
    ".claude/agents/hunter-agent.md",
    ".claude/commands/bob-egress.md",
  ];
  const combined = files.map(readFile).join("\n");

  assert.match(combined, /--egress <profile>/);
  assert.match(combined, /egress_profile/);
  assert.match(combined, /network_unreachable_target/);
  assert.match(combined, /operator-controlled|operator has chosen|operator-managed/);
  assert.doesNotMatch(combined, /\bTOR\b|\bTor\b|random public prox(?:y|ies)|proxy scraping|auto-rotate|silent rotation/i);
});

test("orchestrator handles auto-signup manual fallback through data fallback fields", () => {
  const orchestrator = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestrator, /bounty_auto_signup/);
  assert.match(orchestrator, /result\.data\.fallback === "manual"/);
  assert.match(orchestrator, /result\.data\.reason[\s\S]*result\.data\.message/);
});

test("README describes MCP ranking as runtime prioritization, not persistent rewrites", () => {
  const readme = readFile("README.md");

  assert.match(readme, /MCP ranking computes runtime priority/);
  assert.match(readme, /Imports and public-intel fetches do not rewrite `attack_surface\.json`/);
  assert.doesNotMatch(readme, /MCP ranking can raise priority and add reasons/);
});

test("production CI runs npm test on supported Node versions without browser installs", () => {
  const workflow = readFile(".github/workflows/ci.yml");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /node-version: \[20, 22\]/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /patchright install|install-browser/);
});

test("bounty_http_scan prompt contracts require target_domain on every call", () => {
  const hunterPrompt = readFile(".claude/agents/hunter-agent.md");
  const orchestratorPrompt = readFile(".claude/skills/bob-hunt/SKILL.md");
  const evidencePrompt = readFile(".claude/agents/evidence-agent.md");
  const verifierPrompts = [
    readFile(".claude/agents/brutalist-verifier.md"),
    readFile(".claude/agents/balanced-verifier.md"),
    readFile(".claude/agents/final-verifier.md"),
  ];

  assert.match(hunterPrompt, /Every `bounty_http_scan` call must include `target_domain`/);
  assert.match(hunterPrompt, /`bounty_http_scan` with `target_domain`/);
  assert.doesNotMatch(hunterPrompt, /different domain than the target[\s\S]{0,160}target_domain/i);
  assert.doesNotMatch(hunterPrompt, /cross-domain[\s\S]{0,160}target_domain/i);

  assert.match(orchestratorPrompt, /bounty_http_scan\(\{ target_domain/);
  assert.match(orchestratorPrompt, /`bounty_http_scan` with `target_domain`/);
  assert.match(orchestratorPrompt, /bounty_http_scan with target_domain/);
  assert.doesNotMatch(orchestratorPrompt, /cross-domain[\s\S]{0,160}target_domain/i);
  assert.match(evidencePrompt, /All target requests must go through `bounty_http_scan` with `target_domain`/);

  for (const verifierPrompt of verifierPrompts) {
    assert.match(verifierPrompt, /`bounty_http_scan` with `target_domain` and the appropriate `auth_profile`/);
    assert.doesNotMatch(verifierPrompt, /cross-domain[\s\S]{0,160}target_domain/i);
  }
});

test("hunter and orchestrator prompts keep the structured handoff contract explicit", () => {
  const hunterPrompt = readFile(".claude/agents/hunter-agent.md");
  const orchestratorPrompt = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(hunterPrompt, /surface_type[\s\S]*bug_class_hints[\s\S]*high_value_flows/);
  assert.match(orchestratorPrompt, /surface_type[\s\S]*bug_class_hints[\s\S]*high_value_flows/);
  assert.match(hunterPrompt, /traffic_summary[\s\S]*audit_summary[\s\S]*circuit_breaker_summary[\s\S]*ranking_summary[\s\S]*intel_hints[\s\S]*static_scan_hints/);
  assert.match(hunterPrompt, /run_context/);
  assert.match(hunterPrompt, /run_context\.context_budget/);
  assert.match(hunterPrompt, /technique_packs\.selected/);
  assert.match(hunterPrompt, /bounty_read_technique_pack/);
  assert.match(hunterPrompt, /bounty_log_technique_attempt/);
  assert.match(hunterPrompt, /never write `technique-attempts\.jsonl` through Bash/);
  assert.match(orchestratorPrompt, /bounty_read_hunter_brief\(\{ target_domain:[\s\S]*egress_profile:[\s\S]*block_internal_hosts/);
  assert.match(orchestratorPrompt, /Context budget: \[assignment\.context_budget\]/);
  assert.match(orchestratorPrompt, /technique_packs\.selected/);
  assert.match(orchestratorPrompt, /bounty_read_technique_pack[\s\S]*bounty_log_technique_attempt/);
  assert.match(hunterPrompt, /Prefer real observed authenticated endpoints from `traffic_summary`/);
  assert.match(hunterPrompt, /Log coverage before switching away from a promising traffic-derived endpoint|log coverage before switching away from promising traffic-derived endpoints/i);
  assert.match(orchestratorPrompt, /traffic_summary[\s\S]*audit_summary[\s\S]*circuit_breaker_summary[\s\S]*ranking_summary[\s\S]*intel_hints[\s\S]*static_scan_hints/);
  assert.match(hunterPrompt, /bounty_import_static_artifact[\s\S]*bounty_static_scan/);
  assert.match(hunterPrompt, /never pass or scan arbitrary filesystem paths/i);
  assert.match(hunterPrompt, /Do not manually create orchestrator-consumed handoff files\./);
  assert.match(hunterPrompt, /BOB_HUNTER_DONE/);
  assert.match(orchestratorPrompt, /BOB_HUNTER_DONE/);
  assert.match(hunterPrompt, /Durable hunt state must flow only through MCP tools\./);
  assert.match(hunterPrompt, /bounty_record_surface_leads/);
  assert.match(hunterPrompt, /surface_leads/);
  assert.match(hunterPrompt, /surface-leads\.json/);
  assert.match(hunterPrompt, /bounty_log_coverage/);
  assert.match(hunterPrompt, /never write `coverage\.jsonl` through Bash/);
  assert.match(hunterPrompt, /Never create or backfill[\s\S]*technique-attempts\.jsonl[\s\S]*http-audit\.jsonl[\s\S]*traffic\.jsonl[\s\S]*public-intel\.json[\s\S]*static-artifacts\.jsonl[\s\S]*static-scan-results\.jsonl/);
  assert.match(hunterPrompt, /status` \(`tested`, `blocked`, `promising`, `needs_auth`, or `requeue`\)/);
  assert.match(hunterPrompt, /`INTERNAL_ERROR` 3 consecutive times/);
  assert.match(hunterPrompt, /each at most 300 chars; pre-truncate/);
  assert.match(orchestratorPrompt, /MCP-owned JSON artifacts are authoritative for orchestration\./);
  assert.match(orchestratorPrompt, /must never call `bounty_write_wave_handoff`/);
  assert.match(orchestratorPrompt, /must never synthesize or repair authoritative handoff JSON from markdown or `SESSION_HANDOFF\.md`/);
  assert.match(orchestratorPrompt, /Missing structured handoffs resolve only through `pending` or explicit `force-merge`\./);
  assert.match(orchestratorPrompt, /bounty_log_coverage/);
  assert.match(orchestratorPrompt, /never write `coverage\.jsonl` through Bash/);
});

test("bob-hunt routes surfaces after recon and spawns returned hunter agents", () => {
  const orchestratorPrompt = readFile(".claude/skills/bob-hunt/SKILL.md");
  const reconSection = orchestratorPrompt.match(/## PHASE 1: RECON([\s\S]*?)## PHASE 2: AUTH/)[1];

  assert.match(
    reconSection,
    /Agent\(subagent_type: "surface-router-agent", name: "surface-router", prompt: "/,
  );
  assert.match(reconSection, /Domain: \[domain\]\. Session: ~\/bounty-agent-sessions\/\[domain\]\./);
  assert.match(reconSection, /bounty_route_surfaces\(\{ target_domain: '\[domain\]' \}\) and use \.data/);
  assert.match(reconSection, /If routing fails or returns zero surfaces, report the error and stop/);
  assert.match(
    reconSection,
    /only after successful routing call `bounty_transition_phase\(\{ target_domain, to_phase: "AUTH" \}\)`/,
  );
  assert.match(orchestratorPrompt, /assignments\[\]\.hunter_agent/);
  assert.match(orchestratorPrompt, /subagent_type: "\[assignment\.hunter_agent\]"/);
  assert.match(orchestratorPrompt, /Capability pack: \[assignment\.capability_pack\]\. Brief profile: \[assignment\.brief_profile\]/);
  assert.match(orchestratorPrompt, /Context budget: \[assignment\.context_budget\]/);
});

test("generic web prompts do not embed future field-specific hunter workflows", () => {
  const documents = [
    readFile(".claude/skills/bob-hunt/SKILL.md"),
    readFile(".claude/agents/hunter-agent.md"),
  ].join("\n");
  assert.doesNotMatch(documents, /\b(EVM|Foundry|Halmos|SVM|Aptos|Sui|Substrate|CosmWasm)\b/i);
});

test("post-report evidence hunters are explicit and do not masquerade as wave handoffs", () => {
  const hunterPrompt = readFile(".claude/agents/hunter-agent.md");
  const orchestratorPrompt = readFile(".claude/skills/bob-hunt/SKILL.md");

  assert.match(orchestratorPrompt, /Post-REPORT user intent stays flexible/);
  assert.match(orchestratorPrompt, /transition `REPORT -> EXPLORE`/);
  assert.match(orchestratorPrompt, /post-report evidence mode without transitioning to EXPLORE/);
  assert.match(orchestratorPrompt, /BOB_HUNTER_DONE \{"target_domain":"\[domain\]","mode":"evidence"/);
  assert.match(hunterPrompt, /Post-report evidence mode is different/);
  assert.match(hunterPrompt, /Do not call `bounty_read_hunter_brief`/);
  assert.match(hunterPrompt, /Do not call `bounty_record_finding`, `bounty_write_wave_handoff`/);
  assert.match(hunterPrompt, /"mode":"evidence"/);
});
