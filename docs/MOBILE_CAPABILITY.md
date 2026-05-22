# Mobile Capability

Bob treats mobile targets as first-class bounty surfaces. Android and iOS apps are routed through mobile capability packs instead of web hunters, and mobile-derived backend endpoints are promoted as bounded web/API leads only after scope checks.

## Surface Metadata

Use `surface_type: "mobile_app"` for installable app targets. The surface must include `platform: "android"` or `platform: "ios"` so routing can select `mobile_android` or `mobile_ios`. Missing or unsupported platform metadata fails closed.

Mobile API hosts remain ordinary web/API surfaces. Do not route a backend host through a mobile pack just because it was discovered from an app artifact.

## Device Authority

Physical devices, emulators, and simulators are represented by device profiles. Profiles store platform, kind, labels, capability flags, and hashed device identity; raw serials and UDIDs are not stored.

Any tool that talks to a device must declare `device_access`, require an eligible profile, and hold a session-scoped lease before use. Instrumentation, proxy certificate installation, pinning bypass, keychain/container reads, local storage extraction, and trace capture are opt-in capabilities. If a required capability is unavailable or unauthorized, the mobile handoff must use a blocked prerequisite rather than pretending dynamic coverage ran.

## Artifacts And Evidence

`bounty_import_mobile_artifact` stores mobile binaries under the session artifact store and records only metadata in JSONL. The raw artifact is capped, hashed, and never embedded in prompts, reports, or packages.

Android static MVP support uses `bounty_android_static_scan` to extract package hints, permissions, deeplinks, exported-component clues, cleartext markers, and candidate endpoints from imported artifacts. Static scans can produce hints and backend leads. App-local findings need structured `mobile_evidence` with platform, artifact id, artifact hash, evidence type, and reproduction limit.

Mobile handoffs require `coverage_mode`:

- `static_only`: static analysis ran, no dynamic replay is claimed.
- `dynamic_confirmed`: dynamic replay or device execution confirmed at least one finding.
- `lead_only`: only backend/surface leads were produced.
- `blocked`: required mobile prerequisites were unavailable.

## Backend Leads

Endpoints found in manifests, strings, static scans, traces, or logs must pass the backend lead quality gate before they enter web/API hunting. The gate dedupes, budgets, redacts, and allowlists by target domain. Out-of-scope hosts stay in local scan context and must not become promoted bounty leads.

## Release Boundary

Release packages must not contain APK/AAB/XAPK/IPA/app bundles, pcaps, SQLite/db dumps, screenshots, raw device logs, app containers, trace directories, or mobile session JSONL stores. Package policy and release checks deny those paths even if they exist in a source tree.
