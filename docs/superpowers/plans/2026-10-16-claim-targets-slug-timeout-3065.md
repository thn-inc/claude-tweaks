# claim-targets: repo-slug gh timeout exits 2 instead of transient exit 4 (#3065) Implementation Plan

**Goal:** A `gh` timeout resolving the repo slug in `claim-targets.js` is retried once, then reported as the CLI's existing transient class (exit 4), not the usage-error exit 2.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T052237-record-3032/spec-3065/work/3065-spec.md` (materialized from GitHub issue #3065)

---

### Task 1: Retry and reclassify repo-slug resolution

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js`
- Modify: `plugin/skills/flow/claim-targets.md`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

- [x] Route `repoSlugOf`'s `gh` call through `runClassified(..., { retryOnTimeout: true })` (reused from `shared-primitives.js`, same pattern as `reconcile/release-merged.js`/`preflight.js`/`pr-state.js`).
- [x] Reclassify in `run()`: a timeout surviving the retry exits 4 (transient envelope, every target listed, empty `released`/`releaseFailed`, stderr names the timeout + override, no USAGE text); `gh`-absent/non-timeout failures and an empty slug stay exit 2 but drop the USAGE text; under `--keep-going`, a post-retry timeout records every target in `skipped` with `reason: 'transient'` and exits 0.
- [x] Update `claim-targets.md`'s exit-2 bullet (no longer lists repo-resolution timeouts; only non-timeout failures) and exit-4 bullet (names the pre-claim slug-resolution timeout case).
- [x] Add `(slug-1)`–`(slug-4)` test cases: timeout-then-succeed (exit 0), double timeout (exit 4, transient envelope, no USAGE), double timeout + `--keep-going` (exit 0, all skipped transient), ENOENT (exit 2, no USAGE).
- [x] Run `node --test tests/bin-lib/claim-targets/*.test.js` — PASS (47/47). Verified 3 of the 4 new cases fail red against the pre-fix classification (reverted `retryOnTimeout`/`isTimeoutError` wiring, re-ran, restored).

**Status:** Complete.
