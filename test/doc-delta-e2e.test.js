"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  attackSurfacePath,
  executeTool,
  sessionDir,
  writeFileAtomic,
} = require("../mcp/server.js");

const ROOT = path.join(__dirname, "..");

function withTempHome(fn) {
  const previousHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bob-doc-delta-e2e-"));
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

function uniqueDomain() {
  return `doc-delta-e2e-${crypto.randomBytes(4).toString("hex")}.example`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function openApiFixture() {
  return JSON.stringify({
    openapi: "3.0.3",
    paths: {
      "/users": {
        get: {
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "name"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "unauthorized" },
          },
        },
      },
      "/health": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

function createFixtureServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/users") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "u-1", debug_token: "fixture" }));
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

function seedAttackSurface(domain, baseUrl) {
  fs.mkdirSync(sessionDir(domain), { recursive: true });
  writeFileAtomic(attackSurfacePath(domain), `${JSON.stringify({
    surfaces: [{
      id: "fixture-api",
      surface_type: "api",
      hosts: [baseUrl],
      endpoints: ["/users", "/health"],
      tech_stack: ["node-http-fixture"],
    }],
  }, null, 2)}\n`);
}

function runMcpScopeGuard(toolInput, home) {
  return spawnSync("bash", [path.join(ROOT, ".claude", "hooks", "scope-guard-mcp.sh")], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

test("bounty_run_doc_delta drives the real MCP tool against a local HTTP fixture", async () => {
  await withTempHome(async (tempHome) => {
    const server = createFixtureServer();
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;
    const domain = uniqueDomain();

    try {
      const init = await executeTool("bounty_init_session", {
        target_domain: domain,
        target_url: baseUrl,
      });
      assert.equal(init.ok, true, init.error && init.error.message);
      seedAttackSurface(domain, baseUrl);

      const ingest = await executeTool("bounty_ingest_schema_doc", {
        target_domain: domain,
        raw_doc: openApiFixture(),
        source_uri: `${baseUrl}/openapi.json`,
      });
      assert.equal(ingest.ok, true, ingest.error && ingest.error.message);
      assert.equal(ingest.data.contract_count, 2);

      const guardedInput = {
        target_domain: domain,
        base_url: baseUrl,
        run_id: "doc-delta-e2e",
        block_internal_hosts: false,
      };
      const guard = runMcpScopeGuard(guardedInput, tempHome);
      assert.equal(guard.status, 0, guard.stderr);

      const run = await executeTool("bounty_run_doc_delta", guardedInput);
      assert.equal(run.ok, true, run.error && run.error.message);
      assert.equal(run.data.summary.contracts_tested, 2);
      assert.equal(run.data.summary.fetch_errors, 0);
      assert.ok(run.data.summary.divergences_total >= 3);
      assert.equal(run.data.results_path, "doc-delta-results.json");

      const resultsPath = path.join(tempHome, "bounty-agent-sessions", domain, "doc-delta-results.json");
      assert.ok(fs.existsSync(resultsPath), "doc-delta-results.json was not written");
      const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
      assert.equal(results.summary.run_id, "doc-delta-e2e");
      const users = results.per_contract.find((entry) => entry.endpoint === "/users");
      assert.ok(users, "expected /users contract row");
      assert.deepEqual(
        users.divergences.map((entry) => entry.type).sort(),
        [
          "auth_required_but_succeeded_without",
          "required_field_missing_in_response",
          "undocumented_field_in_response",
        ],
      );
      const health = results.per_contract.find((entry) => entry.endpoint === "/health");
      assert.ok(health, "expected /health contract row");
      assert.deepEqual(health.divergences, []);
    } finally {
      await closeServer(server);
    }
  });
});
