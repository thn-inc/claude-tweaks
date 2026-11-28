---
files:
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/ci-source.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/bin/lib/verify/scope.js
  - plugin/skills/test/ci-source.md
  - plugin/skills/build/SKILL.md
  - .claude-tweaks/verify-scope.json
---

# Take the Full-Suite Verdict from CI

**Persona:** a maintainer running `/claude-tweaks:flow #N` (or a dispatched `build,test` call) on a machine where several pipeline sessions share the CPU, in a project whose `.claude-tweaks/verify-scope.json` declares a `ci` source for its suite.
**Goal:** Common Step 5's full-suite verdict comes from the PR's CI job, which finishes in minutes, instead of a local run that takes an hour under load.
**Entry point:** `/claude-tweaks:build` Common Step 5, after the journeys and docs-sync commits.
**Success state:** `verify.js` prints (after `CI: tree dirty only in inert paths (…)` when the tree is dirty only there) `CI: tests — taken from test.yml / test run {id} on HEAD (success, {url})`, no local suite ran, and the pass stamp reads `scope: "full"`, `source: "ci"`, so `/claude-tweaks:test` and the second call's `--stamp-status` read `verifiedHead: true` on a clean tree. On a tree dirty in a non-`generated` inert path the stamp still records `dirty: true`, so `verifiedHead` stays `false` until that path is committed.

## Steps

### 1. Push, then run the runner
- **URL:** `plugin/skills/build/SKILL.md` Common Step 5; `plugin/skills/test/verification.md`'s scoped invocation
- **Action:** The build pushes the branch (`git push origin {branch}`), then runs the scoped `verify.js` invocation with `--baseline` exactly as before. No new flag is needed; the declaration's `ci` block is enough.
- **Should feel:** One push and a few minutes of waiting, with nothing competing for this machine's CPU.
- **Should understand:** CI runs only for a PR's head commit, so an unpushed HEAD ends the run with exit 3 under any declaration (#5800); a tree dirty in a path that is not inert (#5234: declared `generated`, or a first matching rule running no checks), or a HEAD that is not the open PR's head, runs the suite locally (without the declaration's `localRuns` key; under it the run exits 3 with no verdict, `plugin/skills/test/ci-source.md`), and `report.json`'s `ci[].fallback` names why (`head-not-pushed`, `dirty-tree`, `no-open-pr-at-head`). Before a local run starts, stderr says so at once: `verify.js: CI could not answer suite "{suite}" ({reason}) — running it on this machine`. A `gh` read that times out on a loaded machine is retried up to 3 attempts (1 s, then 2 s backoff) before it counts; only a read that still fails falls back, as `gh-error after {k} attempts: …`.
- **Red flags:** an unpushed HEAD that runs the suite locally instead of exiting 3; a local run that starts with no `— running it on this machine` line on stderr; a `CI: … taken from` line on a run whose tree was dirty in a path that is not inert (a tree dirty only in inert paths announces itself first, with `CI: tree dirty only in inert paths ({paths}) — taking CI verdicts on HEAD`); a `ran locally (gh-error: spawnSync gh ETIMEDOUT)` line with no attempt count (the timeout was not retried); a long wait on a PR whose conflicts mean CI will never run (that case is `pr-conflicted`, decided at once); a `ci` declaration in a project whose CI skips draft PRs (`test/ci-source.md`'s CI that skips draft PRs), where every verify falls back with `ci-job-skipped` after one poll, or with a workflow-level gate waits `waitSeconds` before `no-ci-run-within-wait`.

### 2. Read the CI verdict
- **URL:** `verify.js` stdout and `{git-dir}/claude-tweaks-verify/report.json`
- **Action:** The runner waits for the declared job on HEAD, polling, and writes the job's log into `tests.log`. A green job passes. A red job fails with the failing region taken from the CI log; under `--baseline`, only the failing files re-run locally at the fork point and in isolation.
- **Should feel:** The same table and the same failing region as a local run, only faster.
- **Should understand:** `types`/`lint` still run here. The CI pass is ubuntu on Node 20: it does not cover macOS, Node 22 or Windows (`windows-regression.yml` still checks Windows after merge).
- **Red flags:** a red CI run reported as a pass with no `Baseline: adjudicated` line; a CI run on a different sha than HEAD being used.

### 3. The next gate trusts the stamp
- **URL:** `verify.js --stamp-status`; `plugin/bin/lib/dispatch/artifact-verdict.js`'s `deriveTestVerdict({ stampPath })`
- **Action:** `/claude-tweaks:test`'s Skip-if-recent and review Step 1.5 read the stamp.
- **Should feel:** No second full-suite run anywhere in the pipeline.
- **Should understand:** A CI-sourced stamp counts exactly as a local one; `--stamp-status` adds `source: "ci"` and the run id so the evidence is traceable.
- **Red flags:** `--stamp-status` reporting `verifiedHead: false` for a CI-sourced pass on an unchanged clean HEAD.

## Origin
- Created during `/claude-tweaks:build` of record #4347 (2026-10-27), from the speed analysis of the #4026 dispatch, whose local full runs took 55 minutes and 1h34 under load while the same suite took 3.5 minutes in CI.
- Updated during wrap-up of #5153: step 1 flags a `ci` declaration in a project whose CI skips draft PRs, which `_shared/ci-skips-drafts.md` rules a misconfiguration.
- Updated during `/claude-tweaks:build` of #5369: step 1 notes that under the declaration's `localRuns: "on-request"` key an unanswered run exits 3 instead of running locally (`docs/journeys/keep-ci-declared-suites-off-this-machine-5369.md`).
- Updated during `/claude-tweaks:build` of #5437: step 1 notes that a timed-out `gh` read is retried before the suite falls back to a local run.
- Updated during `/claude-tweaks:build` of #5800: step 1 notes that an unpushed HEAD exits 3 under any declaration (push and re-run) and that every other local fallback is announced on stderr before the local run starts.
- Updated during `/claude-tweaks:build` of #5234: a tree dirty only in inert paths (declared `generated`, or a first matching rule running no checks) still takes CI's verdict and announces it with `CI: tree dirty only in inert paths (…) — taking CI verdicts on HEAD`; the stamp still records the tree as dirty unless every dirty path is `generated`.
- Related: `docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md` (Common Step 5's run-once rule), `docs/journeys/declare-a-verify-scope-1924.md` (the declaration).
