const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  classifySurfaceCapability,
} = require("../mcp/lib/capability-packs.js");
const {
  initSession,
  transitionPhase,
} = require("../mcp/lib/session-state.js");
const {
  importMobileArtifact,
  androidStaticScan,
} = require("../mcp/lib/mobile-artifacts.js");
const {
  acquireMobileDeviceLease,
  listMobileDeviceProfiles,
  registerMobileDeviceProfile,
  releaseMobileDeviceLease,
} = require("../mcp/lib/mobile-device-profiles.js");
const {
  recordFinding,
} = require("../mcp/lib/finding-store.js");
const {
  startWave,
  writeWaveHandoff,
} = require("../mcp/lib/waves.js");
const {
  attackSurfacePath,
  mobileArtifactPath,
} = require("../mcp/lib/paths.js");
const {
  writeFileAtomic,
} = require("../mcp/lib/storage.js");

function withTempHome(fn) {
  const previousHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bob-mobile-contracts-"));
  process.env.HOME = tempHome;
  try {
    return fn(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

function initMobileSession(domain = "mobile.example.com") {
  JSON.parse(initSession({
    target_domain: domain,
    target_url: `https://${domain}`,
  }));
  return domain;
}

function writeAttackSurface(domain, surfaces) {
  writeFileAtomic(attackSurfacePath(domain), `${JSON.stringify({ domain, surfaces }, null, 2)}\n`);
}

test("mobile_app surfaces route to mobile packs and fail closed on invalid platform", () => {
  const android = classifySurfaceCapability({
    id: "m1",
    surface_type: "mobile_app",
    platform: "android",
  });
  assert.equal(android.capability_pack, "mobile_android");
  assert.equal(android.hunter_agent, "hunter-android-agent");
  assert.equal(android.brief_profile, "mobile_android");

  const ios = classifySurfaceCapability({
    id: "m2",
    surface_type: "mobile_app",
    platform: "ios",
  });
  assert.equal(ios.capability_pack, "mobile_ios");

  const mobileApi = classifySurfaceCapability({
    id: "api1",
    surface_type: "mobile_api",
  });
  assert.equal(mobileApi.capability_pack, "web");

  assert.throws(
    () => classifySurfaceCapability({ id: "bad", surface_type: "mobile_app" }),
    /missing platform/,
  );
  assert.throws(
    () => classifySurfaceCapability({ id: "bad", surface_type: "mobile_app", platform: "blackberry" }),
    /unsupported platform blackberry/,
  );
});

test("Android static MVP stores capped artifacts and emits qualified backend leads", () => withTempHome(() => {
  const domain = initMobileSession("mobile-static.example.com");
  const manifest = `
<manifest package="com.example.mobile">
  <uses-permission android:name="android.permission.CAMERA"/>
  <application android:usesCleartextTraffic="true">
    <activity android:name=".DeepLinkActivity" android:exported="true">
      <intent-filter>
        <data android:scheme="example" android:host="open"/>
      </intent-filter>
    </activity>
  </application>
  https://api.mobile-static.example.com/v1/users?token=raw-secret
  https://evil.example.net/out-of-scope
</manifest>
`;
  const imported = JSON.parse(importMobileArtifact({
    target_domain: domain,
    artifact_type: "android_apk",
    content_base64: Buffer.from(manifest, "utf8").toString("base64"),
    surface_id: "android-app",
    app_id: "com.example.mobile",
  }));
  assert.equal(imported.mobile_artifact_id, "MA-1");
  assert.equal(imported.platform, "android");
  assert.ok(fs.existsSync(mobileArtifactPath(domain, imported.mobile_artifact_id)));

  const scan = JSON.parse(androidStaticScan({
    target_domain: domain,
    mobile_artifact_id: imported.mobile_artifact_id,
  }));
  assert.equal(scan.package_name, "com.example.mobile");
  assert.equal(scan.cleartext_traffic_enabled, true);
  assert.ok(scan.permissions.includes("android.permission.CAMERA"));
  assert.equal(scan.backend_leads.length, 1);
  assert.deepEqual(scan.backend_leads[0].hosts, ["api.mobile-static.example.com"]);
  assert.doesNotMatch(JSON.stringify(scan.backend_leads), /evil\.example\.net/);
  assert.doesNotMatch(JSON.stringify(scan), /raw-secret/);
}));

test("mobile device profiles hash identifiers and leases prevent concurrent device use", () => withTempHome(() => {
  const domain = initMobileSession("mobile-device.example.com");
  const registered = JSON.parse(registerMobileDeviceProfile({
    target_domain: domain,
    profile_kind: "android_emulator",
    label: "Pixel API 35",
    device_identifier_hint: "emulator-5554",
    authorized_actions: ["install_launch", "deeplink_probe"],
  }));
  assert.equal(registered.profile.profile_id, "MDP-1");
  assert.equal(registered.profile.platform, "android");
  assert.doesNotMatch(JSON.stringify(registered), /emulator-5554/);

  const acquired = JSON.parse(acquireMobileDeviceLease({
    target_domain: domain,
    profile_id: "MDP-1",
    purpose: "android static-to-dynamic replay",
  }));
  assert.equal(acquired.lease.lease_id, "MDL-1");
  assert.throws(
    () => acquireMobileDeviceLease({ target_domain: domain, profile_id: "MDP-1", purpose: "competing run" }),
    /already has active lease MDL-1/,
  );
  const listed = JSON.parse(listMobileDeviceProfiles({ target_domain: domain }));
  assert.equal(listed.profiles[0].active_lease.lease_id, "MDL-1");
  const released = JSON.parse(releaseMobileDeviceLease({ target_domain: domain, lease_id: "MDL-1" }));
  assert.equal(released.released, true);
  const reacquired = JSON.parse(acquireMobileDeviceLease({
    target_domain: domain,
    profile_id: "MDP-1",
    purpose: "after release",
  }));
  assert.equal(reacquired.lease.lease_id, "MDL-2");
}));

test("mobile findings require mobile_evidence and mobile handoffs require honest coverage_mode", () => withTempHome(() => {
  const domain = initMobileSession("mobile-wave.example.com");
  writeAttackSurface(domain, [{
    id: "android-app",
    surface_type: "mobile_app",
    platform: "android",
    package_name: "com.example.mobile",
  }]);
  JSON.parse(transitionPhase({ target_domain: domain, to_phase: "AUTH" }));
  JSON.parse(transitionPhase({ target_domain: domain, to_phase: "HUNT", auth_status: "authenticated" }));
  const imported = JSON.parse(importMobileArtifact({
    target_domain: domain,
    artifact_type: "android_apk",
    content_base64: Buffer.from("<manifest package=\"com.example.mobile\"/>", "utf8").toString("base64"),
    surface_id: "android-app",
    app_id: "com.example.mobile",
  }));
  const started = JSON.parse(startWave({
    target_domain: domain,
    wave_number: 1,
    assignments: [{ agent: "a1", surface_id: "android-app" }],
  }));
  const token = started.assignments[0].handoff_token;

  assert.throws(
    () => recordFinding({
      target_domain: domain,
      title: "Exported activity bypass",
      severity: "medium",
      endpoint: "app://com.example.mobile/.DeepLinkActivity",
      description: "Exported activity appears reachable.",
      proof_of_concept: "Static manifest review identifies exported activity.",
      validated: true,
      wave: "w1",
      agent: "a1",
      surface_id: "android-app",
    }),
    /mobile_app findings must include mobile_evidence/,
  );

  const recorded = JSON.parse(recordFinding({
    target_domain: domain,
    title: "Exported activity bypass",
    severity: "medium",
    endpoint: "app://com.example.mobile/.DeepLinkActivity",
    description: "Exported activity appears reachable.",
    proof_of_concept: "Static manifest review identifies exported activity.",
    response_evidence: "mobile_evidence records the static artifact hash and component.",
    validated: true,
    wave: "w1",
    agent: "a1",
    surface_id: "android-app",
    mobile_evidence: {
      platform: "android",
      evidence_type: "static_analysis",
      mobile_artifact_id: imported.mobile_artifact_id,
      artifact_sha256: imported.content_sha256,
      app_id: "com.example.mobile",
      analyzer_version: "android_static_mvp_v1",
      component: ".DeepLinkActivity",
      risk_class: "exported_component",
      reproduction_limit: "static_only",
    },
  }));
  assert.equal(recorded.recorded, true);

  assert.throws(
    () => writeWaveHandoff({
      target_domain: domain,
      wave: "w1",
      agent: "a1",
      surface_id: "android-app",
      surface_status: "complete",
      handoff_token: token,
      summary: "Completed Android static review.",
      content: "handoff",
    }),
    /coverage_mode is required/,
  );

  const handoff = JSON.parse(writeWaveHandoff({
    target_domain: domain,
    wave: "w1",
    agent: "a1",
    surface_id: "android-app",
    surface_status: "complete",
    coverage_mode: "static_only",
    handoff_token: token,
    summary: "Completed Android static review.",
    content: "handoff",
  }));
  assert.equal(handoff.provenance, "verified");
}));
