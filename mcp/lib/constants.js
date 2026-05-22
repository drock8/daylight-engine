"use strict";

const FINDING_ID_RE = /^F-([1-9]\d*)$/;
const WAVE_ID_RE = /^w([1-9]\d*)$/;
const AGENT_ID_RE = /^a([1-9]\d*)$/;

const SEVERITY_VALUES = ["critical", "high", "medium", "low", "info"];
const SURFACE_TYPE_VALUES = ["web", "smart_contract", "mobile_app"];
const CHAIN_FAMILY_VALUES = ["evm", "svm", "aptos", "sui", "substrate", "cosmwasm"];
const MOBILE_PLATFORM_VALUES = ["android", "ios"];
const MOBILE_ARTIFACT_ID_RE = /^MA-([1-9]\d*)$/;
const MOBILE_ARTIFACT_TYPE_VALUES = ["android_apk", "android_aab", "android_xapk", "ios_ipa", "ios_app_bundle"];
const MOBILE_ARTIFACT_MAX_BYTES = 25_000_000;
const MOBILE_ARTIFACT_LOG_MAX_RECORDS = 500;
const MOBILE_STATIC_SCAN_RESULTS_MAX_RECORDS = 1_000;
const MOBILE_STATIC_SCAN_HINT_MAX_ITEMS = 10;
const MOBILE_BACKEND_LEAD_MAX_ITEMS = 15;
const MOBILE_DEVICE_PROFILE_ID_RE = /^MDP-([1-9]\d*)$/;
const MOBILE_DEVICE_LEASE_ID_RE = /^MDL-([1-9]\d*)$/;
const MOBILE_DEVICE_PROFILE_KIND_VALUES = ["android_emulator", "android_physical", "ios_simulator", "ios_physical"];
const MOBILE_DEVICE_ACTION_VALUES = [
  "install_launch",
  "deeplink_probe",
  "log_capture",
  "storage_probe",
  "proxy_intercept",
  "instrumentation",
  "pinning_bypass",
  "keychain_container_access",
];
const MOBILE_EVIDENCE_TYPE_VALUES = ["static_analysis", "dynamic_replay", "hybrid"];
const MOBILE_EVIDENCE_RISK_CLASS_VALUES = [
  "exported_component",
  "deeplink",
  "permission",
  "network_config",
  "hardcoded_endpoint",
  "secret_hint",
  "other",
];
const MOBILE_EVIDENCE_REPRODUCTION_LIMIT_VALUES = ["static_only", "requires_device", "requires_backend_validation"];
const MOBILE_COVERAGE_MODE_VALUES = [
  "static_only",
  "dynamic_attempted",
  "dynamic_confirmed",
  "instrumentation_forbidden",
  "lead_only",
];
const SVM_CLUSTER_VALUES = ["mainnet-beta", "devnet", "testnet"];
// Aptos and Sui both identify networks by string name in tooling and RPC URLs.
// Integer chain IDs exist on Aptos (1, 2, ...), but they're used for replay
// protection — operators key RPC pools by network NAME (mainnet/testnet/etc).
// Sui has no integer chain id at all. Aptos lacks a stable persistent
// "localnet" — the local testnet has a dynamically rotating chain_id.
const APTOS_NETWORK_VALUES = ["mainnet", "testnet", "devnet"];
const SUI_NETWORK_VALUES = ["mainnet", "testnet", "devnet", "localnet"];
// Substrate parachains identify networks by name. Polkadot, Kusama, Astar,
// Shiden, and the testnets (Rococo, Westend) are the common ink! deployment
// targets in 2025-2026. Operators add private parachain chains via env
// override (BOB_SUBSTRATE_RPCS_<NAME>=...). Localnet covers `substrate-contracts-node`
// dev environments running on 127.0.0.1.
const SUBSTRATE_NETWORK_VALUES = [
  "polkadot",
  "kusama",
  "astar",
  "shiden",
  "rococo",
  "westend",
  "localnet",
];
// CosmWasm chains identify networks by chain name. The 2025-2026 active set
// ships with osmosis, juno, neutron, archway, sei, stargaze, terra (terra2),
// and kava. Localnet covers `wasmd`/`junod` dev environments. Operators add
// new chains via env override (BOB_COSMWASM_RPCS_<NAME>=...).
const COSMWASM_NETWORK_VALUES = [
  "osmosis",
  "juno",
  "neutron",
  "archway",
  "sei",
  "stargaze",
  "terra",
  "kava",
  "localnet",
];
const PHASE_VALUES = ["RECON", "AUTH", "HUNT", "CHAIN", "VERIFY", "GRADE", "REPORT", "EXPLORE"];
const AUTH_STATUS_VALUES = ["pending", "authenticated", "unauthenticated"];
const CHECKPOINT_MODE_VALUES = ["normal", "paranoid", "yolo"];
const VERIFICATION_ROUND_VALUES = ["brutalist", "balanced", "final"];
const VERIFICATION_DISPOSITION_VALUES = ["confirmed", "denied", "downgraded"];
const VERIFICATION_CONFIDENCE_VALUES = ["high", "medium", "low"];
const VERIFICATION_CONFIDENCE_REASON_VALUES = [
  "fresh_replay_passed",
  "auth_expired",
  "tooling_blocked",
  "state_changed",
  "manual_inference",
  "roast_disagreement",
  "disambiguation_failed",
  "agreement_not_replayed",
];
const VERIFICATION_REPLAY_PURPOSE_VALUES = ["verification_replay", "evidence_replay"];
const VERIFY_SMALL_REPORTABLE_THRESHOLD = 5;
const VERIFY_QA_SAMPLE_MAX = 10;
const GRADE_VERDICT_VALUES = ["SUBMIT", "HOLD", "SKIP"];
const GRADE_HOLD_MIN_SCORE = 20;
const GRADE_SUBMIT_MIN_SCORE = 40;
const CHAIN_ATTEMPT_OUTCOME_VALUES = ["confirmed", "denied", "blocked", "inconclusive", "not_applicable"];
const CHAIN_ATTEMPT_TERMINAL_OUTCOME_VALUES = ["confirmed", "denied", "blocked", "not_applicable"];

const COVERAGE_STATUS_VALUES = ["tested", "blocked", "promising", "needs_auth", "requeue"];
const COVERAGE_UNFINISHED_STATUS_VALUES = ["promising", "needs_auth", "requeue"];
const COVERAGE_SUMMARY_MAX_ITEMS = 40;
const COVERAGE_LOG_MAX_RECORDS = 5_000;
const TECHNIQUE_ATTEMPT_STATUS_VALUES = ["selected", "attempted", "not_applicable", "promising", "validated", "failed", "skipped"];
const TECHNIQUE_ATTEMPT_LOG_MAX_RECORDS = 5_000;
const TECHNIQUE_PACK_READ_LOG_MAX_RECORDS = 5_000;
const HTTP_AUDIT_SUMMARY_MAX_ITEMS = 40;
const HTTP_AUDIT_LOG_MAX_RECORDS = 5_000;
const TRAFFIC_SUMMARY_MAX_ITEMS = 40;
const TRAFFIC_IMPORT_MAX_ENTRIES = 500;
const TRAFFIC_LOG_MAX_RECORDS = 5_000;
const PUBLIC_INTEL_MAX_ITEMS = 10;
const PUBLIC_INTEL_MAX_RESPONSE_BYTES = 300_000;
const STATIC_ARTIFACT_ID_RE = /^SA-([1-9]\d*)$/;
const STATIC_ARTIFACT_TYPE_VALUES = ["evm_token_contract", "solana_token_contract"];
const STATIC_ARTIFACT_MAX_CHARS = 200_000;
const STATIC_ARTIFACT_LOG_MAX_RECORDS = 500;
const STATIC_SCAN_RESULTS_MAX_RECORDS = 1_000;
const STATIC_SCAN_FINDING_MAX_ITEMS = 100;
const STATIC_SCAN_HINT_MAX_ITEMS = 10;
const CIRCUIT_BREAKER_THRESHOLD = 3;

const SESSION_LOCK_NAME = ".session.lock";
const SESSION_LOCK_STALE_MS = 300_000;
const SESSION_PUBLIC_STATE_FIELDS = [
  "target",
  "target_url",
  "deep_mode",
  "checkpoint_mode",
  "block_internal_hosts",
  "block_internal_hosts_source",
  "phase",
  "hunt_wave",
  "pending_wave",
  "total_findings",
  "explored",
  "terminally_blocked",
  "prereq_registry_snapshots",
  "blocked_prereq_history",
  "terminal_block_clear_history",
  "dead_ends",
  "waf_blocked_endpoints",
  "lead_surface_ids",
  "scope_exclusions",
  "hold_count",
  "auth_status",
  "egress_profile",
  "egress_region",
  "proxy_configured",
  "egress_profile_identity_hash",
  "egress_profile_identity_version",
  "egress_profile_identity_source",
  "egress_profile_identity_bound_at",
  "egress_profile_identity_bind_source",
  "egress_profile_legacy_migration",
  "operator_note",
  "verification_schema_version",
  "verification_attempt_id",
  "verification_snapshot_hash",
  "verification_entered_at",
];

const VERIFICATION_ROUND_FILE_MAP = {
  brutalist: { json: "brutalist.json", markdown: "brutalist.md" },
  balanced: { json: "balanced.json", markdown: "balanced.md" },
  final: { json: "verified-final.json", markdown: "verified-final.md" },
};

module.exports = {
  AGENT_ID_RE,
  APTOS_NETWORK_VALUES,
  AUTH_STATUS_VALUES,
  CHAIN_ATTEMPT_OUTCOME_VALUES,
  CHAIN_ATTEMPT_TERMINAL_OUTCOME_VALUES,
  CHECKPOINT_MODE_VALUES,
  CHAIN_FAMILY_VALUES,
  CIRCUIT_BREAKER_THRESHOLD,
  COSMWASM_NETWORK_VALUES,
  COVERAGE_LOG_MAX_RECORDS,
  COVERAGE_STATUS_VALUES,
  COVERAGE_SUMMARY_MAX_ITEMS,
  COVERAGE_UNFINISHED_STATUS_VALUES,
  FINDING_ID_RE,
  GRADE_HOLD_MIN_SCORE,
  GRADE_SUBMIT_MIN_SCORE,
  GRADE_VERDICT_VALUES,
  HTTP_AUDIT_LOG_MAX_RECORDS,
  HTTP_AUDIT_SUMMARY_MAX_ITEMS,
  MOBILE_ARTIFACT_ID_RE,
  MOBILE_ARTIFACT_LOG_MAX_RECORDS,
  MOBILE_ARTIFACT_MAX_BYTES,
  MOBILE_ARTIFACT_TYPE_VALUES,
  MOBILE_BACKEND_LEAD_MAX_ITEMS,
  MOBILE_COVERAGE_MODE_VALUES,
  MOBILE_DEVICE_ACTION_VALUES,
  MOBILE_DEVICE_LEASE_ID_RE,
  MOBILE_DEVICE_PROFILE_ID_RE,
  MOBILE_DEVICE_PROFILE_KIND_VALUES,
  MOBILE_EVIDENCE_REPRODUCTION_LIMIT_VALUES,
  MOBILE_EVIDENCE_RISK_CLASS_VALUES,
  MOBILE_EVIDENCE_TYPE_VALUES,
  MOBILE_PLATFORM_VALUES,
  MOBILE_STATIC_SCAN_HINT_MAX_ITEMS,
  MOBILE_STATIC_SCAN_RESULTS_MAX_RECORDS,
  PHASE_VALUES,
  PUBLIC_INTEL_MAX_ITEMS,
  PUBLIC_INTEL_MAX_RESPONSE_BYTES,
  SESSION_LOCK_NAME,
  SESSION_LOCK_STALE_MS,
  SESSION_PUBLIC_STATE_FIELDS,
  SEVERITY_VALUES,
  STATIC_ARTIFACT_ID_RE,
  STATIC_ARTIFACT_LOG_MAX_RECORDS,
  STATIC_ARTIFACT_MAX_CHARS,
  STATIC_ARTIFACT_TYPE_VALUES,
  STATIC_SCAN_FINDING_MAX_ITEMS,
  STATIC_SCAN_HINT_MAX_ITEMS,
  STATIC_SCAN_RESULTS_MAX_RECORDS,
  TECHNIQUE_ATTEMPT_LOG_MAX_RECORDS,
  TECHNIQUE_ATTEMPT_STATUS_VALUES,
  TECHNIQUE_PACK_READ_LOG_MAX_RECORDS,
  SUBSTRATE_NETWORK_VALUES,
  SUI_NETWORK_VALUES,
  SURFACE_TYPE_VALUES,
  SVM_CLUSTER_VALUES,
  TRAFFIC_IMPORT_MAX_ENTRIES,
  TRAFFIC_LOG_MAX_RECORDS,
  TRAFFIC_SUMMARY_MAX_ITEMS,
  VERIFICATION_DISPOSITION_VALUES,
  VERIFICATION_CONFIDENCE_REASON_VALUES,
  VERIFICATION_CONFIDENCE_VALUES,
  VERIFICATION_REPLAY_PURPOSE_VALUES,
  VERIFICATION_ROUND_FILE_MAP,
  VERIFICATION_ROUND_VALUES,
  VERIFY_QA_SAMPLE_MAX,
  VERIFY_SMALL_REPORTABLE_THRESHOLD,
  WAVE_ID_RE,
};
