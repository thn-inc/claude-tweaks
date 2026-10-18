---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/handoff-template.md
  - plugin/bin/lib/console/resolve.js
  - plugin/skills/wrap-up/review-console-appendix.md
  - plugin/skills/wrap-up/review-console-interactive.md
  - plugin/skills/wrap-up/review-console.md
---

# Ratify or Reverse an SDD Ruling at the Review Console

**Persona:** A claude-tweaks maintainer reaching the Wrap-Up Review Console at the end of a `/flow` run whose build ran `/superpowers:subagent-driven-development`. During that build the SDD controller decided things in lieu of stopping — a plan-vs-review conflict, a breaker adjudication, a residual final-review finding — and wrote each as a `Ruling:` line. The maintainer never saw those decisions being made and wants to confirm or undo each one before the branch merges.
**Goal:** See every load-bearing ruling as its own row at the console, ratify the ones that hold, and reverse the ones that don't by filing a born-ready record — without a new mid-pipeline stop and without a ruling silently disappearing into a terminal ledger row.
**Entry point:** `/claude-tweaks:wrap-up`'s Review Console (single-spec chat console) for a run whose `staged/` holds one or more `sdd-ruling-{N}.md` files.
**Success state:** Each ruling row is resolved as either `accepted` (ratified, with the ruling's own "— why" clause — or the fixed fallback when the line carries none — as the Resolution) or `deferred` (reversed, pointing at the new record `reversed → #{n}`) in the run ledger; the console archives with no `open` ruling row left, and the maintainer knows which decisions they confirmed and which they overturned.

## Steps

### 1. See the ruling arrive from the build
- **URL:** the run's `decisions.md` under `## /build`, and `staged/sdd-ruling-{N}.md`
- **Action:** After SDD's Finish step, read the `STAGED {time} — SDD ruling carried forward: "{one-liner}". Stage path: staged/sdd-ruling-{N}.md.` line and open the staged file. Its header carries `Kind: sdd-ruling`, the `progress.md` line verbatim under `Ruling:`, and `Ledger: {ledger path}#{item}` naming the `open` ledger row appended just before it.
- **Should feel:** Like a decision was logged for you, not hidden from you. The one-liner and the verbatim ruling are both there; nothing has been paraphrased.
- **Should understand:** Only a line whose first marker match is `Ruling:` is load-bearing. A `parked —` line (first match `parked —`) stays an `observation`; a `minor (deferred):` line stays `deferred`. The ledger row was written first so the staged file can name its item number, and the path in the STAGED line is the one `stage-item.js` actually wrote even when `--allocate` had to renumber it.
- **Red flags:** A ruling row with status `observation` (the pre-#3401 silent form). A `Ledger:` header naming an item that does not exist. A `staged/sdd-ruling-{N}` file with no `.md` extension. A `SKIP {time} — SDD ruling carry-forward (degraded): …` line under `## /build`: `stage-item.js` failed, so that ruling has no staged file and will not reach the console — its ledger row stays `open` with no `(staged/…)` suffix, and the resolve gate drills it instead.

### 2. Find the row in the console's Pending review section
- **URL:** the Review Console's Pending review section
- **Action:** Locate the `sdd-ruling-*` row among the staged `.md` proposals. `bin/lib/console/resolve.js` routes the prefix there with the `apply` stance, so under Approve all (and under `consoleAutoResolve` at `unattended`) its default is ratify.
- **Should feel:** Routine — the row sits beside `polish-suggestion-*` and `build-deviation-*` items, with the same Approve-all default, not in a new section with a new ceremony.
- **Should understand:** `apply` on this row means ratify: it changes no code and writes the `Ledger:` row back to `accepted`. The row is never `pending — unmapped-prefix`; if it were, Approve all and the unattended console could not resolve it.
- **Red flags:** The row rendering with `unmapped-prefix`. A Pending review heading that still lists only "apply, skip, or modify" with no hint that `reverse` exists for a ruling row.

### 3. Ratify by approving, or reverse by overriding
- **URL:** the console's terminal `AskUserQuestion` (Approve all / Override specific items)
- **Action:** Choose Approve all to ratify every ruling row, or Override and reply `ratify {#}` / `reverse {#}` per row. Replying `skip {#}` on a ruling row is refused with a one-line notice naming the two valid words.
- **Should feel:** Binary and decisive. SDD already decided; the maintainer's job is to confirm or overturn, never to leave the question hanging.
- **Should understand:** `reverse` cannot change code at this point — the fix wave is closed — so it files the reversal as a born-ready record (`specShapedBody`; Current State = the ruling and the finding it ruled on; Deliverables = the reversal; `Defer-reason: genuinely-larger`), staged as `staged/ledger-record-sdd-ruling-{N}.md` and routed through the console's Queue writes step in the same pass.
- **Red flags:** A bare `skip` being accepted on a ruling row. A reverse that edits code in-run. A reversal record without a `Defer-reason:`.

### 4. Confirm the write-back in the run ledger
- **URL:** `docs/plans/{date}-{slug}-ledger.md`, the row the staged file's `Ledger:` header named
- **Action:** Check the row flipped: ratify → `accepted` with Resolution `ratified at Review Console — {the ruling's own "— why" clause}` (`ratified at Review Console — no — why clause on the ruling line` when the line carries none); reverse → `deferred` with Resolution `reversed → #{new record}`. Under Approve all a ratify rides `wrap-up-engine.js finish-console`'s `ledger` array; outside Approve all a ratify is written directly at the console's step 1 per `_shared/staged-patch.md`'s Write-back to the ledger. A reverse is never written at step 1: it is written at step 7 (Queue writes), only once that step has created the reversal record.
- **Should feel:** Closed-loop. The ledger file, not only `decisions.md`, says what state the ruling ended in.
- **Should understand:** The row stayed `open` until this moment on purpose: a lost or unapplied staged file blocks completion loudly through the nothing-left-behind gate instead of passing as terminal. The same holds for a reverse whose record step 7 declined (`refused-proposals.md`) or failed to create: the row stays `open` with the cause logged, because a terminal `deferred` with no record number could never be revisited.
- **Red flags:** An `accepted` row with an empty Resolution. A ruling row still `open` after the console archived. A reversed row marked `deferred` with no `#{n}` in its Resolution.

### 5. Standalone build: find the ruling in the handoff instead
- **URL:** `/claude-tweaks:build`'s Step 7 handoff, `### SDD rulings (standalone build, if any)`
- **Action:** With no `$PIPELINE_RUN_DIR`, nothing stages a file; the handoff lists each ruling as `- {one-liner} — ledger #{item} (open; Accept = ratify, Keep/Defer = reverse at a standalone /claude-tweaks:wrap-up)`. A later standalone `/claude-tweaks:wrap-up` drills the `open` row per item with the resolve gate's existing vocabulary.
- **Should feel:** The same decision, reached by a different door. No ruling is lost just because the build ran outside a pipeline.
- **Should understand:** Phase 1's fix-now criteria do not fire on a ruling by themselves — its text states a decision, not a defect — so the row waits for the human's Accept / Keep / Defer / Fix anyway.
- **Red flags:** A standalone handoff with rulings in the SDD ledger but no `### SDD rulings` section. A resolve gate trying to "fix" a ruling.

## Origin
- Created during build of #3401 (surface load-bearing SDD `Ruling:` lines to a human at wrap-up instead of non-blocking ledger observations), run `2026-10-17T190411-spec-3401`.
- Steps 1-5 built in this session. Steps 2-4 describe the single-spec chat console only; the `pr-first` PR-hosted console and the multi-spec console are a staged follow-up record from this run's whole-branch review.
- Related: `docs/journeys/measure-sdd-final-review-value-3386.md` (reads the same rulings as evidence); `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` (the `consoleAutoResolve` path that ratifies with zero clicks).
