# App Store Readiness Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic "App Store submission readiness" checklist for AI-built mobile apps, following the exact `code-health` focus-vertical pattern already shipped for the sibling pre-launch/pre-scale hardening checks (#2622/#2624/#2625), and wire it into `/claude-tweaks:review` as a component-skill pass.

**Architecture:** A new `focus=app-store-readiness` candidate generator (`plugin/bin/lib/code-health/candidates-app-store-readiness.js`) scans a repo's tracked files for ten Apple-review failure patterns (Stripe-instead-of-IAP, missing Apple sign-in parity, missing account deletion, incomplete demo login, unverified iPad layout, unlabeled paid screenshots, dead support/privacy links, "coming soon" placeholders, UGC with no report path, broken restore-purchases) and emits `{file, kind, evidence}` candidates, gated behind a `notApplicable` check so a non-mobile repo produces no noise. A new criteria fragment (`plugin/skills/_shared/criteria-app-store-readiness.md`) defines what to flag/not flag, severity, scope boundary against #2622/#2624/#2625, and ten copy-paste prompts. The generator registers in `focus-generators.js`, the criterion registers in `criteria.js`, and both get a row in `code-health/focus-mode.md`. `/claude-tweaks:review`'s Code-Mode Procedure gains a new numbered step (following the Step 6.6/6.65 precedent) that reuses this generator+criterion directly, diff-scoped, without running code-health's own GATHER/FILE machinery.

**Tech Stack:** Node.js (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-02T144646-record-2628/work/2628-spec.md` (GitHub issue #2628).

## Global Constraints

- No network calls — every check is static text/config analysis, matching every existing `code-health` generator.
- JS/TS-and-config files only; discovery via `listTrackedFiles` (extension-agnostic, git-tracked + untracked-unignored), matching `candidates-prelaunch.js`'s precedent for a vertical that needs non-source files (`app.json`, `Info.plist`).
- Each candidate is `{ file, kind, evidence }` — the established shape every `FOCUS_GENERATORS` entry returns.
- The generator must state `notApplicable: true` (never a silent empty pass) when the repo shows no mobile-app signal, mirroring `agent-trust-scope`'s and `prelaunch`'s `notApplicable` convention (IL-115: absence of applicability is not the same as a clean pass).
- Scope boundary: this vertical owns exactly the ten named checks. It never claims #2622's pre-scale/performance checks, #2624's security-hardening checks (secrets, ownership, AI-endpoint guards), or #2625's GDPR/backup-retention check.

## Review Focus

1. **A repo with no mobile-app signal at all** (a pure backend repo, or this very claude-tweaks repo) must return `notApplicable: true`, not ten false "missing X" candidates from scanning files that were never meant to be a mobile app.
2. **A clean mobile-app fixture with all ten protections present** must produce zero candidates — false positives here would make every future consumer learn to ignore the check.
3. **A fixture missing exactly one of the ten gaps** must flag that one kind and only that one kind, not cross-contaminate into an unrelated kind.
4. **Each of the ten `kind` values must be independently triggerable** — a fixture naming all ten gaps (AC1) must produce all ten distinct kinds, not just a subset, since the record's AC1 requires exactly this.
5. **A placeholder support/privacy URL embedded inside an otherwise normal config value** (e.g. `supportUrl: "https://example.com"`) must be caught by the dead-link check without also tripping the "missing account deletion" or other unrelated checks on the same file.

---

### Task 1: App Store Readiness candidate generator

**Files:**
- Create: `plugin/bin/lib/code-health/candidates-app-store-readiness.js`
- Modify: `plugin/bin/lib/code-health/focus-generators.js` (add one require line)
- Modify: `plugin/bin/lib/code-health/criteria.js` (add one `CRITERIA` entry)
- Test: `tests/bin-lib/code-health/candidates-app-store-readiness.test.js`

**Interfaces:**
- Consumes: `listTrackedFiles(rootDir)` from `./candidates-dead-code` (extension-agnostic tracked-file discovery — `{ files, discoveryFailed, reason? }`), `registerGenerator(name, fn)` from `./focus-generators`.
- Produces: `scanAppStoreReadiness(rootDir)` → `{ candidates: [{file, kind, evidence}], scannedFiles, skippedFiles, discoveryFailed, discoveryReason?, notApplicable? }`; `candidatesAppStoreReadiness(rootDir)` → bare array (mirrors every sibling vertical's two-function shape). Registered under `'app-store-readiness'` in `FOCUS_GENERATORS`. Registered as `{ id: 'app-store-readiness', appliesTo: ['frontend'], fragment: 'criteria-app-store-readiness.md', confidenceFloor: 'medium' }` in `CRITERIA` (Task 2 writes the fragment file this points to; the registration can land now since `criteria.js` only stores the filename string, never reads the file).

- [ ] **Step 1: Write the failing test file**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-appstore-'));
}

function tmpGitRepo() {
  const root = tmp();
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function writeMobileMarker(root) {
  write(root, 'package.json', JSON.stringify({ name: 'demo-app', dependencies: { expo: '^49.0.0' } }, null, 2));
}

const {
  scanAppStoreReadiness,
  candidatesAppStoreReadiness,
  detectMobileProject,
  scanAppleSigninParity,
  scanExternalPaymentNoIap,
  scanMissingAccountDeletion,
  scanIncompleteDemoLogin,
  scanUnverifiedIpadLayout,
  scanUnlabeledPaidScreenshot,
  scanDeadSupportPrivacyLink,
  scanComingSoonPlaceholder,
  scanMissingUgcReportPath,
  scanBrokenRestorePurchases,
} = require('../../../plugin/bin/lib/code-health/candidates-app-store-readiness');

// ── notApplicable gate ──────────────────────────────────────────────────────

test('scanAppStoreReadiness: notApplicable on a repo with no mobile-app signal', () => {
  const root = tmpGitRepo();
  write(root, 'server/index.js', 'console.log("backend only");');
  const result = scanAppStoreReadiness(root);
  assert.strictEqual(result.discoveryFailed, false);
  assert.strictEqual(result.notApplicable, true);
  assert.deepStrictEqual(result.candidates, []);
});

test('scanAppStoreReadiness: discoveryFailed on a non-git root, never a clean-empty result', () => {
  const root = tmp();
  const result = scanAppStoreReadiness(root);
  assert.strictEqual(result.discoveryFailed, true);
  assert.strictEqual(result.candidates.length, 0);
  assert.ok(result.discoveryReason);
});

// ── AC1: a fixture carrying all ten violation patterns flags all ten kinds ──

test('AC1: a vibecoded mobile-app fixture with all ten gaps flags all ten distinct kinds', () => {
  const root = tmpGitRepo();
  writeMobileMarker(root);

  write(root, 'src/auth/GoogleButton.js', "import { GoogleSignin } from '@react-native-google-signin/google-signin';\nexport function signIn() { return GoogleSignin.signIn(); }\n");
  write(root, 'src/payments/Checkout.js', "export async function pay() { return stripe.redirectToCheckout({ sessionId: 's1' }); }\n");
  write(root, 'src/screens/LoginScreen.js', "export function LoginScreen() { return null; }\n");
  write(root, 'app.json', JSON.stringify({ expo: { ios: { supportsTablet: true } } }, null, 2));
  write(root, 'fastlane/metadata/en-US/screenshot1.txt', 'Unlock extra features with a subscription today!');
  write(root, 'src/config/links.js', "export const supportUrl = 'https://example.com';\n");
  write(root, 'src/screens/LeaderboardScreen.js', "export function Leaderboard() { return 'Coming soon!'; }\n");
  write(root, 'src/screens/CommentsScreen.js', "export function postComment(text) { return api.addComment(text); }\n");
  write(root, 'src/screens/RestoreButton.js', "export function RestoreButton() { return <Button title=\"Restore Purchases\" onPress={() => {}} />; }\n");

  const result = scanAppStoreReadiness(root);
  assert.strictEqual(result.discoveryFailed, false);
  assert.strictEqual(result.notApplicable, undefined);

  const kinds = new Set(result.candidates.map((c) => c.kind));
  const expectedKinds = [
    'missing-apple-signin-parity',
    'external-payment-no-iap',
    'missing-account-deletion',
    'incomplete-demo-login',
    'unverified-ipad-layout',
    'unlabeled-paid-screenshot',
    'dead-support-privacy-link',
    'coming-soon-placeholder',
    'missing-ugc-report-path',
    'broken-restore-purchases',
  ];
  for (const k of expectedKinds) {
    assert.ok(kinds.has(k), `expected kind ${k} to be flagged, got: ${[...kinds].join(', ')}`);
  }
  assert.strictEqual(kinds.size, expectedKinds.length);
});

// ── AC2: a clean fixture with every protection in place produces zero findings ──

test('AC2: a clean mobile-app fixture with all ten protections produces zero findings', () => {
  const root = tmpGitRepo();
  writeMobileMarker(root);

  write(root, 'src/auth/GoogleButton.js', "import { GoogleSignin } from '@react-native-google-signin/google-signin';\nexport function signIn() { return GoogleSignin.signIn(); }\n");
  write(root, 'src/auth/AppleButton.js', "import { AppleAuthentication } from 'expo-apple-authentication';\nexport function signInApple() { return AppleAuthentication.signInAsync(); }\n");
  write(root, 'src/payments/Purchases.js', "import RevenueCat from 'react-native-purchases';\nexport async function pay() { return RevenueCat.purchasePackage(pkg); }\n");
  write(root, 'src/api/account.js', "export async function deleteAccount(id) { return db.destroyAccount(id); }\n");
  write(root, 'src/screens/LoginScreen.js', "export function LoginScreen() { return null; } // reviewer@example.com / DEMO_ACCOUNT\n");
  write(root, 'app.json', JSON.stringify({ expo: { ios: { supportsTablet: true } } }, null, 2));
  write(root, 'src/layout/Responsive.js', "export function useLayout() { return DeviceInfo.isTablet() ? 'tablet' : 'phone'; }\n");
  write(root, 'fastlane/metadata/en-US/screenshot1.txt', 'Unlock Premium features with a subscription today!');
  write(root, 'src/config/links.js', "export const supportUrl = 'https://realcompany.example-is-not-a-placeholder.io/support';\n");
  write(root, 'src/screens/LeaderboardScreen.js', "export function Leaderboard() { return 'Top scores this week'; }\n");
  write(root, 'src/screens/CommentsScreen.js', "export function postComment(text) { return api.addComment(text); } export function reportComment(id) { return api.flagContent(id); }\n");
  write(root, 'src/screens/RestoreButton.js', "import { restorePurchases } from 'react-native-purchases';\nexport function RestoreButton() { return <Button title=\"Restore Purchases\" onPress={restorePurchases} />; }\n");

  const result = scanAppStoreReadiness(root);
  assert.strictEqual(result.discoveryFailed, false);
  assert.strictEqual(result.notApplicable, undefined);
  assert.deepStrictEqual(result.candidates, []);
});

// ── Per-check unit coverage ──────────────────────────────────────────────────

test('scanAppleSigninParity: flags when Google sign-in present with no Apple sign-in anywhere', () => {
  const candidates = [];
  scanAppleSigninParity([{ rel: 'a.js', text: 'GoogleSignin.signIn()' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'missing-apple-signin-parity');
});

test('scanAppleSigninParity: does not flag when both are present', () => {
  const candidates = [];
  scanAppleSigninParity([{ rel: 'a.js', text: 'GoogleSignin.signIn(); AppleAuthentication.signInAsync();' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanAppleSigninParity: does not flag when neither is present (not every app needs social login)', () => {
  const candidates = [];
  scanAppleSigninParity([{ rel: 'a.js', text: 'export function noop() {}' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanExternalPaymentNoIap: flags Stripe checkout with no IAP SDK anywhere', () => {
  const candidates = [];
  scanExternalPaymentNoIap([{ rel: 'a.js', text: 'stripe.redirectToCheckout({})' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'external-payment-no-iap');
});

test('scanExternalPaymentNoIap: does not flag when an IAP SDK is also present', () => {
  const candidates = [];
  scanExternalPaymentNoIap([{ rel: 'a.js', text: 'stripe.redirectToCheckout({}); RevenueCat.purchasePackage(p);' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanMissingAccountDeletion: flags when no deletion signal found anywhere', () => {
  const candidates = [];
  scanMissingAccountDeletion([{ rel: 'a.js', text: 'export function noop() {}' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'missing-account-deletion');
});

test('scanMissingAccountDeletion: does not flag when a deletion signal exists', () => {
  const candidates = [];
  scanMissingAccountDeletion([{ rel: 'a.js', text: 'function deleteAccount(id) {}' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanIncompleteDemoLogin: flags a login screen with no demo credential reference', () => {
  const candidates = [];
  scanIncompleteDemoLogin([{ rel: 'LoginScreen.js', text: 'function LoginScreen() {}' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'incomplete-demo-login');
});

test('scanIncompleteDemoLogin: does not flag when a demo credential reference exists', () => {
  const candidates = [];
  scanIncompleteDemoLogin([{ rel: 'LoginScreen.js', text: 'function LoginScreen() {} // reviewer@example.com' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanIncompleteDemoLogin: does not flag an app with no login screen at all', () => {
  const candidates = [];
  scanIncompleteDemoLogin([{ rel: 'a.js', text: 'export function noop() {}' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnverifiedIpadLayout: flags supportsTablet:true with no tablet layout code', () => {
  const candidates = [];
  scanUnverifiedIpadLayout([{ rel: 'app.json', text: '{"expo":{"ios":{"supportsTablet":true}}}' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'unverified-ipad-layout');
});

test('scanUnverifiedIpadLayout: does not flag when tablet layout code is present', () => {
  const candidates = [];
  scanUnverifiedIpadLayout([
    { rel: 'app.json', text: '{"expo":{"ios":{"supportsTablet":true}}}' },
    { rel: 'a.js', text: 'DeviceInfo.isTablet()' },
  ], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnverifiedIpadLayout: does not flag when iPad support is not declared at all', () => {
  const candidates = [];
  scanUnverifiedIpadLayout([{ rel: 'app.json', text: '{"expo":{}}' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnlabeledPaidScreenshot: flags a screenshot caption mentioning a paid feature with no Pro/Premium label on the same line', () => {
  const candidates = [];
  scanUnlabeledPaidScreenshot([{ rel: 'fastlane/metadata/en-US/screenshot1.txt', text: 'Unlock extra features with a subscription today!' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'unlabeled-paid-screenshot');
});

test('scanUnlabeledPaidScreenshot: does not flag when the label is on the same line', () => {
  const candidates = [];
  scanUnlabeledPaidScreenshot([{ rel: 'fastlane/metadata/en-US/screenshot1.txt', text: 'Unlock Premium features with a subscription today!' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnlabeledPaidScreenshot: does not scan a file outside screenshot/metadata directories', () => {
  const candidates = [];
  scanUnlabeledPaidScreenshot([{ rel: 'src/copy.js', text: 'Unlock extra features with a subscription today!' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanDeadSupportPrivacyLink: flags a placeholder support URL', () => {
  const candidates = [];
  scanDeadSupportPrivacyLink([{ rel: 'a.js', text: "export const supportUrl = 'https://example.com';" }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'dead-support-privacy-link');
});

test('scanDeadSupportPrivacyLink: does not flag a real-looking URL', () => {
  const candidates = [];
  scanDeadSupportPrivacyLink([{ rel: 'a.js', text: "export const supportUrl = 'https://realcompany.io/support';" }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanComingSoonPlaceholder: flags a literal "coming soon" string', () => {
  const candidates = [];
  scanComingSoonPlaceholder([{ rel: 'src/screens/Leaderboard.js', text: "return 'Coming soon!';" }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'coming-soon-placeholder');
});

test('scanComingSoonPlaceholder: does not flag ordinary copy', () => {
  const candidates = [];
  scanComingSoonPlaceholder([{ rel: 'src/screens/Leaderboard.js', text: "return 'Top scores this week';" }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanMissingUgcReportPath: flags a comment feature with no report signal nearby', () => {
  const candidates = [];
  // Only one COMMENT_FEATURE_RE trigger word (postComment) on purpose — a
  // second trigger word (e.g. addComment) in the same short string would
  // produce a second independent match/candidate, which this test does not
  // want to also have to account for.
  scanMissingUgcReportPath([{ rel: 'a.js', text: 'function postComment(text) { return api.save(text); }' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'missing-ugc-report-path');
});

test('scanMissingUgcReportPath: does not flag when a report signal is nearby', () => {
  const candidates = [];
  scanMissingUgcReportPath([{ rel: 'a.js', text: 'function postComment(text) { api.addComment(text); } function reportComment(id) { api.flagContent(id); }' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanBrokenRestorePurchases: flags a restore-purchases button with no restore API call anywhere', () => {
  const candidates = [];
  scanBrokenRestorePurchases([{ rel: 'a.js', text: '<Button title="Restore Purchases" onPress={() => {}} />' }], candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'broken-restore-purchases');
});

test('scanBrokenRestorePurchases: does not flag when a restore API call exists', () => {
  const candidates = [];
  scanBrokenRestorePurchases([{ rel: 'a.js', text: '<Button title="Restore Purchases" onPress={restorePurchases} />' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanBrokenRestorePurchases: does not flag an app with no restore-purchases button at all', () => {
  const candidates = [];
  scanBrokenRestorePurchases([{ rel: 'a.js', text: 'export function noop() {}' }], candidates);
  assert.strictEqual(candidates.length, 0);
});

test('detectMobileProject: true for an Expo app.json', () => {
  assert.strictEqual(detectMobileProject([{ rel: 'app.json', text: '{}' }]), true);
});

test('detectMobileProject: true for a package.json declaring react-native', () => {
  assert.strictEqual(detectMobileProject([{ rel: 'package.json', text: JSON.stringify({ dependencies: { 'react-native': '0.73.0' } }) }]), true);
});

test('detectMobileProject: false for a plain backend repo', () => {
  assert.strictEqual(detectMobileProject([{ rel: 'server/index.js', text: 'console.log(1)' }]), false);
});

test('candidatesAppStoreReadiness: bare-array direct entry point mirrors scanAppStoreReadiness().candidates', () => {
  const root = tmpGitRepo();
  writeMobileMarker(root);
  write(root, 'a.js', 'GoogleSignin.signIn()');
  const arr = candidatesAppStoreReadiness(root);
  assert.ok(Array.isArray(arr));
  assert.ok(arr.some((c) => c.kind === 'missing-apple-signin-parity'));
});

// ── Registry wiring ──────────────────────────────────────────────────────────

test('registry: app-store-readiness is registered in FOCUS_GENERATORS', () => {
  const { FOCUS_GENERATORS } = require('../../../plugin/bin/lib/code-health/focus-generators');
  assert.strictEqual(typeof FOCUS_GENERATORS['app-store-readiness'], 'function');
});

test('criteria: app-store-readiness criterion is registered with its fragment', () => {
  const { getCriterion } = require('../../../plugin/bin/lib/code-health/criteria');
  const c = getCriterion('app-store-readiness');
  assert.ok(c);
  assert.strictEqual(c.fragment, 'criteria-app-store-readiness.md');
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `node --test tests/bin-lib/code-health/candidates-app-store-readiness.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/code-health/candidates-app-store-readiness'`

- [ ] **Step 3: Implement the generator**

Create `plugin/bin/lib/code-health/candidates-app-store-readiness.js`:

```javascript
'use strict';

// candidates-app-store-readiness.js — deterministic Apple App Store
// submission-readiness candidate generator for code-health's
// `focus=app-store-readiness` scoping mode (see
// skills/code-health/focus-mode.md). Flags ten recurring Apple-review
// rejection patterns for AI-built/vibecoded mobile apps (#2628): Stripe
// checkout instead of in-app purchase, missing Apple sign-in parity with
// Google sign-in, no account-deletion path, an incomplete demo/reviewer
// login, a declared-but-unverified iPad layout, an unlabeled paid-feature
// screenshot, a dead support/privacy link, a "coming soon" placeholder
// screen, a comment/UGC feature with no report path, and a broken
// restore-purchases button. Candidates are INPUT to the judge
// (skills/code-health/SKILL.md Step 5) — this generator never concludes
// anything on its own, never fixes anything.
//
// Scope boundary vs. sibling records: this vertical owns exactly the ten
// checks above. #2622's pre-scale hardening (query/background-job/caching/
// pooling/monitoring), #2624's security-hardening (client secrets, missing
// ownership checks, unguarded AI endpoints), and #2625's GDPR/backup-
// retention check are all out of scope here. See
// `criteria-app-store-readiness.md` for the judging side of this boundary.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - Discovery is extension-agnostic (reuses candidates-dead-code.js's
//     listTrackedFiles — same git-ls-files discovery, same .gitignore
//     handling, same discoveryFailed/discoveryReason IL-115 distinction) —
//     unlike security-hardening's JS/TS-only listTrackedSourceFiles, this
//     vertical needs non-source files too (app.json, Info.plist, fastlane
//     screenshot metadata), mirroring candidates-prelaunch.js's precedent.
//   - `notApplicable: true` when the repo shows no mobile-app signal (no
//     app.json, no .xcodeproj/.xcworkspace, no android/app/build.gradle,
//     no react-native/expo dependency in package.json) — a repo that is not
//     a mobile app has nothing for any of the ten checks to find, and
//     scanning one anyway risks noise, not a clean bill of health.
//   - Every check is a whole-repo presence/absence signal (does SDK X
//     appear ANYWHERE vs. SDK Y appear ANYWHERE), not a per-call-site
//     analysis — appropriate for "does this app have Apple sign-in at
//     all," inappropriate for anything needing call-site precision; a
//     check whose signal appears in a comment, a test fixture, or dead
//     code still counts as present, the same false-negative risk every
//     text-pattern-only generator in this registry carries.
//   - SDK/API recognition is pattern-based (the *_RE constants below) —
//     covers common RN/Expo/native shapes; a bespoke or unlisted
//     SDK/pattern is invisible to the relevant check, same accepted-gap
//     class as security-hardening's AI_CALL_PATTERNS.
//   - `unlabeled-paid-screenshot` only scans files under a
//     `fastlane/metadata/` or `screenshots/` path — a project keeping
//     screenshot captions elsewhere is invisible to that one check.

const fs = require('fs');
const path = require('path');
const { listTrackedFiles } = require('./candidates-dead-code');
const { registerGenerator } = require('./focus-generators');

const WINDOW = 400; // chars, each direction, for co-occurrence checks

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function windowAround(text, index, matchLen) {
  const start = Math.max(0, index - WINDOW);
  const end = Math.min(text.length, index + matchLen + WINDOW);
  return text.slice(start, end);
}

// ── Mobile-project detection (the notApplicable gate) ───────────────────────

const MOBILE_PROJECT_FILE_RE = /(^|\/)(app\.json|android\/app\/build\.gradle)$/;
const XCODE_PROJECT_RE = /\.(xcodeproj|xcworkspace)(\/|$)/;

function detectMobileProject(fileTexts) {
  for (const { rel, text } of fileTexts) {
    if (MOBILE_PROJECT_FILE_RE.test(rel) || XCODE_PROJECT_RE.test(rel)) return true;
    if (rel === 'package.json') {
      try {
        const pkg = JSON.parse(text);
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        if (deps && (deps['react-native'] || deps['expo'])) return true;
      } catch {
        // malformed package.json contributes nothing to detection
      }
    }
  }
  return false;
}

// ── 1. Apple sign-in parity ──────────────────────────────────────────────────

const GOOGLE_SIGNIN_RE = /\b(GoogleSignin|GoogleSignIn|expo-auth-session\/providers\/google|@react-native-google-signin)\b/;
const APPLE_SIGNIN_RE = /\b(AppleAuthentication|expo-apple-authentication|SignInWithAppleButton|ASAuthorizationAppleIDProvider|react-native-apple-authentication)\b/;

function scanAppleSigninParity(fileTexts, candidates) {
  let googleHit = null;
  let appleHit = false;
  for (const { rel, text } of fileTexts) {
    if (!googleHit && GOOGLE_SIGNIN_RE.test(text)) googleHit = rel;
    if (APPLE_SIGNIN_RE.test(text)) appleHit = true;
  }
  if (googleHit && !appleHit) {
    candidates.push({
      file: googleHit,
      kind: 'missing-apple-signin-parity',
      evidence: `Google sign-in SDK referenced in ${googleHit}, no Apple sign-in SDK found anywhere in the repo`,
    });
  }
}

// ── 2. External payment instead of IAP ──────────────────────────────────────

const STRIPE_CHECKOUT_RE = /\b(redirectToCheckout|createCheckoutSession|stripe\.checkout\.sessions\.create|Checkout\.Session)\b/;
const IAP_RE = /\b(StoreKit|react-native-iap|RevenueCat|react-native-purchases|expo-in-app-purchases|SKPaymentQueue)\b/;

function scanExternalPaymentNoIap(fileTexts, candidates) {
  let stripeHit = null;
  let iapHit = false;
  for (const { rel, text } of fileTexts) {
    if (!stripeHit && STRIPE_CHECKOUT_RE.test(text)) stripeHit = rel;
    if (IAP_RE.test(text)) iapHit = true;
  }
  if (stripeHit && !iapHit) {
    candidates.push({
      file: stripeHit,
      kind: 'external-payment-no-iap',
      evidence: `Stripe Checkout call in ${stripeHit}, no StoreKit/RevenueCat/react-native-iap/expo-in-app-purchases import found anywhere in the repo`,
    });
  }
}

// ── 3. Missing account deletion ─────────────────────────────────────────────

const ACCOUNT_DELETION_RE = /\b(deleteAccount|delete_account|destroyAccount|removeAccount)\b/i;

function anchorFile(fileTexts) {
  const byPath = new Map(fileTexts.map((f) => [f.rel, f]));
  for (const name of ['app.json', 'package.json', 'app.config.js', 'app.config.ts']) {
    if (byPath.has(name)) return name;
  }
  const sorted = [...fileTexts].sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
  return sorted.length ? sorted[0].rel : null;
}

function scanMissingAccountDeletion(fileTexts, candidates) {
  for (const { text } of fileTexts) {
    if (ACCOUNT_DELETION_RE.test(text)) return;
  }
  const anchor = anchorFile(fileTexts);
  if (anchor) {
    candidates.push({
      file: anchor,
      kind: 'missing-account-deletion',
      evidence: 'no account-deletion signal (deleteAccount/destroyAccount/removeAccount) found anywhere in the repo',
    });
  }
}

// ── 4. Incomplete demo/reviewer login ───────────────────────────────────────

const LOGIN_SIGNAL_RE = /\b(LoginScreen|SignInScreen|AuthProvider|LoginForm|SignInForm)\b/;
const DEMO_CREDENTIAL_RE = /\b(DEMO_ACCOUNT|REVIEWER_LOGIN|reviewer@|demo@|APPLE_REVIEW_NOTES|review_notes)\b/i;

function scanIncompleteDemoLogin(fileTexts, candidates) {
  let loginHit = null;
  let demoHit = false;
  for (const { rel, text } of fileTexts) {
    if (!loginHit && LOGIN_SIGNAL_RE.test(text)) loginHit = rel;
    if (DEMO_CREDENTIAL_RE.test(text)) demoHit = true;
  }
  if (loginHit && !demoHit) {
    candidates.push({
      file: loginHit,
      kind: 'incomplete-demo-login',
      evidence: `login screen found in ${loginHit}, no demo/reviewer credential reference (DEMO_ACCOUNT/REVIEWER_LOGIN/reviewer@/review notes) found anywhere in the repo`,
    });
  }
}

// ── 5. Unverified iPad layout ────────────────────────────────────────────────

const TABLET_DECLARED_RE = /"supportsTablet"\s*:\s*true|UISupportedInterfaceOrientations~ipad/;
const TABLET_LAYOUT_RE = /\b(isPad|isTablet|userInterfaceIdiom|DeviceInfo\.isTablet|useWindowDimensions)\b/;

function scanUnverifiedIpadLayout(fileTexts, candidates) {
  let declaredFile = null;
  let layoutHit = false;
  for (const { rel, text } of fileTexts) {
    if (!declaredFile && TABLET_DECLARED_RE.test(text)) declaredFile = rel;
    if (TABLET_LAYOUT_RE.test(text)) layoutHit = true;
  }
  if (declaredFile && !layoutHit) {
    candidates.push({
      file: declaredFile,
      kind: 'unverified-ipad-layout',
      evidence: `iPad/tablet support declared in ${declaredFile}, no tablet-conditional layout code (isPad/isTablet/userInterfaceIdiom/useWindowDimensions) found anywhere in the repo`,
    });
  }
}

// ── 6. Unlabeled paid-feature screenshot ────────────────────────────────────

const SCREENSHOT_METADATA_RE = /(^|\/)(fastlane\/metadata|screenshots)(\/|$)/i;
const PAID_FEATURE_MENTION_RE = /\b(subscription|paid feature|unlock with|unlock extra|pro version|in-app purchase required)\b/i;
const PAID_LABEL_RE = /\b(pro|premium)\b/i;

function scanUnlabeledPaidScreenshot(fileTexts, candidates) {
  for (const { rel, text } of fileTexts) {
    if (!SCREENSHOT_METADATA_RE.test(rel)) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (PAID_FEATURE_MENTION_RE.test(line) && !PAID_LABEL_RE.test(line)) {
        candidates.push({
          file: rel,
          kind: 'unlabeled-paid-screenshot',
          evidence: `screenshot caption at ${rel}:${i + 1} mentions a paid feature with no Pro/Premium label on the same line`,
        });
      }
    });
  }
}

// ── 7. Dead support/privacy link ────────────────────────────────────────────

const LINK_CONFIG_RE = /\b(support_?url|privacy_?policy_?url|supportUrl|privacyPolicyUrl)\s*[:=]\s*['"]([^'"]*)['"]/gi;
const PLACEHOLDER_URL_RE = /(example\.com|yourapp\.com|TODO|changeme|^$)/i;

function scanDeadSupportPrivacyLink(fileTexts, candidates) {
  for (const { rel, text } of fileTexts) {
    const re = new RegExp(LINK_CONFIG_RE.source, LINK_CONFIG_RE.flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const url = m[2];
      if (PLACEHOLDER_URL_RE.test(url)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'dead-support-privacy-link',
          evidence: `placeholder support/privacy URL ("${url}") at ${rel}:${line}`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

// ── 8. "Coming soon" placeholder ────────────────────────────────────────────

const COMING_SOON_RE = /\bcoming soon\b/gi;
const TEST_DIR_RE = /(^|\/)(tests?|fixtures|__mocks__)(\/|$)/i;

function scanComingSoonPlaceholder(fileTexts, candidates) {
  for (const { rel, text } of fileTexts) {
    if (TEST_DIR_RE.test(rel)) continue;
    const re = new RegExp(COMING_SOON_RE.source, COMING_SOON_RE.flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'coming-soon-placeholder',
        evidence: `"coming soon" placeholder text at ${rel}:${line}`,
      });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

// ── 9. UGC comment feature with no report path ──────────────────────────────

const COMMENT_FEATURE_RE = /\b(addComment|postComment|CommentInput|createComment)\b/g;
const REPORT_SIGNAL_RE = /\b(report|flagContent|moderation|reportComment|flagComment)\b/i;

function scanMissingUgcReportPath(fileTexts, candidates) {
  for (const { rel, text } of fileTexts) {
    const re = new RegExp(COMMENT_FEATURE_RE.source, COMMENT_FEATURE_RE.flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const win = windowAround(text, m.index, m[0].length);
      if (!REPORT_SIGNAL_RE.test(win)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'missing-ugc-report-path',
          evidence: `comment feature at ${rel}:${line} has no report/moderation signal within ${WINDOW} chars`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

// ── 10. Broken restore-purchases button ─────────────────────────────────────

const RESTORE_BUTTON_TEXT_RE = /restore purchases?/i;
const RESTORE_API_RE = /\b(restorePurchases|getAvailablePurchases|clearTransactionIOS|restoreCompletedTransactions)\b/;

function scanBrokenRestorePurchases(fileTexts, candidates) {
  let buttonHit = null;
  let apiHit = false;
  for (const { rel, text } of fileTexts) {
    if (!buttonHit && RESTORE_BUTTON_TEXT_RE.test(text)) buttonHit = rel;
    if (RESTORE_API_RE.test(text)) apiHit = true;
  }
  if (buttonHit && !apiHit) {
    candidates.push({
      file: buttonHit,
      kind: 'broken-restore-purchases',
      evidence: `"Restore Purchases" button text found in ${buttonHit}, no restore-purchases API call (restorePurchases/getAvailablePurchases/restoreCompletedTransactions) found anywhere in the repo`,
    });
  }
}

// ── Top-level scan ───────────────────────────────────────────────────────────

function readAllFiles(rootDir) {
  const discovery = listTrackedFiles(rootDir);
  if (discovery.discoveryFailed) return discovery;
  const fileTexts = [];
  const skippedFiles = [];
  for (const rel of discovery.files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(rootDir, rel));
    } catch {
      skippedFiles.push({ file: rel, reason: 'unreadable' });
      continue;
    }
    if (buf.includes(0)) {
      skippedFiles.push({ file: rel, reason: 'binary-or-nul' });
      continue;
    }
    fileTexts.push({ rel, text: buf.toString('utf8') });
  }
  return { fileTexts, skippedFiles, scannedFiles: discovery.files.length, discoveryFailed: false };
}

function scanAppStoreReadiness(rootDir) {
  const discovery = readAllFiles(rootDir);
  if (discovery.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: discovery.reason,
    };
  }

  const { fileTexts, skippedFiles, scannedFiles } = discovery;

  if (!detectMobileProject(fileTexts)) {
    return {
      candidates: [],
      scannedFiles,
      skippedFiles,
      discoveryFailed: false,
      notApplicable: true,
    };
  }

  const candidates = [];
  scanAppleSigninParity(fileTexts, candidates);
  scanExternalPaymentNoIap(fileTexts, candidates);
  scanMissingAccountDeletion(fileTexts, candidates);
  scanIncompleteDemoLogin(fileTexts, candidates);
  scanUnverifiedIpadLayout(fileTexts, candidates);
  scanUnlabeledPaidScreenshot(fileTexts, candidates);
  scanDeadSupportPrivacyLink(fileTexts, candidates);
  scanComingSoonPlaceholder(fileTexts, candidates);
  scanMissingUgcReportPath(fileTexts, candidates);
  scanBrokenRestorePurchases(fileTexts, candidates);

  candidates.sort((a, b) => (a.file === b.file ? a.kind.localeCompare(b.kind) : a.file.localeCompare(b.file)));

  return {
    candidates,
    scannedFiles,
    skippedFiles,
    discoveryFailed: false,
  };
}

function candidatesAppStoreReadiness(rootDir) {
  return scanAppStoreReadiness(rootDir).candidates;
}

registerGenerator('app-store-readiness', scanAppStoreReadiness);

module.exports = {
  scanAppStoreReadiness,
  candidatesAppStoreReadiness,
  detectMobileProject,
  scanAppleSigninParity,
  scanExternalPaymentNoIap,
  scanMissingAccountDeletion,
  scanIncompleteDemoLogin,
  scanUnverifiedIpadLayout,
  scanUnlabeledPaidScreenshot,
  scanDeadSupportPrivacyLink,
  scanComingSoonPlaceholder,
  scanMissingUgcReportPath,
  scanBrokenRestorePurchases,
};
```

Then add one require line to `plugin/bin/lib/code-health/focus-generators.js`, immediately after the existing `require('./candidates-agent-trust-scope');` line:

```javascript
require('./candidates-app-store-readiness');
```

Then add one entry to the end of the `CRITERIA` array in `plugin/bin/lib/code-health/criteria.js`, immediately after the `agent-trust-scope` entry (before the closing `];`):

```javascript
  // Domain: app-store-readiness → the Apple App Store submission readiness
  // checklist for AI-built mobile apps (Stripe-instead-of-IAP, missing
  // Apple sign-in parity, no account deletion, incomplete demo login,
  // unverified iPad layout, unlabeled paid screenshots, dead support/
  // privacy links, "coming soon" placeholders, UGC with no report path,
  // broken restore-purchases). Area-gated to frontend, the surface a
  // mobile app's client code lives in; pinned directly by code-health's
  // focus=app-store-readiness (skills/code-health/focus-mode.md), never
  // selected via criteriaForArea. Distinct scope from #2622 (pre-scale),
  // #2624 (security-hardening), and #2625 (GDPR/backup-retention) — see
  // criteria-app-store-readiness.md's Scope boundary section.
  { id: 'app-store-readiness', appliesTo: ['frontend'], confidenceFloor: 'medium', fragment: 'criteria-app-store-readiness.md' },
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `node --test tests/bin-lib/code-health/candidates-app-store-readiness.test.js`
Expected: PASS (all tests green)

- [ ] **Step 5: Run the full code-health suite to check for regressions**

Run: `node --test tests/bin-lib/code-health/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-app-store-readiness.js plugin/bin/lib/code-health/focus-generators.js plugin/bin/lib/code-health/criteria.js tests/bin-lib/code-health/candidates-app-store-readiness.test.js
git commit -m "feat: add app-store-readiness code-health candidate generator — refs #2628"
```

---

### Task 2: Criteria fragment — judging guidance and copy-paste prompts

**Files:**
- Create: `plugin/skills/_shared/criteria-app-store-readiness.md`

**Interfaces:**
- Consumes: nothing (pure markdown, loaded by `getCriterion('app-store-readiness')` per Task 1's registration).
- Produces: the fragment Task 1's `CRITERIA` entry already points to by filename. No test — this is prose, mirroring `criteria-security-hardening.md`/`criteria-prelaunch.md`, which also carry no dedicated test file (their content is exercised only by `criteria.test.js`'s generic "fragment is a non-empty string" check, already covered by Task 1's registry-wiring test).

- [ ] **Step 1: Write the fragment file**

Create `plugin/skills/_shared/criteria-app-store-readiness.md`:

```markdown
# Criteria: App Store Readiness (Apple submission, AI-built mobile apps)

Shared, criteria-only fragment — what to flag when judging `focus=app-store-readiness` candidates from `bin/lib/code-health/candidates-app-store-readiness.js` (#2628). No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s app-store-readiness judgment lens (`skills/code-health/focus-mode.md`'s Criterion pinning table) and by `/claude-tweaks:review`'s Code-Mode Procedure step that invokes this focus as a component skill. One source of truth so every sweep applies identical calibration. Confidence floor: `medium`.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `missing-apple-signin-parity`, `external-payment-no-iap`, `missing-account-deletion`, `incomplete-demo-login`, `unverified-ipad-layout`, `unlabeled-paid-screenshot`, `dead-support-privacy-link`, `coming-soon-placeholder`, `missing-ugc-report-path`, `broken-restore-purchases`. The generator returns `notApplicable: true` (zero candidates) when the repo shows no mobile-app signal at all — that is never a clean pass, since there was no app to check. A candidate is a starting pointer, not a finding — judge it holistically.

## What to flag

- **`missing-apple-signin-parity`** — Google Sign-In SDK referenced anywhere in the repo, no Apple Sign-In SDK referenced anywhere. Apple requires sign-in parity: if any third-party/social login is offered, Sign in with Apple must be offered too.
- **`external-payment-no-iap`** — a Stripe Checkout call (or equivalent external payment redirect) with no in-app-purchase SDK (StoreKit, RevenueCat, react-native-iap, expo-in-app-purchases) anywhere in the repo. Digital goods/subscriptions sold to an iOS user must go through IAP; a physical-goods or service-outside-the-app store is a legitimate exception — confirm what's actually being sold before filing.
- **`missing-account-deletion`** — no account-deletion-capable code signal anywhere. Apple requires an in-app path to delete an account, not just deactivate it.
- **`incomplete-demo-login`** — a login/sign-in screen exists with no demo/reviewer credential reference (an env var, a doc, or App Store Connect review notes) anywhere in the repo. A reviewer who can't get past login can't review the app.
- **`unverified-ipad-layout`** — the app declares iPad/tablet support (`supportsTablet: true`, `UISupportedInterfaceOrientations~ipad`) with no tablet-conditional layout code anywhere. Declaring support without any layout adaptation is a strong signal the phone layout simply stretches, unreviewed.
- **`unlabeled-paid-screenshot`** — a screenshot caption/metadata file mentions a paid/premium feature with no "Pro"/"Premium" label on the same line. Apple requires screenshots to accurately represent the app and label paid functionality.
- **`dead-support-privacy-link`** — a support or privacy-policy URL configured with a placeholder value (`example.com`, `yourapp.com`, `TODO`, `changeme`, or empty). Apple requires working support and privacy links.
- **`coming-soon-placeholder`** — literal "coming soon" text in shipped app copy (test/fixture directories are excluded). A placeholder screen reachable by a reviewer is a common rejection reason.
- **`missing-ugc-report-path`** — a comment/UGC posting feature (`addComment`/`postComment`/`CommentInput`/`createComment`) with no report/moderation signal within the generator's text window. Apps with user-generated content need a way to report objectionable content.
- **`broken-restore-purchases`** — "Restore Purchases" button text found with no restore-purchases API call (`restorePurchases`/`getAvailablePurchases`/`restoreCompletedTransactions`) anywhere in the repo. A restore button that doesn't actually call the platform restore API is a common, easy-to-miss rejection reason.

## What NOT to flag

- `missing-apple-signin-parity` when the app offers no third-party sign-in at all (email/password only) — parity only applies when a competing social sign-in is offered.
- `external-payment-no-iap` for a Stripe integration that sells a physical good, an outside-the-app service, or a B2B/enterprise seat — Apple's IAP requirement is scoped to digital goods/subscriptions consumed inside the app.
- `unverified-ipad-layout` for an app that does not declare iPad/tablet support at all — nothing to verify.
- `unlabeled-paid-screenshot` for a caption file whose premium-feature mention already carries "Pro" or "Premium" on the same line — read a few surrounding lines before concluding a real gap, since this is a per-line heuristic.
- `missing-ugc-report-path` for a comment feature with the report signal expressed further from the call site than the generator's fixed text window reaches, or implemented at a layer the generator doesn't scan (a separate moderation service with no textual trace in this repo) — read the actual code path before concluding the gap is real.
- `broken-restore-purchases` for an app with no IAP at all (free app, or external-payment-only by design, per the `external-payment-no-iap` carve-out above) — there is nothing to restore.

## Scope boundary (#2628)

This vertical owns exactly the ten checks above. It explicitly does **not** own:
- **#2622's pre-scale hardening** (query performance, background-job reliability, caching, connection pooling, monitoring/alerting for scale) — a performance-oriented concern, unrelated to App Store submission requirements.
- **#2624's security-hardening checks** (client-bundle secrets, missing per-user ownership checks, unguarded AI-calling endpoints) — a pre-launch security concern, not an Apple-review concern. A Stripe-vs-IAP finding here is about payment *method* compliance, never about endpoint security.
- **#2625's GDPR/backup-retention check** (cryptographic erasure for backup retention on account deletion) — a compliance-specific concern. This vertical's `missing-account-deletion` check only asks whether an in-app deletion path *exists at all*; it never asks whether deleted data is actually erased from backups — that question is `criteria-privacy-pii.md`'s, not this file's.
- **Google Play's parallel review criteria** — this checklist is Apple App Store-specific; Play doesn't mandate Apple/Google sign-in parity the same way and has its own distinct review requirements, out of scope here by design.

## Severity calibration

- **high** — `missing-account-deletion`; `external-payment-no-iap` for a subscription/digital-good app (an outright rejection risk); `broken-restore-purchases` on an app that sells subscriptions.
- **medium** — `missing-apple-signin-parity`; `incomplete-demo-login`; `coming-soon-placeholder` on a primary/first-run screen; `dead-support-privacy-link`.
- **low** — `unverified-ipad-layout` (a real but often-tolerated rejection reason); `unlabeled-paid-screenshot`; `missing-ugc-report-path` on a low-traffic or internal-only comment surface.

## Copy-paste prompts (one per check, runnable standalone)

**(a) Apple sign-in parity:**
> Scan this codebase for a Google Sign-In SDK reference (`GoogleSignin`, `@react-native-google-signin`, or equivalent) with no Apple Sign-In SDK reference (`AppleAuthentication`, `expo-apple-authentication`, `ASAuthorizationAppleIDProvider`) anywhere in the repo. For each finding, name the file and confirm the app genuinely offers third-party sign-in before treating it as a real gap.

**(b) In-app purchase vs. external payment:**
> Scan this codebase for a Stripe Checkout call (`redirectToCheckout`, `createCheckoutSession`, or equivalent) with no in-app-purchase SDK (`StoreKit`, `RevenueCat`, `react-native-iap`, `expo-in-app-purchases`) anywhere in the repo. For each finding, name the file and confirm what's being sold is a digital good/subscription consumed inside the app (Apple's IAP requirement) rather than a physical good or outside-the-app service.

**(c) Account-deletion flow:**
> Scan this codebase for an account-deletion code path (`deleteAccount`, `destroyAccount`, `removeAccount`, or a `DELETE /account`-shaped route). If none exists anywhere in the repo, flag it — Apple requires an in-app path to delete an account.

**(d) Demo/reviewer login completeness:**
> Scan this codebase for a login/sign-in screen. If one exists, confirm a demo or reviewer credential is documented somewhere (an env var, a README, App Store Connect review notes) — a reviewer who cannot get past login cannot review the app.

**(e) iPad layout:**
> Check this app's config (`app.json`'s `expo.ios.supportsTablet`, or `Info.plist`'s `UISupportedInterfaceOrientations~ipad`) for declared iPad/tablet support. If declared, scan for tablet-conditional layout code (`isPad`, `isTablet`, `userInterfaceIdiom`, `useWindowDimensions`). Flag when support is declared with no layout adaptation found.

**(f) Screenshot accuracy and paid-feature labeling:**
> Scan this app's screenshot captions/metadata (`fastlane/metadata/**`, `screenshots/**`) for a mention of a paid/premium feature (`subscription`, `unlock`, `pro version`) with no "Pro"/"Premium" label in the same caption. For each finding, name the file and line.

**(g) Support/privacy links:**
> Scan this codebase's config for a `supportUrl`/`privacyPolicyUrl`-shaped key whose value is a placeholder (`example.com`, `yourapp.com`, `TODO`, `changeme`, or empty). For each finding, name the file and line — Apple requires working support and privacy links.

**(h) "Coming soon" placeholders:**
> Scan this app's shipped UI copy (excluding test/fixture directories) for the literal text "coming soon". For each finding, name the file and line — a placeholder screen reachable by a reviewer is a common rejection reason.

**(i) UGC report path:**
> Scan this codebase for a comment/UGC posting feature (`addComment`, `postComment`, `CommentInput`, `createComment`) with no report/moderation signal (`report`, `flagContent`, `moderation`) nearby. For each finding, name the file and line, and confirm by reading the actual code whether a report path truly doesn't exist or is implemented elsewhere (a separate moderation service).

**(j) Restore-purchases button:**
> Scan this codebase for "Restore Purchases" button text with no restore-purchases API call (`restorePurchases`, `getAvailablePurchases`, `restoreCompletedTransactions`) anywhere in the repo. Flag when the button exists but no actual restore call is found — a common, easy-to-miss rejection reason.

## What this vertical never does

Findings from this criterion always propose a record for the supervised/granted build pipeline (`/claude-tweaks:specify` → `/claude-tweaks:build`) — never a direct edit, and never an automated screenshot replacement, link fix, or payment-flow migration. The generator judges from static text alone; verifying a link actually resolves, or that a screenshot genuinely matches the shipped app, is a later widening, not this vertical's job.
```

- [ ] **Step 2: Verify the fragment is picked up by the existing criteria test**

Run: `node --test tests/bin-lib/code-health/criteria.test.js`
Expected: PASS (the generic "every criterion with a fragment points to a string path" test already covers this; no new test needed for prose content)

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/_shared/criteria-app-store-readiness.md
git commit -m "docs: add app-store-readiness criteria fragment — refs #2628"
```

---

### Task 3: Wire into code-health's focus-mode documentation

**Files:**
- Modify: `plugin/skills/code-health/focus-mode.md`

**Interfaces:**
- Consumes: nothing new (prose only).
- Produces: nothing new (prose only) — downstream readers (`/claude-tweaks:code-health`, `/claude-tweaks:review`) already resolve `FOCUS_GENERATORS`/`CRITERIA` mechanically per Task 1; this task only keeps the prose that names each vertical's Coverage block and pinning row in sync, per that file's own "must-update" rule.

- [ ] **Step 1: Add the Coverage sentence**

In `plugin/skills/code-health/focus-mode.md`, in the `## Coverage` section's long paragraph, immediately after the existing `For \`agent-trust-scope\`, ...` sentence and before `Read the relevant block before reporting anything...`, insert:

```
For `app-store-readiness`, the Coverage block at the top of `bin/lib/code-health/candidates-app-store-readiness.js` (discovery is extension-agnostic, not JS/TS-only, since the checklist needs config/metadata files too; every check is a whole-repo presence/absence signal rather than a per-call-site analysis; `notApplicable: true` when the repo shows no mobile-app signal at all; SDK/pattern recognition covers common RN/Expo/native shapes only).
```

- [ ] **Step 2: Add the Criterion pinning row**

In the same file's `## Criterion pinning` table, add a row immediately after the `agent-trust-scope` row:

```
| `app-store-readiness` | `app-store-readiness` | `criteria-app-store-readiness.md` |
```

- [ ] **Step 3: Verify the Known-values mechanism needs no manual edit**

Run: `node -e "const {FOCUS_GENERATORS}=require('./plugin/bin/lib/code-health/focus-generators.js'); console.log(Object.keys(FOCUS_GENERATORS).join(', '))"`
Expected: the printed list includes `app-store-readiness` (the "Known values" section in `focus-mode.md` derives this list mechanically, per IL-40 — no prose edit needed there).

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/code-health/focus-mode.md
git commit -m "docs: wire app-store-readiness into code-health focus-mode — refs #2628"
```

---

### Task 4: Wire into /claude-tweaks:review's Code-Mode Procedure

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md`
- Modify: `plugin/skills/review/SKILL.md`

**Interfaces:**
- Consumes: `scanAppStoreReadiness` (Task 1), `criteria-app-store-readiness.md` (Task 2) via `getCriterion('app-store-readiness')`.
- Produces: a new numbered step in the Code-Mode Procedure, following the Step 6.6/6.65 precedent exactly.

- [ ] **Step 1: Add the new review step**

In `plugin/skills/review/code-mode-steps.md`, immediately after Step 6.65's closing paragraph (the "Routing (optional)" paragraph ending `...a finding the user declines is a signal for a follow-up record, not proof the risk isn't real, per this repo's "no implicit deferrals" convention (CLAUDE.md).`) and before `## Step 6.7: Late Findings Routing`, insert:

```markdown
## Step 6.66: App Store Readiness Pass (#2628)

Pre-check: skip this step entirely (no section in the summary) when this review's diff scope (Step 2's own-work file list, or the full `git diff --name-only` set) shows no mobile-app signal — no `app.json`, no `.xcodeproj`/`.xcworkspace` path, no `android/app/build.gradle`, and no `package.json` change touching a `react-native`/`expo` dependency. A review with no mobile-app files in scope has nothing this pass could find.

Otherwise, invoke the `app-store-readiness` focus criterion as a component skill: run the generator directly against this repo's working tree —

```bash
node -e "const {scanAppStoreReadiness}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/candidates-app-store-readiness.js'); console.log(JSON.stringify(scanAppStoreReadiness(process.cwd())))"
```

— then judge each returned candidate against `_shared/criteria-app-store-readiness.md` (loaded via `getCriterion('app-store-readiness')`, `bin/lib/code-health/criteria.js`), scoped to the files this review's diff actually touches (a candidate outside the diff scope is noise for a per-review pass, even if the generator found it repo-wide — this is a lighter-weight invocation than a full `/claude-tweaks:code-health focus=app-store-readiness` sweep, which scans and files issues repo-wide on its own schedule; this step never files a GitHub issue itself). A `notApplicable: true` result (no mobile-app signal detected by the generator's own gate) is handled identically to the pre-check skip above — omit the section, no footer note.

**Result handling:**

| Outcome | Review behavior |
|---|---|
| `notApplicable: true` | Omit the section entirely — not applicable, not a pass. No footer note (same as Step 6.5's non-frontend skip). |
| One or more candidates judged as real findings | Include them in the summary as an "App Store Readiness" section (kind, file:line, severity per the criteria fragment's calibration). Findings are advisory — same posture as Step 6.5's design findings. |
| Candidates found but none survive judgment (false positives per the criteria fragment's "What NOT to flag") | Omit the section; note in the summary footer that the pass ran and found nothing actionable. |
| Pre-check skipped (no mobile-app files in scope) | Omit the section entirely — no footer note, same as Step 6.5's non-frontend skip. |

**Routing (optional):** actionable app-store-readiness findings the user wants to action inline route through Step 6.7 below, in the same consolidated pass as Step 6's visual findings, Step 6.5's design findings, Step 6.6's security-hardening findings, and Step 6.65's agent-trust-scope findings. When the user opts not to action them inline, they remain in the App Store Readiness summary section as informational — a finding the user declines is a signal for a follow-up record, not proof the risk isn't real, per this repo's "no implicit deferrals" convention (CLAUDE.md).
```

- [ ] **Step 2: Fold the new step into Step 6.7's consolidated routing**

In the same file's `## Step 6.7: Late Findings Routing` section:

Replace the heading line:
```
## Step 6.7: Late Findings Routing (design + visual + security + agent-trust-scope, consolidated)
```
with:
```
## Step 6.7: Late Findings Routing (design + visual + security + agent-trust-scope + app-store-readiness, consolidated)
```

Replace the opening paragraph's first sentence:
```
Runs **at most once** per review, after Steps 6, 6.5, 6.6, and 6.65 have all completed — and only when at least one of them produced actionable findings (Step 6 in full mode with actionable "UI / Visual" findings; Step 6.5 with `{result: "advisory", findings: [...]}`; Step 6.6 or Step 6.65 with one or more judged findings) AND the user opts to action findings inline. This replaces what were two sequential passes (a design-findings pass and a visual-findings pass), each with its own batch table and its own `AskUserQuestion` — one stop now covers all four categories.
```
with:
```
Runs **at most once** per review, after Steps 6, 6.5, 6.6, 6.65, and 6.66 have all completed — and only when at least one of them produced actionable findings (Step 6 in full mode with actionable "UI / Visual" findings; Step 6.5 with `{result: "advisory", findings: [...]}`; Step 6.6, Step 6.65, or Step 6.66 with one or more judged findings) AND the user opts to action findings inline. This replaces what were two sequential passes (a design-findings pass and a visual-findings pass), each with its own batch table and its own `AskUserQuestion` — one stop now covers all five categories.
```

In the batch table listing Category/Severity source, add a row immediately after the Agent Trust Scope row:
```
| `App Store Readiness` (from Step 6.66) | `criteria-app-store-readiness.md`'s Severity calibration section |
```

In numbered item 4 ("After resolution, fold each finding back into its own Step 7 summary section..."), replace:
```
4. After resolution, fold each finding back into its own Step 7 summary section ("Design Quality" / "Visual Review" / "Security Hardening" / "Agent Trust Scope"), noting its final status (fixed / deferred / accepted).
```
with:
```
4. After resolution, fold each finding back into its own Step 7 summary section ("Design Quality" / "Visual Review" / "Security Hardening" / "Agent Trust Scope" / "App Store Readiness"), noting its final status (fixed / deferred / accepted).
```

- [ ] **Step 3: Update review/SKILL.md's mode-table rows and component-skill prose**

In `plugin/skills/review/SKILL.md`, in the mode table near the top, replace the **code** row:
```
| **code** (default) | `/claude-tweaks:review 42` | Steps 1-7, including Step 6 (visual-review recommendation only, non-blocking), Step 6.5 (Design Quality Pass via Impeccable), Step 6.6 (Security Hardening Pass via code-health's `focus=security-hardening`), Step 6.65 (Agent Trust Scope Pass via code-health's `focus=agent-trust-scope`), and Step 6.7 (late findings routing): spec compliance, test gate, change analysis, code review, hindsight, simplification, visual-review recommendation, design quality pass, security hardening pass, agent trust scope pass, summary |
```
with:
```
| **code** (default) | `/claude-tweaks:review 42` | Steps 1-7, including Step 6 (visual-review recommendation only, non-blocking), Step 6.5 (Design Quality Pass via Impeccable), Step 6.6 (Security Hardening Pass via code-health's `focus=security-hardening`), Step 6.65 (Agent Trust Scope Pass via code-health's `focus=agent-trust-scope`), Step 6.66 (App Store Readiness Pass via code-health's `focus=app-store-readiness`), and Step 6.7 (late findings routing): spec compliance, test gate, change analysis, code review, hindsight, simplification, visual-review recommendation, design quality pass, security hardening pass, agent trust scope pass, app store readiness pass, summary |
```

Replace the **full** row:
```
| **full** | `/claude-tweaks:review 42 full` | Code review (Steps 1-5) + visual browser review via `/claude-tweaks:visual-review` (Step 6) + Design Quality Pass via Impeccable (Step 6.5) + Security Hardening Pass (Step 6.6) + Agent Trust Scope Pass (Step 6.65) + late findings routing (Step 6.7) + summary (Step 7) |
```
with:
```
| **full** | `/claude-tweaks:review 42 full` | Code review (Steps 1-5) + visual browser review via `/claude-tweaks:visual-review` (Step 6) + Design Quality Pass via Impeccable (Step 6.5) + Security Hardening Pass (Step 6.6) + Agent Trust Scope Pass (Step 6.65) + App Store Readiness Pass (Step 6.66) + late findings routing (Step 6.7) + summary (Step 7) |
```

In the Component-Skill Contract paragraph, replace the sentence:
```
Step 6.65 (Agent Trust Scope Pass) follows the identical pattern with `code-health`'s `agent-trust-scope` focus criterion (`bin/lib/code-health/candidates-agent-trust-scope.js` + `_shared/criteria-agent-trust-scope.md`).
```
with:
```
Step 6.65 (Agent Trust Scope Pass) follows the identical pattern with `code-health`'s `agent-trust-scope` focus criterion (`bin/lib/code-health/candidates-agent-trust-scope.js` + `_shared/criteria-agent-trust-scope.md`). Step 6.66 (App Store Readiness Pass) follows the identical pattern with `code-health`'s `app-store-readiness` focus criterion (`bin/lib/code-health/candidates-app-store-readiness.js` + `_shared/criteria-app-store-readiness.md`).
```

- [ ] **Step 4: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS (markdown-only change to review's skill files; no test directly pins this prose, but the full suite confirms nothing else broke)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/code-mode-steps.md plugin/skills/review/SKILL.md
git commit -m "feat: wire App Store Readiness Pass into /review's Code-Mode Procedure — refs #2628"
```

---

### Task 5: docs/skill-graph.md cross-reference

**Files:**
- Modify: `docs/skill-graph.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is the one place CLAUDE.md requires every skill relationship to be stated, per its "Every relationship between skills is stated once" convention.

- [ ] **Step 1: Extend the existing /review row**

In `docs/skill-graph.md`, find the `/review` row (the one whose prose currently ends `...reusing \`focus=agent-trust-scope\`'s generator (\`bin/lib/code-health/candidates-agent-trust-scope.js\`) and criterion (\`_shared/criteria-agent-trust-scope.md\`).`). Append, at the end of that same cell's prose (same row, same column, no new row — mirroring how the Agent Trust Scope sentence was itself appended to this row rather than added as a new row):

```
 The same pattern repeats a third time for Step 6.66 (App Store Readiness Pass, #2628), reusing `focus=app-store-readiness`'s generator (`bin/lib/code-health/candidates-app-store-readiness.js`) and criterion (`_shared/criteria-app-store-readiness.md`).
```

- [ ] **Step 2: Verify no conformance test pins this file's exact byte count**

Run: `node --test tests/ 2>&1 | grep -i "skill-graph"`
Expected: no output (no test name-matches "skill-graph" — this file is prose-only documentation with no byte-pinning test, confirmed by absence of a match)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/skill-graph.md
git commit -m "docs: cross-reference App Store Readiness Pass in skill-graph — refs #2628"
```
