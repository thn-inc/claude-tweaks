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
  assert.strictEqual(result.notApplicableReason, 'no mobile-app signal detected');
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
  assert.strictEqual(result.notApplicable, false);

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
  assert.strictEqual(result.notApplicable, false);
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

test('scanComingSoonPlaceholder: does not scan a test/fixture directory', () => {
  const candidates = [];
  scanComingSoonPlaceholder([{ rel: 'tests/fixtures/Leaderboard.js', text: "return 'Coming soon!';" }], candidates);
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
