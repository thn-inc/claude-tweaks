# claims-git-cas: configurable git timeout (#3051) Implementation Plan

**Goal:** Make the claims-git-cas fixed 10s `git` timeout configurable (mirroring #2567's `gh-timeout-ms`), and distinguish a timeout from other transport failures without changing the failure vocabulary.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T052237-record-3032/spec-3051/work/3051-spec.md` (materialized from GitHub issue #3051)

---

### Task 1: Add the `git-timeout-ms` policy key and resolver

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js`
- Modify: `plugin/bin/lib/policy.js`
- Modify: `plugin/bin/lib/shared-primitives.js`
- Test: `tests/bin-lib/shared-primitives.test.js`
- Test: `tests/policy-schema.test.js` (count-pin bump)

- [x] Add `git-timeout-ms` to `POLICY_KEYS` (integer, 1000-120000, default 30000, category `housekeeping`, tier `advanced`).
- [x] Add `readGitTimeoutMs(repoRoot)` to `policy.js`, exported alongside `readGhTimeoutMs`.
- [x] Mirror `ghTimeoutFromEnv`/`ghTimeoutFromPolicy`/`resolveGhTimeoutMs`/`getGhTimeoutMs` in `shared-primitives.js` for a `GIT_TIMEOUT_MS` getter export (env `CLAUDE_TWEAKS_GIT_TIMEOUT_MS` > policy > default 30000, lazily resolved and cached). Export `isTimeoutError` (previously internal-only).
- [x] Run `node --test tests/bin-lib/shared-primitives.test.js tests/policy-schema.test.js tests/policy.test.js` — PASS.

### Task 2: Use the resolved timeout and classify timeouts in claims-git-cas.js

**Files:**
- Modify: `plugin/bin/lib/issues/claims-git-cas.js`
- Test: `tests/bin-lib/issues/claims-git-cas.test.js`

- [x] Replace the hardcoded `GIT_TIMEOUT_MS = 10000` with the shared-primitives resolved value.
- [x] Add a `timedOut: true` flag (via `isTimeoutError`) to every `transport-failure` return site whose failure came from a caught error: `readClaimBlobGit`'s fetch catch and show catch, `writeClaimBlobGit`'s catch, and `readClaimBlobsGitBatch`'s ls-tree catch and cat-file-batch catch. `failure` stays `'transport-failure'` in every case — no new failure kind.
- [x] Run `node --test tests/bin-lib/issues/claims-git-cas.test.js` — PASS (20/20, including 2 new timedOut cases).

### Task 3: Name the timeout in verify-run-bookends' missing-bookend reason

**Files:**
- Modify: `plugin/bin/verify-run-bookends.js`
- Test: `tests/verify-run-bookends.test.js`

- [x] When `read.timedOut` is set, append `(timed out after {GIT_TIMEOUT_MS} ms)` to the `read-failed:` reason.
- [x] Run `node --test tests/verify-run-bookends.test.js` — PASS.

### Task 4: Document `git-timeout-ms`

**Files:**
- Modify: `plugin/skills/_shared/policy-schema.md`

- [x] Add a `git-timeout-ms` row next to `gh-timeout-ms`, same shape (canonical home, owner, default, meaning).

**Status:** Complete. Full suite re-run at the end of the bundle's build phase.
