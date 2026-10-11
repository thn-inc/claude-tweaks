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
