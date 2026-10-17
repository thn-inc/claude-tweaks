---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/handoff-template.md
  - plugin/skills/_shared/auto-decision-log.md
---

# Keep a Planned Browser Check From Being Dropped at Final Verification

**Persona:** a developer building a `surface: web` record with `/claude-tweaks:flow #{n}`. Their plan's last task is "run the full suite, then do a real-browser pass at 390 px and 1280 px in both themes before review", because earlier tasks each reported narrow-width behaviour as unverified and layout bugs found only at review have already cost the project a fix round.
**Goal:** when `/build` folds that final verification task into Common Step 5, the browser pass is not silently dropped. It runs before `/build` hands off. If it cannot run, a visible `SKIP` line says why, so `/review` and the developer know it was not done.
**Entry point:** `/claude-tweaks:build #{n}` (or the `build` phase of `/claude-tweaks:flow #{n}`) on a plan whose final task names runner checks plus at least one non-runner step (a browser check, a script, a manual probe).
**Success state:** Common Step 5's full-suite run covers only the task's runner checks: types, lint, and tests. Each other step the task names has either run before the Step 7 handoff, with any defect it found fixed, committed, and Step 5 re-run, or left one `SKIP … step "{step}" (skipped): {condition} → not run by /build; surfaced for /review.` line in `decisions.md`. A standalone `/build` lists that line in the handoff's `### Skipped steps` section instead.

## Steps

### 1. Fold the final verification task into Common Step 5 — `/build` controller
- **URL:** `/claude-tweaks:build #{n}` Common Step 5 (Final Verification), under either the `subagent` or the `batched` strategy
- **Action:** the controller treats the plan's "full verification, no new code" task as Step 5's single full-suite run rather than dispatching it as its own task.
- **Should feel:** unsurprising. The suite still runs exactly once and still writes the runner pass stamp, so nothing about Step 5's cost changes.
- **Should understand:** folding absorbs only the task's runner checks (the types, lint, and tests `test/verification.md` runs). `build/dispatch.md`'s "Folded verification task (#3118)" rule owns the detail. `SKILL.md` Common Step 5 points at it, so a `batched` run, which never reads `dispatch.md`'s subagent procedure, sees it too.
- **Red flags:** the controller cites "runs the full suite once" to treat the whole task, browser pass included, as satisfied. Step 5 gains a browser dependency for every web build, which is the alternative the record rejected.

### 2. Run the task's other named steps before the handoff — `/build` controller
- **URL:** between Common Step 5 passing and Common Step 7's handoff
- **Action:** run each non-runner step the folded task names: a browser check through `/claude-tweaks:browse`, a script by running it.
- **Should feel:** like part of the build. A layout defect found here, such as a sentence pushed off-screen at phone width, is fixed before any code review reads the diff.
- **Should understand:** a defect found here is a Step 5-class failure. Fix it, commit, re-run that step to confirm the fix, and re-run Step 5 so the pass stamp matches HEAD again. It is never deferred to `/review`. A step that ran only in part (a dev server dying mid-pass) is logged `(degraded)` instead of `(skipped)`. The rule keys on the steps the folded task names, not on the record's `surface:`, so a web record whose plan names no browser step gets no extra step.
- **Red flags:** a defect found by the folded browser step is handed to `/review` instead of fixed. A step that ran is logged as `SKIP`. A fix lands after Step 5 without a re-run.

### 3. Trace a step that could not run — `decisions.md` or the handoff
- **URL:** `{run-dir}/decisions.md` under `## /build`, or the Step 7 handoff's `### Skipped steps` section for a standalone `/build` with no run dir
- **Action:** read why a planned step did not run, for example with no browser backend, no dev server, or a truly manual check.
- **Should feel:** honest. The gap is named with its condition, so a reviewer or the developer can run the check themselves rather than assume it passed.
- **Should understand:** the line is `SKIP {time} — {plan task} step "{step}" (skipped): {condition} → not run by /build; surfaced for /review. Reversibility: n/a.`, written with `log-decision.js --status SKIP --section "/build"` per `_shared/auto-decision-log.md`'s Degrade-trace rule. A `SKIP` carries no staged artifact. It is never `STAGED`.
- **Red flags:** the planned browser step is absent from both `decisions.md` and the handoff. The skip is recorded as `STAGED`. A self-skipped check reads as a satisfied visual-check precondition before a merge decision.

## Origin
- Created during build of #3118. A `surface: web` record's plan ended with a full-verification task that included a real-browser pass. The controller ruled the task "runs as Common Step 5", citing `dispatch.md`'s "runs the full suite once" sentence. Step 5 ran the suites with no browser. The browser pass happened only at `/flow`'s later `/review` visual check, which found a medium layout defect and four lows and cost a fix wave and a scoped re-review.
- Related journeys: `run-a-deterministic-verification-check.md` (the runner Step 5 drives), `keep-review-lenses-from-running-suites-3001.md` (where suites are run, and where they are not).
