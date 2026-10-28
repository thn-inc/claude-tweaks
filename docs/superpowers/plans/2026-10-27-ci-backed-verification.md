# CI-backed full-suite verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `.claude-tweaks/verify-scope.json` declares a CI source for a suite, `verify.js` takes that suite's full-run verdict from the PR's CI job on HEAD instead of running it locally.

**Architecture:** A new `plugin/bin/lib/verify/ci-source.js` owns every `gh` call (injectable runner) and returns either a check result built from the CI job (its log normalized into the check's log file, so the existing extract/flaky/baseline paths read it unchanged) or a named fallback reason. `verify.js` asks it before `runChecks` for each CI-declared suite that would run its full command, drops the suites CI answered from the local check set, merges the results back in stage order, and records `report.ci` plus `source: "ci"` on the stamp.

**Tech Stack:** Node 18+, `node --test`, `gh api` (REST only).

**Spec:** `.claude-tweaks/pipelines/2026-10-27T143545-record-4347/work/4347-spec.md`

## Global Constraints

- Without a declared CI source, `verify.js` output and stamps are byte-identical to today's (no `ci` key in report.json, no `source` key in the stamp, `--stamp-status` output unchanged).
- Every `gh` call goes through an injectable runner; tests never touch the network.
- Waiting is bounded polling inside the foreground process, never backgrounded.
- Fallback to the local full run, reason named in `report.json`, when: no CI run for the head SHA within the wait, the run/job was cancelled, `gh` unavailable.
- The committed declaration must stay readable by the previous release's `declaration.js` (an unknown top-level key is ignored there — pinned by `tests/verify-scope-declaration.test.js`).

## Review Focus

- A dirty working tree: CI never saw the uncommitted edits — fall back (`dirty-tree`), never stamp from CI.
- HEAD not pushed / not the open PR's head: fall back immediately (`no-open-pr-at-head`), no wait.
- A conflicted PR (`mergeable_state: dirty`) gets no `pull_request` run: fall back immediately (`pr-conflicted`) instead of waiting the whole budget.
- An impact-subset run of the suite: CI ran the full suite, so a CI verdict stands in for the subset too (revised during build — stronger evidence at no local cost); on fallback the subset runs locally, unchanged. A tool-scoped suite cannot declare `ci` at all.
- CI log lines carry a timestamp prefix and the runner's absolute checkout root (`/home/runner/work/{repo}/{repo}`) — strip and remap so failing-file extraction resolves against the local checkout.

---

### Task 1: Declaration accepts a `ci` block

**Files:** Modify `plugin/bin/lib/verify/declaration.js`; Test `tests/bin-lib/verify/declaration.test.js`

**Produces:** `decl.ci` = `null` or `{ [suite]: { workflow, job, waitSeconds, pollSeconds } }` (defaults `waitSeconds` 900, `pollSeconds` 20). Exported `DEFAULT_CI_WAIT_SECONDS`, `DEFAULT_CI_POLL_SECONDS`.

- [ ] Tests: valid block parses with defaults; unknown suite, non-string/empty `workflow`/`job`, non-positive-integer `waitSeconds`/`pollSeconds`, unknown key, tool-scoped suite each report an error; absent block → `decl.ci === null`.
- [ ] Implement; run `node --test tests/bin-lib/verify/declaration.test.js` → PASS; commit.

### Task 2: `ci-source.js` — fetch a CI verdict

**Files:** Create `plugin/bin/lib/verify/ci-source.js`; Test `tests/bin-lib/verify/ci-source.test.js`

**Produces:**
- `normalizeCiLog(text, localRoot) -> string` — strips the `^YYYY-MM-DDThh:mm:ss.fffffffZ ` prefix per line, rewrites `/home/runner/work/<a>/<b>` (and `D:\a\<a>\<b>`) to `localRoot`.
- `async fetchCiVerdict({ suite, source, headSha, logDir, localRoot, runner, sleep, now }) -> { used: true, result, ci } | { used: false, ci }` where `ci` = `{ suite, workflow, job, used, fallback, prNumber, runId, runUrl, jobId, conclusion, waitedMs }` and `result` is a check result `{ name, command, exitCode, durationMs, logPath }`.
- Calls (REST, `{owner}/{repo}` placeholders): `repos/{owner}/{repo}/commits/{sha}/pulls`, `repos/{owner}/{repo}/pulls/{n}`, `repos/{owner}/{repo}/actions/workflows/{workflow}/runs?head_sha={sha}&per_page=20`, `repos/{owner}/{repo}/actions/runs/{id}/jobs?per_page=100`, `repos/{owner}/{repo}/actions/jobs/{id}/logs`.
- Fallback reasons: `gh-unavailable`, `gh-error: …`, `no-open-pr-at-head`, `pr-conflicted`, `no-ci-run-within-wait`, `ci-run-cancelled`, `ci-job-not-found`, `ci-job-{conclusion}`, `ci-log-unavailable`.

- [ ] Tests (fake runner, fake sleep/now): green job → `used: true`, exitCode 0, log written; red job → exitCode 1, normalized log written; no PR at head → fallback without polling; dirty PR → `pr-conflicted`; no run within wait → `no-ci-run-within-wait` after polling; cancelled run → `ci-run-cancelled`; ENOENT runner → `gh-unavailable`; red job with log fetch failing → `ci-log-unavailable`; `normalizeCiLog` strips prefixes and remaps the root.
- [ ] Implement; PASS; commit.

### Task 3: `verify.js` wiring, report and stamp

**Files:** Modify `plugin/bin/verify.js`, `plugin/bin/lib/verify/stamp.js`; Test `tests/bin-lib/verify/ci-cli.test.js` (fake `gh` on PATH), `tests/bin-lib/verify/stamp.test.js`

**Consumes:** Task 1 `decl.ci`, Task 2 `fetchCiVerdict`.

- [ ] Tests: (a) declared CI + green job on HEAD → exit 0, stamp `source: "ci"`, `ci.tests.runId`, `report.ci[0].used === true`, local command never ran (marker file absent); (b) red CI whose failing file is red at the fork point + `--baseline` → baseline-adjudicated pass, report shows only that file re-run; (c) red CI with a real failure → exit 1, failing region names the test; (d) no PR at head → local run, `report.ci[0].fallback === 'no-open-pr-at-head'`; (e) no `ci` block → report has no `ci` key and stamp has no `source` key; stamp.js: `readStamp` rejects a malformed `source`/`ci`.
- [ ] Implement: eligibility = `decl.ci[suite]` declared, suite in the run's check set with its full command (not the impact subset, not tool-scoped), `--stamp-suite` off, start tree clean (else fallback `dirty-tree`). Merge CI results into `results` in runChecks' stage order; failed CI results go through `retryHook`. `composeStamp` gains optional `ci` (writes `source: "ci"` + `ci`). `--stamp-status` adds `source`/`ci` only when the stamp carries them. stdout gets one `CI:` line per attempted suite.
- [ ] PASS; commit.

### Task 4: `deriveTestVerdict` accepts a stamp

**Files:** Modify `plugin/bin/lib/dispatch/artifact-verdict.js`; Test `tests/bin-lib/dispatch/artifact-verdict.test.js`

- [ ] Tests: `deriveTestVerdict({ stampPath })` on a local stamp and on a `source: "ci"` stamp both return `{ passed: true, failCount: 0, source: 'pass-stamp', stampSource }` reading exactly one file; malformed stamp throws.
- [ ] Implement; PASS; commit.

### Task 5: Declaration, docs, Common Step 5

**Files:** Modify `.claude-tweaks/verify-scope.json` (add `"ci": {"tests": {"workflow": "test.yml", "job": "test"}}`), `tests/verify-scope-declaration.test.js` (pin it), Create `plugin/skills/test/ci-source.md`, Modify `plugin/skills/test/verification.md` (pointer + what CI does not cover: macOS, Node 22, Windows via `windows-regression.yml`), `plugin/skills/build/SKILL.md` Common Step 5 (push before the runner when the declaration has `ci`), `docs/plugin-structure.md` (new files).

- [ ] Run the touched conformance suites and the verify suites; commit.
