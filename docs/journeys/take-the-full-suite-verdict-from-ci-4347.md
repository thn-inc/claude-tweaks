---
files:
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/ci-source.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/skills/test/ci-source.md
  - plugin/skills/build/SKILL.md
  - .claude-tweaks/verify-scope.json
---

# Take the Full-Suite Verdict from CI

**Persona:** a maintainer running `/claude-tweaks:flow #N` (or a dispatched `build,test` call) on a machine where several pipeline sessions share the CPU, in a project whose `.claude-tweaks/verify-scope.json` declares a `ci` source for its suite.
**Goal:** Common Step 5's full-suite verdict comes from the PR's CI job, which finishes in minutes, instead of a local run that takes an hour under load.
**Entry point:** `/claude-tweaks:build` Common Step 5, after the journeys and docs-sync commits.
**Success state:** `verify.js` prints `CI: tests — taken from test.yml / test run {id} on HEAD (success, {url})`, no local suite ran, and the pass stamp reads `scope: "full"`, `source: "ci"`, so `/claude-tweaks:test` and the second call's `--stamp-status` read `verifiedHead: true`.

## Steps

### 1. Push, then run the runner
- **URL:** `plugin/skills/build/SKILL.md` Common Step 5; `plugin/skills/test/verification.md`'s scoped invocation
- **Action:** The build pushes the branch (`git push origin {branch}`), then runs the scoped `verify.js` invocation with `--baseline` exactly as before. No new flag is needed; the declaration's `ci` block is enough.
- **Should feel:** One push and a few minutes of waiting, with nothing competing for this machine's CPU.
- **Should understand:** CI runs only for a PR's head commit, so an unpushed HEAD, a dirty tree, or a HEAD that is not the open PR's head runs the suite locally, and `report.json`'s `ci[].fallback` names why (`head-not-pushed`, `dirty-tree`, `no-open-pr-at-head`).
- **Red flags:** a `CI: … taken from` line on a run whose tree was dirty; a long wait on a PR whose conflicts mean CI will never run (that case is `pr-conflicted`, decided at once).

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
- Related: `docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md` (Common Step 5's run-once rule), `docs/journeys/declare-a-verify-scope-1924.md` (the declaration).
