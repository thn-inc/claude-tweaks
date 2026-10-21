---
files:
  - plugin/bin/qa-stamp.js
  - plugin/bin/lib/verify/qa-stamp.js
  - plugin/bin/qa-report.js
  - plugin/bin/lib/qa-report/compose.js
  - plugin/skills/test/SKILL.md
  - plugin/skills/test/qa-reporting.md
---

# Skip QA Stories That Already Passed at This Commit

**Persona:** a `/claude-tweaks:dispatch` group running a web-surface record in two calls (`build,test`, then `review,polish,wrap-up`), whose second call has `/claude-tweaks:flow` auto-insert `/claude-tweaks:test` at the same HEAD the first call's QA just passed on — and the maintainer reading that run's log afterwards.
**Goal:** spend browser QA once per commit — the second call recognizes the stories that already passed at this exact clean HEAD and does not dispatch them again, while any doubt (a moved HEAD, a dirty tree, an edited story, a failed run) still runs QA.
**Entry point:** `/claude-tweaks:test`'s pipeline story selection (`plugin/skills/test/SKILL.md`, the `VERIFICATION_PASSED=true` + stories bullet and the runner-stamp bullet), running `node "${CLAUDE_PLUGIN_ROOT}/bin/qa-stamp.js" --check --stories <id=file,...>` before any story dispatch.
**Success state:** the first call's QA run ends with a QA pass stamp in the checkout's git dir; the second call reports `QA: skipped — stories already passed at {short-sha}` and logs one `AUTO` line instead of re-running every story; the #3013 PR-check gate and the Design CLI gate still run before `TEST_PASSED` is set.

## Steps

### 1. The first call's QA run writes the stamp
- **URL:** `plugin/skills/test/qa-reporting.md` Phase 5, "QA pass stamp (pipeline runs, #3003)"
- **Action:** The story run goes through `qa-procedures.md` Phases 1-5.5 — every pipeline story run does, scoped or full. In Phase 5 the agent writes every selected story's result (SKIPPED ones included) to `{RUN_DIR}/story-results.json` and runs `qa-report.js --results "{RUN_DIR}/story-results.json" --out "{RUN_DIR}/report.json"` (#3328), which machine-writes `report.json` with its `summary` counted from its `stories` array; the agent never composes or hand-edits `report.json`. Immediately after, the agent runs `qa-stamp.js --write --report "{RUN_DIR}/report.json"`. The CLI writes `{git-dir}/claude-tweaks-qa-pass.json` (`{sha, dirty: false, stories: [{id, file, sha256}], storiesDir, at, reportPath}`) and prints `{written: true, …}`.
- **Should feel:** Like a receipt — one line confirming what passed at which commit, no extra prompt.
- **Should understand:** The stamp is written only for a clean tree where every story is PASS or PASS_WITH_CAVEATS and the report's summary agrees with its stories array. QA's own screenshots under `.claude-tweaks/artifacts/` don't count as dirty; any other untracked or modified file does. Each story is bound to its YAML file's sha256, so a story edited later — including by Phase 4.5's own selector recovery — is never covered. The stamp lives per worktree, beside the verification stamp, so both dispatch calls in one group worktree see it and a sibling worktree never does.
- **Red flags:** A stamp written on a dirty tree or with a failed or skipped story; no `report.json` in a pipeline QA run directory (the stamp write would then refuse with `report-unreadable`); a `report.json` hand-written instead of produced by `qa-report.js`, or a `qa-report.js` exit 1 (invalid payload) left unfixed instead of corrected and re-run.

### 2. A refusal says why instead of failing silently
- **URL:** `plugin/skills/test/qa-reporting.md` Phase 5; `plugin/bin/qa-stamp.js` header
- **Action:** When `--write` refuses, the QA report carries one line: `QA pass stamp: not written ({reason})` — e.g. `dirty-tree`, `story-not-passed: login FAIL`, `summary-not-clean`, `story-file-unreadable: app.yaml`.
- **Should feel:** Diagnosable — the reader can tell "never fires because the tree is always dirty" from "didn't fire because a story failed" without opening code.
- **Should understand:** A result refusal (a story or summary that didn't pass) also deletes any existing stamp at the same HEAD; the CLI reports `invalidated: true` and the report line gains `, invalidated prior stamp`. The latest run at this commit failed, so an earlier "passed here" claim no longer holds. If that removal itself fails, the CLI reports `invalidateFailed: <code>` and the report line says the stale stamp could not be removed, rather than staying silent. Environmental refusals (dirty tree, unreadable report, no git dir) leave an existing stamp alone.
- **Red flags:** A refusal with no `QA pass stamp:` line in the report; a stale stamp still present after a failed run at the same HEAD.

### 3. The second call checks before dispatching stories
- **URL:** `plugin/skills/test/SKILL.md` pipeline bullets ("QA pass stamp (#3003)")
- **Action:** After selecting stories (scoped by `source_files`, the Layer-3 full set, or the exit-1 full-set fallback), the agent runs `qa-stamp.js --check --stories login=app.yaml,checkout=app.yaml` (ids and source files relative to `STORIES_DIR`). On `{skip: true, reason: "covered"}` it dispatches nothing, reports `QA: skipped — stories already passed at {short-sha}`, and logs `AUTO {time} — QA skipped: {k} selected stories already passed at {short-sha} (QA pass stamp). Reversibility: high.`
- **Should feel:** Instant — the minutes a full browser QA pass costs are simply not spent a second time on the same commit.
- **Should understand:** The skip needs all of: a stamp at exactly this HEAD, a clean tree, the same `STORIES_DIR`, and every selected story covered under the same file with an unchanged hash. Any miss runs the selection unchanged — `no-stamp`, `sha-mismatch`, `dirty-tree`, `stories-dir-mismatch`, `story-not-covered: {id}`, `story-changed: {id}`, `story-file-unreadable: {id}` — and needs no log line. Skipping QA does not skip the gates around it: the PR-check gate (#3013) still runs before `TEST_PASSED` is set, and so does the Design CLI gate.
- **Red flags:** Stories dispatched again at an unchanged clean HEAD with a covering stamp; a skip after the story YAML changed, the tree went dirty, or HEAD moved; `TEST_PASSED` set on the skip path without the PR-check gate's read.

## Origin
- Created during build of #3003 (QA pass stamp: `plugin/bin/lib/verify/qa-stamp.js`, `plugin/bin/qa-stamp.js`, `/claude-tweaks:test` pipeline routing through `qa-procedures.md`) — reported from a 6.136.0 dispatch run where fourteen stories ran twice on the same commit and the first call's QA run directory held no `report.json`.
- Updated during build of #3328: Phase 5's `report.json` is now written by the deterministic `plugin/bin/qa-report.js` writer (composer `plugin/bin/lib/qa-report/compose.js`) instead of agent prose, so the artifact the stamp reads exists whenever the stories ran.
- Related: #2486 (`verify.js --changed-files --integration-branch` falls through an anchor equal to HEAD — why "changed since the last pass" could not answer the QA question), #3013 (PR-check gate that still applies on the skip path).
