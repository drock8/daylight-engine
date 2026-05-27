"use strict";

// Cycle C.7 of the frontier-topology realization hypergraph. Concentrates the
// four-hash binding logic that ReportSnapshot finalization depends on into a
// single helper so both bob_finalize_report (the new primary tool) and the
// legacy bounty_report_written shim can dual-write the same hash-bound
// snapshot. The four upstream hashes are:
//
//   1. claim_freeze_hash       — from readCurrentClaimFreeze (Cycle C.3+C.4 chain).
//   2. final_verification_hash — from the V2 final verification round bound to
//                                 the freeze (the round writer persists this as
//                                 document.final_verification_hash during the
//                                 V2 final-round write; only V2 final rounds
//                                 carry it).
//   3. evidence_hash           — digest over the canonical JSON of the evidence
//                                 packs document's packs[] manifest. The packs
//                                 document is itself bound to the V2 final
//                                 round via verification_attempt_id +
//                                 verification_snapshot_hash equality, so the
//                                 evidence_hash transitively binds to the
//                                 freeze.
//   4. grade_verdict_hash      — sha256 over the canonical JSON of the grade
//                                 verdict document. The grade verdict already
//                                 carries claim_freeze_id and is gate-bound to
//                                 the final verification, so the hash projects
//                                 the freeze + V2 final binding into a single
//                                 scalar.
//
// In addition the helper computes a fifth hash — the sha256 of the report.md
// file content — so a later consumer can prove the snapshot was finalized over
// an exact report.md file (a mutation invalidates the binding and a re-finalize
// will produce a new snapshot row with a new report_content_hash).
//
// Invariant: a fresh report cannot be finalized unless all four upstream
// hashes resolve. Each missing hash is surfaced as a structured ToolError so
// callers see the precise upstream that is missing (no freeze / no final
// verification / no grade verdict / no evidence pack). The report.md file
// must also exist; the legacy report_written check remains the first gate.

const crypto = require("crypto");
const fs = require("fs");

const {
  evidencePackPaths,
  reportMarkdownPath,
  verificationRoundPaths,
  gradeArtifactPaths,
  assertSafeDomain,
} = require("./paths.js");
const {
  ERROR_CODES,
  ToolError,
} = require("./envelope.js");
const {
  readCurrentClaimFreeze,
} = require("./claim-freeze.js");
const {
  hashCanonicalJson,
} = require("./verification-contracts.js");
const {
  loadJsonDocumentStrict,
} = require("./storage.js");

const HASH_HEX_RE = /^[0-9a-f]{64}$/i;

function readReportFileContent(domain) {
  const reportPath = reportMarkdownPath(domain);
  if (!fs.existsSync(reportPath)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `report.md is not present at ${reportPath}; call bob_finalize_report only after writing the report`,
      { missing_artifact: "report.md", report_path: reportPath },
    );
  }
  return {
    report_path: reportPath,
    content_buffer: fs.readFileSync(reportPath),
  };
}

function sha256Hex(input) {
  return crypto
    .createHash("sha256")
    .update(input)
    .digest("hex");
}

function loadClaimFreezeHash(domain) {
  const freeze = readCurrentClaimFreeze(domain);
  if (!freeze || typeof freeze !== "object") {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `no claim-freeze.json for ${domain}; advance to CLAIM_FREEZE and freeze the claim batch before finalizing the report`,
      { missing_artifact: "claim-freeze.json" },
    );
  }
  const hash = typeof freeze.freeze_hash === "string" ? freeze.freeze_hash : null;
  if (!hash || !HASH_HEX_RE.test(hash)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `claim-freeze.json for ${domain} is missing freeze_hash; the freeze must be a hash-bound artifact before finalization`,
      { missing_field: "freeze_hash", freeze_id: freeze.freeze_id || null },
    );
  }
  return {
    claim_freeze_id: typeof freeze.freeze_id === "string" ? freeze.freeze_id : null,
    claim_freeze_hash: hash.toLowerCase(),
    claim_ids: Array.isArray(freeze.claims)
      ? freeze.claims
          .map((claim) => claim && typeof claim.claim_id === "string" ? claim.claim_id : null)
          .filter((id) => id != null)
      : [],
  };
}

function loadFinalVerificationHash(domain) {
  const paths = verificationRoundPaths(domain, "final");
  if (!fs.existsSync(paths.json)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `final verification round is not present at ${paths.json}; write a V2 final verification round before finalizing the report`,
      { missing_artifact: "verification round (final)" },
    );
  }
  let document;
  try {
    document = loadJsonDocumentStrict(paths.json, "final verification round JSON");
  } catch (error) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `final verification round at ${paths.json} could not be loaded: ${error.message || String(error)}`,
      { missing_artifact: "verification round (final)" },
    );
  }
  // Only V2 final rounds carry the final_verification_hash field. C.7 requires
  // a freeze-bound V2 final round; a V1 round is allowed during the
  // deprecation window for legacy tests but the finalize path refuses it.
  const hash = document && typeof document.final_verification_hash === "string"
    ? document.final_verification_hash
    : null;
  if (!hash || !HASH_HEX_RE.test(hash)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `final verification round at ${paths.json} is missing final_verification_hash; the final round must be V2 and bound to the claim freeze before report finalization`,
      {
        missing_field: "final_verification_hash",
        round: "final",
        schema_version: document && document.version != null ? document.version : null,
      },
    );
  }
  return hash.toLowerCase();
}

function loadEvidencePackHash(domain) {
  const paths = evidencePackPaths(domain);
  if (!fs.existsSync(paths.json)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `evidence packs are not present at ${paths.json}; write evidence packs before finalizing the report`,
      { missing_artifact: "evidence-packs.json" },
    );
  }
  let document;
  try {
    document = loadJsonDocumentStrict(paths.json, "evidence packs JSON");
  } catch (error) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `evidence packs at ${paths.json} could not be loaded: ${error.message || String(error)}`,
      { missing_artifact: "evidence-packs.json" },
    );
  }
  if (!document || !Array.isArray(document.packs)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `evidence packs at ${paths.json} are malformed (no packs[] array); rewrite the evidence packs before finalization`,
      { missing_field: "packs" },
    );
  }
  // The evidence_hash is computed over the canonical JSON of the packs[]
  // manifest. Including only packs[] makes the binding stable across
  // verification-attempt-id renames or schema-version bumps that touch only
  // top-level metadata; what we are binding the report to is the actual
  // evidence content captured for each reportable claim.
  return hashCanonicalJson(document.packs);
}

function loadGradeVerdictHash(domain) {
  const paths = gradeArtifactPaths(domain);
  if (!fs.existsSync(paths.json)) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `grade verdict is not present at ${paths.json}; write the grade verdict before finalizing the report`,
      { missing_artifact: "grade.json" },
    );
  }
  let document;
  try {
    document = loadJsonDocumentStrict(paths.json, "grade verdict JSON");
  } catch (error) {
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `grade verdict at ${paths.json} could not be loaded: ${error.message || String(error)}`,
      { missing_artifact: "grade.json" },
    );
  }
  return hashCanonicalJson(document);
}

// Resolve the four upstream hashes + the report.md content hash for the
// given target_domain. Throws ToolError with a precise upstream pointer on
// any missing artifact. The returned bundle is the input shape that the
// ReportSnapshot append operation expects, plus convenience fields.
function resolveReportFinalizationHashes(targetDomain) {
  const domain = assertSafeDomain(targetDomain);
  const reportFile = readReportFileContent(domain);
  const claimFreeze = loadClaimFreezeHash(domain);
  const finalVerificationHash = loadFinalVerificationHash(domain);
  const evidenceHash = loadEvidencePackHash(domain);
  const gradeVerdictHash = loadGradeVerdictHash(domain);
  const reportContentHash = sha256Hex(reportFile.content_buffer);
  return {
    target_domain: domain,
    report_path: reportFile.report_path,
    report_size_bytes: reportFile.content_buffer.length,
    claim_freeze_id: claimFreeze.claim_freeze_id,
    claim_freeze_hash: claimFreeze.claim_freeze_hash,
    claim_ids: claimFreeze.claim_ids,
    final_verification_hash: finalVerificationHash,
    evidence_hash: evidenceHash,
    grade_verdict_hash: gradeVerdictHash,
    report_content_hash: reportContentHash,
  };
}

// Same as resolveReportFinalizationHashes but never throws: returns null when
// any upstream hash cannot be resolved. Used by the legacy report_written
// shim so its dual-write path stays best-effort and never regresses the
// existing pipeline-event emission.
function tryResolveReportFinalizationHashes(targetDomain) {
  try {
    return resolveReportFinalizationHashes(targetDomain);
  } catch {
    return null;
  }
}

module.exports = {
  HASH_HEX_RE,
  loadClaimFreezeHash,
  loadEvidencePackHash,
  loadFinalVerificationHash,
  loadGradeVerdictHash,
  readReportFileContent,
  resolveReportFinalizationHashes,
  sha256Hex,
  tryResolveReportFinalizationHashes,
};
