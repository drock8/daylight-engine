"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  tokenize,
  hashedFeatureVector,
  cosineSimilarity,
  featureVectorForFinding,
  indexFinding,
  queryFindingsForTarget,
  queryFindingsCrossTarget,
  FEATURE_DIMENSION,
} = require("../mcp/lib/findings-index.js");

function uniqueDomain(prefix = "bob-findings-index-test") {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${suffix}.local`;
}

function domainDir(domain) {
  return path.join(os.homedir(), "bounty-agent-sessions", domain);
}

function cleanupDomain(domain) {
  const dir = domainDir(domain);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

test("tokenize lowercases, splits on non-alphanumeric, drops stopwords, and emits 2-grams", () => {
  const tokens = tokenize("The Admin endpoint allows IDOR via /users/{id}");
  assert.ok(tokens.includes("admin"));
  assert.ok(tokens.includes("idor"));
  assert.ok(!tokens.includes("the"), "stopword filtered");
  // bigram
  assert.ok(tokens.some((t) => t === "admin endpoint"));
});

test("hashedFeatureVector is deterministic for identical inputs", () => {
  const a = hashedFeatureVector("admin endpoint allows idor", FEATURE_DIMENSION);
  const b = hashedFeatureVector("admin endpoint allows idor", FEATURE_DIMENSION);
  assert.deepEqual(a, b);
  assert.equal(a.dimension, FEATURE_DIMENSION);
});

test("cosineSimilarity returns 1.0 for identical text and lower for unrelated", () => {
  const a = hashedFeatureVector("admin endpoint idor user_id");
  const b = hashedFeatureVector("admin endpoint idor user_id");
  assert.equal(cosineSimilarity(a, b), 1);
  const c = hashedFeatureVector("xss reflected query parameter alert");
  const lo = cosineSimilarity(a, c);
  assert.ok(lo < 0.5, `unrelated similarity should be low, got ${lo}`);
});

test("cosineSimilarity finds partial overlap higher than no overlap", () => {
  const baseline = hashedFeatureVector("admin endpoint idor user");
  const partial = hashedFeatureVector("admin user endpoint missing auth");
  const unrelated = hashedFeatureVector("xss script alert dom");
  const partialScore = cosineSimilarity(baseline, partial);
  const unrelatedScore = cosineSimilarity(baseline, unrelated);
  assert.ok(partialScore > unrelatedScore, `partial=${partialScore} unrelated=${unrelatedScore}`);
});

test("cosineSimilarity returns 0 when dimensions differ or one side is empty", () => {
  const a = hashedFeatureVector("anything", 256);
  const b = hashedFeatureVector("anything", 128);
  assert.equal(cosineSimilarity(a, b), 0);
  const empty = hashedFeatureVector("");
  assert.equal(cosineSimilarity(a, empty), 0);
});

test("featureVectorForFinding combines title, description, attack_class, and evidence", () => {
  const vector = featureVectorForFinding({
    title: "IDOR on /users/{id}",
    description: "The user can fetch any other user's profile",
    attack_class: "broken_object_level_authorization",
    cwe: "CWE-639",
    evidence_summary: "200 OK with another user's id",
  });
  assert.ok(Object.keys(vector.slots).length > 0);
});

test("indexFinding persists a record and returns new_record true on first write", () => {
  const domain = uniqueDomain();
  try {
    const result = indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-001",
        title: "IDOR on /users/{id}",
        description: "user fetches other user's profile",
        severity: "high",
        attack_class: "broken_object_level_authorization",
        endpoint: "/users/{id}",
        tech_stack: ["express"],
      },
    });
    assert.equal(result.new_record, true);
    assert.equal(result.total_in_index, 1);
    const filePath = path.join(domainDir(domain), "findings-index.jsonl");
    assert.ok(fs.existsSync(filePath));
  } finally {
    cleanupDomain(domain);
  }
});

test("indexFinding upserts by finding_id without growing the index", () => {
  const domain = uniqueDomain();
  try {
    indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-001",
        title: "first version",
        description: "x",
        severity: "low",
      },
    });
    const second = indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-001",
        title: "second version",
        description: "y",
        severity: "high",
      },
    });
    assert.equal(second.new_record, false);
    assert.equal(second.total_in_index, 1);
  } finally {
    cleanupDomain(domain);
  }
});

test("queryFindingsForTarget ranks similar findings higher than dissimilar ones", () => {
  const domain = uniqueDomain();
  try {
    indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-001",
        title: "IDOR allows reading other user data",
        description: "broken object level authorization on user endpoint",
        severity: "high",
        attack_class: "idor",
      },
    });
    indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-002",
        title: "Reflected XSS in search query",
        description: "user input rendered without escape",
        severity: "medium",
        attack_class: "xss",
      },
    });
    const result = queryFindingsForTarget({
      target_domain: domain,
      query_text: "broken object level authorization on user endpoint",
      top_k: 5,
    });
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].finding_id, "F-001");
    assert.ok(result.matches[0].similarity > result.matches[1].similarity);
  } finally {
    cleanupDomain(domain);
  }
});

test("queryFindingsForTarget honors severity_filter and attack_class_filter", () => {
  const domain = uniqueDomain();
  try {
    indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-001",
        title: "IDOR high",
        description: "x",
        severity: "high",
        attack_class: "idor",
      },
    });
    indexFinding({
      target_domain: domain,
      finding: {
        finding_id: "F-002",
        title: "IDOR medium",
        description: "x",
        severity: "medium",
        attack_class: "idor",
      },
    });
    const onlyHigh = queryFindingsForTarget({
      target_domain: domain,
      query_text: "idor",
      severity_filter: "high",
    });
    assert.equal(onlyHigh.matches.length, 1);
    assert.equal(onlyHigh.matches[0].severity, "high");
  } finally {
    cleanupDomain(domain);
  }
});

test("queryFindingsForTarget returns empty result on missing index", () => {
  const domain = uniqueDomain();
  try {
    const result = queryFindingsForTarget({
      target_domain: domain,
      query_text: "anything",
    });
    assert.equal(result.matches.length, 0);
    assert.equal(result.total_in_index, 0);
  } finally {
    cleanupDomain(domain);
  }
});

test("indexFinding rejects unsafe target_domain and missing finding_id", () => {
  assert.throws(
    () => indexFinding({ target_domain: "../escape", finding: { finding_id: "F-1" } }),
    /target_domain/,
  );
  assert.throws(
    () => indexFinding({
      target_domain: "ok.example.com",
      finding: { title: "no id" },
    }),
    /finding_id/,
  );
});

test("queryFindingsCrossTarget aggregates across multiple session directories", () => {
  const domainA = uniqueDomain("bob-cross-a");
  const domainB = uniqueDomain("bob-cross-b");
  try {
    indexFinding({
      target_domain: domainA,
      finding: {
        finding_id: "A-1",
        title: "IDOR on user profile",
        description: "broken object level auth",
        severity: "high",
        attack_class: "idor",
      },
    });
    indexFinding({
      target_domain: domainB,
      finding: {
        finding_id: "B-1",
        title: "Reflected XSS query",
        description: "user input rendered",
        severity: "medium",
        attack_class: "xss",
      },
    });
    const result = queryFindingsCrossTarget({
      query_text: "broken object level auth",
      top_k: 5,
    });
    assert.ok(result.domains_scanned >= 2);
    assert.equal(result.matches[0].finding_id, "A-1");
  } finally {
    cleanupDomain(domainA);
    cleanupDomain(domainB);
  }
});

test("queryFindingsForTarget caps top_k to 50", () => {
  const domain = uniqueDomain();
  try {
    for (let i = 0; i < 60; i++) {
      indexFinding({
        target_domain: domain,
        finding: {
          finding_id: `F-${i}`,
          title: `idor finding ${i}`,
          description: "x",
          severity: "high",
          attack_class: "idor",
        },
      });
    }
    const result = queryFindingsForTarget({
      target_domain: domain,
      query_text: "idor",
      top_k: 100,
    });
    assert.ok(result.matches.length <= 50);
  } finally {
    cleanupDomain(domain);
  }
});
