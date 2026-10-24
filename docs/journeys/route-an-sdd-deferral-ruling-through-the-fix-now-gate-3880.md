---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/_shared/deferral-gate.md
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/reconcile/console-execute.js
  - plugin/skills/wrap-up/review-console-appendix.md
  - plugin/skills/_shared/console-execution.md
  - plugin/skills/_shared/console-on-pr.md
---

# Route an SDD Deferral Ruling Through the Fix-now Gate

**Persona:** The SDD controller running inside `/claude-tweaks:build` decides to defer a finding instead of fixing it. A typical case is "pre-existing, outside the diff, routed to a follow-up record". Later, the maintainer of an `autonomy: unattended` run reads the auto-resolved Review Console and needs to trust that nothing fixable was waved through.
**Goal:** A deferral that qualifies for an immediate fix is fixed in the build and never reaches the console. A deferral that genuinely can't be fixed now carries exactly one valid `Defer-reason:`. An unattended console never auto-ratifies a deferral without one.
**Entry point:** The SDD controller is about to write a `Ruling:` line whose decision leaves a finding or a required change unfixed. This can happen at pre-flight, inside a task's fix loop, at the round-5 breaker, or for a residual left after the final fix wave's scoped re-review.
**Success state:** Either the finding is fixed by a commit in this build, or `staged/sdd-ruling-{N}.md` carries `Defers: yes` plus one valid `Defer-reason:` and resolves `apply` (ratify) at the console. Anything else waits as `pending — sdd-ruling-deferral-no-defer-reason` or `pending — sdd-ruling-unclassified` for a human.

## Steps

### 1. Run the fix-now gate when the ruling is written
- **URL:** `plugin/skills/build/dispatch.md`, the "Deferral rulings go through the same gate (#3880)" sentence
- **Action:** Check the deferred item against `_shared/deferral-gate.md`'s fix-now criteria, and against the spec's `## Acceptance Criteria` as literal text from `{run-dir}/work/{n}-spec.md`.
- **Should feel:** Like the default is fixing. Deferring takes a reason, not a reflex.
- **Should understand:** An item an acceptance criterion's literal text covers is fixed even when it looks out of scope. #3656's `sdd-ruling-2` is the incident: "no ephemeral server outlives the run" covered the deferred server. The gate's bad reasons never fail it: pre-existing in a touched file, out of scope, and minor.
- **Red flags:** A ruling that defers an item the AC text names. A ruling whose only stated reason is "pre-existing" for a file the diff touches.

### 2. Send a qualifying item to its site's fix destination
- **URL:** same sentence, the per-site destinations
- **Action:** Route the qualifying item by where the ruling was made:
  - **Pre-flight:** fold it into the affected task's implementer brief.
  - **Inside a task's fix loop:** send it to that loop's next round.
  - **Breaker, or residual after the final fix wave's scoped re-review:** dispatch one targeted fix plus one scoped re-review.
- **Should feel:** Like there is always somewhere to go. No ruling site leaves the controller with a fix it has no channel for.
- **Should understand:** The targeted residual fix is `/build`'s explicit override of SDD's five-round cap and its single fix wave, for this case only. `tools/upstream-drift/manifest.yml` pins the upstream "There is no second fix wave" text that the override depends on. If the scoped re-review does not confirm the fix, the item is staged as a deferral with no reason (`Defers: yes`, no `Defer-reason:`) rather than claimed fixed.
- **Red flags:** A sixth fix round or a second whole fix wave run silently. A qualifying deferral staged with a reason instead of being fixed.

### 3. Stage a failing deferral with its reason in the header
- **URL:** `{run-dir}/staged/sdd-ruling-{N}.md`, written at SDD's Finish carry-forward
- **Action:** A deferral that fails the gate is written with one `Defer-reason: {value}` appended to its `Ruling:` line. The staged header then reads `Title:` / `Kind: sdd-ruling` / `Ruling:` (verbatim) / `Defers: yes` / `Defer-reason: {value}` / `Staged-at:`. A settled design decision reads `Defers: no` and has no reason line.
- **Should feel:** Self-describing. The console can tell from the header alone whether a ruling defers work and why.
- **Should understand:** `Defers:` is always written, and a `build-deviation-*` file carries it too, where the console ignores it. The reason value is written bare, without backticks. A backticked value fails closed.
- **Red flags:** A staged ruling with no `Defers:` line. Two `Defers:` lines, or two `Defer-reason:` header lines. A `Defer-reason:` value outside the six-word vocabulary.

### 4. Watch the unattended console hold an unsafe ruling
- **URL:** `console-resolve.js --policy console-auto` (the run's `console.json` and the `AUTO-RESOLVED` table). For a console already posted on the PR, the reconciler's `consoleAutoResolve` pass instead (`decisions.md`'s `withheld ratify of {item}` line).
- **Action:** Read the ruling row's resolution:
  - `apply` means it ratified: either `Defers: no` with no reason line, or a deferral with exactly one valid reason.
  - `pending — sdd-ruling-deferral-no-defer-reason` means a deferral with a missing, invalid or duplicated reason.
  - `pending — sdd-ruling-unclassified` means no `Defers:` line, more than one, a value other than yes/no, or an unreadable file. This also covers a ruling staged before #3880.
- **Should feel:** Trustworthy. Unattended means nobody clicked, not that nobody checked.
- **Should understand:**
  - Both trigger points apply the same gate. `bin/lib/console/resolve.js`'s `sddRulingDeferralReason` does it for the live session. On the reconciler side, `console-execute.js` reads each ruling row's `stagedPath` from `console.json` and lists the unsafe ones in `rulingGateGaps`. Those rows and Resolve stay unticked.
  - The reconciler-side check fails closed on its own inputs too. If `decideConsoleExecute` is ever called without the ruling texts at all, every ruling row is listed in `rulingGateGaps` as `sdd-ruling-unclassified`, never passed through (#4048).
  - A pending ruling still blocks nothing else. The rest of the console resolves as usual, and the ruling's `open` ledger row is what the nothing-left-behind gate later drills.
- **Red flags:** An `apply` on a ruling whose header has `Defers: yes` and no reason. A reconciler pass that ticks a ruling named in `rulingGateGaps`. A `pending` reason other than the two `sdd-ruling-*` words on a ruling row.

## Origin
- Created during the build of #3880 (SDD deferral rulings skip the fix-now test and are auto-ratified at unattended), run `2026-10-22T062405-record-3880`.
- All steps were built in this session. Step 2's per-site destinations and step 4's reconciler trigger point came from the build's final whole-branch review.
- Updated during the build of #4048 (fail closed when `decideConsoleExecute` runs without its ruling-text or merge-grant context), run `2026-10-24T121146-spec-4048`: step 4 notes the reconciler check's fail-closed default for a missing ruling-text map.
- Related: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (what a human does with the ruling row once it reaches the console); `docs/journeys/carry-a-build-review-finding-with-a-defer-reason-3004.md` (the sibling gate for review minors); `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` (the unattended console this gate sits inside).
