# Context Scaling Plan for Platform Adapters

Audience: Eric's agent working on `platform-adapters`.

Date: 2026-05-02.

## Why This Exists

Hacker Bob is about to support more attack surfaces beyond the current web-oriented flow. The next merge is expected to add smart contract platform adapters. After that, the project will likely grow toward hundreds or thousands of surface-specific techniques, playbooks, and skills.

The core risk is context management. If every surface loads every possible skill, or if every exploit technique becomes a globally available custom agent or Claude skill, the system will become expensive, brittle, and hard to reason about. It will also make the orchestrator harder to maintain and could weaken the clean MCP-owned session architecture that is now on `main`.

The goal is to scale features without turning context loading into an uncontrolled prompt blob.

## Current Main Architecture

`main` now includes the capability router work.

Important properties to preserve:

- Surface routing is centralized through capability packs.
- Wave assignments are stamped with routing metadata such as `capability_pack`, `hunter_agent`, and `brief_profile`.
- The orchestrator should spawn `assignment.hunter_agent` from `bounty_start_wave` output instead of hard-coding hunter names.
- Claude `SubagentStop` hook matchers are derived from configured capability-pack hunter agents, not from a fixed `hunter-agent` string.
- Session artifacts remain MCP-owned. Preserve the read/write guards around session files, especially `surface-routes.json`.
- `bounty_finalize_hunter_run` is the right boundary for hunter completion and should be kept when rebasing `platform-adapters`.

## Recommendation

Use a hybrid of dynamic adaptive hunters plus a Bob-owned technique registry.

Do not make Claude Code agent teams the default execution model.

Research-backed conclusion: this is the right base architecture, but the important wording is "dynamic technique loading", not "dynamic skill preloading". Hunters should start with small, typed briefs and then request technique context through Bob-owned MCP tools. That keeps routing, state, budgets, audit logs, and adapter portability outside any one model provider.

The baseline should be:

1. Keep a small number of broad surface-family hunters.
2. Route surfaces to those hunters through capability packs.
3. Let hunters dynamically request only the technique packs they need.
4. Keep technique selection and context budgeting inside Bob/MCP-owned tools.
5. Use Claude Code agent teams only as an optional escalation path for unusually broad or high-value surfaces.

## Research Findings

The current plan matches the direction of modern agent systems:

- LangChain's context-engineering guidance frames reliability mainly as a problem of giving the model the right information and tools in the right format, not more information.
- LangGraph and OpenAI's Agents SDK both separate deterministic code-owned routing from LLM-owned flexible orchestration. Bob's capability router fits the code-owned path because surface family routing is a known classification problem.
- OpenAI's orchestration guidance recommends a manager-style pattern when one component should retain workflow control and synthesize specialist outputs. That maps to Bob's orchestrator and MCP-owned state.
- Claude Code agent teams are useful for parallel research and coordination, but the official docs call them experimental, higher-token, and better for independent teammates. They should be an escalation mode, not the default hunt path.
- Claude subagents can preload skills, but preloaded skill content is injected into the subagent context. That does not scale to hundreds or thousands of techniques.
- Magentic-One-style teams are strong for open-ended, unknown solution paths, but they use a shared manager context and dynamic agent selection. That is useful for difficult escalations, not for every routed surface.
- Security-agent research points in the same direction. PentestGPT used modular components to reduce context loss. PentestEval reports that stage-level modularization improves reliability over black-box end-to-end agents. AWE shows that vulnerability-specific pipelines inside lightweight orchestration can be more deterministic and token-efficient than unconstrained exploration. hackingBuddyGPT reports that context management, high-level guidance, and reflection improve autonomous exploitation outcomes.
- Memory research such as MemGPT supports tiered memory: keep active context small, move long-lived knowledge and history into external stores, and retrieve only what is needed.

The conclusion is not "more agents". The conclusion is "more structure around what each agent is allowed to see and do".

## Architecture Adjustments

The existing plan should be tightened in these ways:

1. Treat technique packs as Bob registry records, not Claude skills by default.
2. Add an explicit context budget contract to every routed assignment.
3. Version capability packs, brief profiles, and technique packs.
4. Require technique selection and technique reads to be logged.
5. Keep platform adapters responsible for normalizing platform-specific evidence into canonical surfaces, not for choosing hunters directly.
6. Use deterministic metadata filters before semantic retrieval when selecting technique packs.
7. Add evals before the registry becomes large: route accuracy, token budget, duplicate-attempt prevention, and finalization quality.

## Key Concepts

### Capability Pack

A capability pack is the surface-level route.

Examples:

- `web`
- `smart_contract_evm`
- `smart_contract_svm`
- `mobile_api`
- `cloud_iam`
- `kubernetes`
- `graphql`

Capability packs should answer:

- Which hunter agent owns this surface family?
- What brief profile should the hunter receive?
- What tool permissions does that hunter need?
- What high-level constraints apply to that surface?
- What context budget and escalation policy apply?

Capability packs should not contain every exploit playbook.

### Technique Pack

A technique pack is a focused attack or analysis playbook.

Examples:

- `graphql-introspection-abuse`
- `evm-upgradeable-proxy-admin-bypass`
- `evm-reentrancy-review`
- `jwt-alg-none`
- `k8s-service-account-token-abuse`

Technique packs should be loaded on demand, not globally injected into every hunter context.

Technique packs should have a small manifest and tiered bodies:

- `manifest`: ID, capability families, tags, prerequisites, expected evidence, risk level, and estimated token cost.
- `summary`: compact decision tree and checklist.
- `full`: detailed playbook loaded only after the hunter has evidence that the technique is relevant.
- `verification`: what evidence proves or disproves the issue.
- `contraindications`: signals that should stop the hunter from wasting context on this technique.

### Hunter Agent

A hunter agent should own a family of surfaces, not a single technique.

Good direction:

- `hunter-web-agent`
- `hunter-evm-agent`
- `hunter-svm-agent`
- `hunter-api-agent`
- `hunter-cloud-agent`
- `hunter-mobile-agent`

Avoid creating one custom agent per exploit technique. That creates too many agents to route, test, and maintain.

### Brief Compiler

The brief compiler is the part of Bob that decides what context a hunter receives at launch.

It should produce bounded, structured context:

- Surface identity and scope.
- Capability pack.
- Relevant route metadata.
- Allowed tools.
- Small set of candidate technique pack IDs.
- Context budget.
- Known constraints and exclusions.

The brief should be enough to start work, not enough to preload the entire knowledge base.

### Context Budget Contract

Every assignment should eventually carry an explicit budget:

```json
{
  "context_budget": {
    "brief_max_tokens": 2500,
    "candidate_pack_limit": 5,
    "full_pack_read_limit": 2,
    "attempt_log_required": true,
    "team_escalation_allowed": false
  }
}
```

This makes context pressure observable and testable instead of relying on prompt discipline.

## Proposed Execution Flow

1. Discovery creates or updates surface records.
2. The surface router maps each surface to a capability pack.
3. `bounty_start_wave` returns assignments with:
   - `surface_id`
   - `capability_pack`
   - `hunter_agent`
   - `brief_profile`
   - candidate technique pack IDs, if known
   - context budget metadata, if available
   - route and pack version metadata, once versioning exists
4. The orchestrator spawns `assignment.hunter_agent`.
5. The hunter receives only the compiled surface brief.
6. The hunter asks Bob/MCP for additional technique context only when needed.
7. The hunter logs attempted techniques and outcomes.
8. The hunter completes through `bounty_finalize_hunter_run`.

## Proposed MCP Tools

These tools do not all need to exist in the first smart contracts merge, but the design should leave room for them.

### `bounty_select_technique_packs`

Input:

```json
{
  "target_domain": "example.com",
  "surface_id": "surface-123",
  "capability_pack": "smart_contract_evm",
  "budget": {
    "max_packs": 5,
    "max_tokens": 6000
  }
}
```

Output:

```json
{
  "technique_packs": [
    {
      "id": "evm-upgradeable-proxy-admin-bypass",
      "reason": "Proxy pattern detected in ABI metadata",
      "priority": "high"
    }
  ]
}
```

Purpose: keep selection deterministic, auditable, and outside the main prompt.

### `bounty_read_technique_pack`

Input:

```json
{
  "pack_id": "evm-upgradeable-proxy-admin-bypass",
  "mode": "summary"
}
```

Modes:

- `summary`: compact checklist and decision tree.
- `full`: detailed playbook when the hunter has evidence that the technique is relevant.

Purpose: avoid loading full technique bodies until the hunter has a reason.

### `bounty_log_technique_attempt`

Input:

```json
{
  "surface_id": "surface-123",
  "pack_id": "evm-upgradeable-proxy-admin-bypass",
  "status": "attempted",
  "outcome": "not_applicable",
  "evidence": "Contract is not proxy-based"
}
```

Purpose: preserve traceability and prevent repeated wasted context across waves.

### `bounty_get_context_budget`

Input:

```json
{
  "surface_id": "surface-123",
  "capability_pack": "smart_contract_evm",
  "brief_profile": "evm"
}
```

Output:

```json
{
  "brief_max_tokens": 2500,
  "candidate_pack_limit": 5,
  "full_pack_read_limit": 2,
  "team_escalation_allowed": false
}
```

Purpose: make budget policy centrally configurable and easy to test.

## Claude Code Agent Teams

Claude Code agent teams may still be useful, but they should not be the default design.

Use teams only when:

- A surface is high-value.
- The surface spans multiple capability families.
- The expected search space is too broad for one hunter.
- There is a clear budget for extra coordination and token cost.

Do not depend on teams for the core architecture because:

- They are Claude-specific and reduce portability to other adapters.
- They add coordination overhead.
- They can increase token usage significantly.
- They are not needed for most narrow surface assignments.

If used, treat teams as an escalation mode above the normal capability-pack routing flow:

```text
surface -> capability pack -> normal hunter
        -> optional escalation -> agent team
```

## Smart Contracts Merge Guidance

When rebasing `platform-adapters` onto `origin/main`, Eric's agent should preserve the new routing and context-management behavior.

Required integration points:

- Add smart contract routes as capability packs instead of branching manually in the orchestrator.
- Prefer separate capability packs for major smart contract families, for example `smart_contract_evm` and `smart_contract_svm`, if both are in scope.
- Keep `bounty_finalize_hunter_run`.
- Ensure wave assignments include the selected smart contract `hunter_agent`.
- Ensure the orchestrator spawns the hunter from `assignment.hunter_agent`.
- Keep platform adapters focused on extracting and normalizing platform artifacts such as chains, contracts, ABIs, bytecode, source links, deployments, and audit metadata into canonical surface records.
- Do not let platform adapters own final hunter selection if the capability router can decide from canonical surface metadata.
- If Claude config moved into `adapters/claude/config.js`, port the derived `SubagentStop` hook behavior from `main`.
- Preserve session read/write guards from `main`.
- Keep `surface-routes.json` MCP-owned.
- Avoid giving all smart contract hunters the exact same broad web-hunter tool role if a narrower smart contract role is practical.

## What Not To Do

Do not:

- Load every skill into every hunter prompt.
- Create one custom agent for every exploit technique.
- Put surface routing logic directly into the orchestrator.
- Hard-code Claude hook matchers to one hunter agent name.
- Let non-MCP code own session artifact writes.
- Treat Claude skills as the main storage layer for thousands of technique bodies.
- Make agent teams mandatory for normal surface execution.
- Rely on pure vector search to choose techniques when deterministic metadata such as chain, language, ABI shape, source availability, or contract pattern is available.
- Let hunters repeatedly try the same technique without logging why it succeeded, failed, or was not applicable.

## Near-Term Implementation Plan

1. Rebase `platform-adapters` onto `origin/main`.
2. Add smart contract capability packs in `mcp/lib/capability-packs.js`.
3. Wire smart contract surface detection to produce routeable surface records.
4. Make `bounty_start_wave` return smart contract assignments with `capability_pack`, `hunter_agent`, and `brief_profile`.
5. Keep the orchestrator generic by spawning `assignment.hunter_agent`.
6. Preserve derived Claude `SubagentStop` hook generation.
7. Preserve session artifact ownership guards.
8. Add focused tests for:
   - smart contract surface routing
   - wave assignment metadata
   - hunter agent hook coverage
   - session artifact ownership
   - finalization through `bounty_finalize_hunter_run`
   - route/version metadata once added
   - context budget propagation once added

Do not block the first smart contracts merge on the full technique registry. The smart contract merge should preserve the extension points and avoid architecture choices that make the registry hard to add later.

## Evaluation Gates

Before adding many technique packs, add repeatable checks for:

- Route accuracy across mixed web and smart contract surfaces.
- Prompt/context size per hunter launch.
- Number of technique summaries and full technique bodies loaded per assignment.
- Duplicate technique attempts across waves.
- Evidence quality in `bounty_finalize_hunter_run`.
- Whether a hunter exceeded its budget or needed escalation.

These metrics are more useful than subjective prompt review once the project has many surfaces.

## Sources Reviewed

- [LangChain context engineering](https://docs.langchain.com/oss/python/langchain/context-engineering)
- [LangChain router guidance](https://docs.langchain.com/oss/python/langchain/multi-agent/router)
- [LangChain handoffs guidance](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs)
- [OpenAI Agents SDK orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Microsoft Agent Framework Magentic orchestration](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic)
- [Magentic-One](https://arxiv.org/abs/2411.04468)
- [MemGPT](https://arxiv.org/abs/2310.08560)
- [PentestGPT](https://arxiv.org/abs/2308.06782)
- [HackSynth](https://arxiv.org/abs/2412.01778)
- [AWE](https://www.ndss-symposium.org/ndss-paper/auto-draft-680/)
- [hackingBuddyGPT](https://arxiv.org/abs/2310.11409)
- [PentestEval](https://arxiv.org/abs/2512.14233)
- [AutoSecAgent](https://link.springer.com/article/10.1007/s11227-026-08439-z)

## Longer-Term Direction

After smart contracts land, build the technique registry incrementally.

Start with a small set of high-value technique packs per capability family. Add MCP selection and read tools before the registry becomes large. The important scaling principle is that Bob should choose and meter context before the model sees it.

The architecture should remain:

```text
MCP-owned registry + router + brief compiler
        -> small number of surface-family hunters
        -> on-demand technique pack reads
        -> structured finalization
```

This keeps Hacker Bob maintainable as new surfaces and techniques are added.
