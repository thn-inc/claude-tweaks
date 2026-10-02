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
const { registerGenerator } = require('./focus-generators');
const { listTrackedFiles } = require('./candidates-dead-code');

const WINDOW = 400; // chars, each direction, for co-occurrence checks

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function windowAround(text, index, matchLen) {
  const start = Math.max(0, index - WINDOW);
  const end = Math.min(text.length, index + matchLen + WINDOW);
  return text.slice(start, end);
}

// Shared shape for five of the ten checks below (Apple sign-in parity,
// external payment, demo login, iPad layout, restore purchases): flag the
// first file where `triggerRe` matches, but only when `counterRe` matches
// nowhere in the repo. Each caller supplies its own regex pair, candidate
// kind, and evidence text.
function scanPresenceWithoutCounterpart(fileTexts, candidates, { triggerRe, counterRe, kind, evidence }) {
  let triggerHit = null;
  let counterHit = false;
  for (const { rel, text } of fileTexts) {
    if (!triggerHit && triggerRe.test(text)) triggerHit = rel;
    if (counterRe.test(text)) counterHit = true;
  }
  if (triggerHit && !counterHit) {
    candidates.push({ file: triggerHit, kind, evidence: evidence(triggerHit) });
  }
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
  scanPresenceWithoutCounterpart(fileTexts, candidates, {
    triggerRe: GOOGLE_SIGNIN_RE,
    counterRe: APPLE_SIGNIN_RE,
    kind: 'missing-apple-signin-parity',
    evidence: (file) => `Google sign-in SDK referenced in ${file}, no Apple sign-in SDK found anywhere in the repo`,
  });
}

// ── 2. External payment instead of IAP ──────────────────────────────────────

const STRIPE_CHECKOUT_RE = /\b(redirectToCheckout|createCheckoutSession|stripe\.checkout\.sessions\.create|Checkout\.Session)\b/;
const IAP_RE = /\b(StoreKit|react-native-iap|RevenueCat|react-native-purchases|expo-in-app-purchases|SKPaymentQueue)\b/;

function scanExternalPaymentNoIap(fileTexts, candidates) {
  scanPresenceWithoutCounterpart(fileTexts, candidates, {
    triggerRe: STRIPE_CHECKOUT_RE,
    counterRe: IAP_RE,
    kind: 'external-payment-no-iap',
    evidence: (file) => `Stripe Checkout call in ${file}, no StoreKit/RevenueCat/react-native-iap/expo-in-app-purchases import found anywhere in the repo`,
  });
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
  scanPresenceWithoutCounterpart(fileTexts, candidates, {
    triggerRe: LOGIN_SIGNAL_RE,
    counterRe: DEMO_CREDENTIAL_RE,
    kind: 'incomplete-demo-login',
    evidence: (file) => `login screen found in ${file}, no demo/reviewer credential reference (DEMO_ACCOUNT/REVIEWER_LOGIN/reviewer@/review notes) found anywhere in the repo`,
  });
}

// ── 5. Unverified iPad layout ────────────────────────────────────────────────

const TABLET_DECLARED_RE = /"supportsTablet"\s*:\s*true|UISupportedInterfaceOrientations~ipad/;
const TABLET_LAYOUT_RE = /\b(isPad|isTablet|userInterfaceIdiom|DeviceInfo\.isTablet|useWindowDimensions)\b/;

function scanUnverifiedIpadLayout(fileTexts, candidates) {
  scanPresenceWithoutCounterpart(fileTexts, candidates, {
    triggerRe: TABLET_DECLARED_RE,
    counterRe: TABLET_LAYOUT_RE,
    kind: 'unverified-ipad-layout',
    evidence: (file) => `iPad/tablet support declared in ${file}, no tablet-conditional layout code (isPad/isTablet/userInterfaceIdiom/useWindowDimensions) found anywhere in the repo`,
  });
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
  scanPresenceWithoutCounterpart(fileTexts, candidates, {
    triggerRe: RESTORE_BUTTON_TEXT_RE,
    counterRe: RESTORE_API_RE,
    kind: 'broken-restore-purchases',
    evidence: (file) => `"Restore Purchases" button text found in ${file}, no restore-purchases API call (restorePurchases/getAvailablePurchases/restoreCompletedTransactions) found anywhere in the repo`,
  });
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
      notApplicableReason: 'no mobile-app signal detected',
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
    notApplicable: false,
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
