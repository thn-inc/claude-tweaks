---
files:
  - plugin/bin/lib/preflight-records/merge-gate.js
  - plugin/bin/lib/issues/record-payload.js
  - plugin/bin/preflight-records.js
  - plugin/skills/flow/multispec-merge-gate.md
  - plugin/skills/flow/multispec-preflight-failure.md
  - plugin/skills/flow/multi-spec.md
---

# Run a Batch Whose Record Needs a Merged Prerequisite

**Persona:** a maintainer/operator running `/claude-tweaks:flow #A,#B,#C` on a multi-record batch, in default `auto` mode.
**Goal:** get the batch's buildable records built in one shared branch, without the run stopping to ask how to sequence a record whose own spec demands that an in-batch prerequisite already be merged to the integration branch.
**Entry point:** `/flow`'s multi-spec Validation (`multi-spec.md` steps 3–4a), before Step 2.8 claims anything.
**Success state:** the demanding record, and every in-batch record depending on it, is split out before claiming; the run continues with the rest with no `AskUserQuestion`; the parent `decisions.md` carries one `AUTO … — Step 1: merge-state gate split …` line, and the Pipeline Preview footer prints the exact re-run command for after the merge.

## Steps

### 1. Pre-flight collects the batch and evaluates the gate in one call — Validation step 3
- **URL:** `plugin/skills/flow/multi-spec.md` Validation step 3
- **Action:** `/flow` runs `bin/preflight-records.js {targets in run order} --merge-gate --integration-branch "$INTEGRATION_BRANCH"`, with `$INTEGRATION_BRANCH` resolved per `_shared/integration-branch.md`. One call returns `{records, overlapGroups, directOverlaps, workLinks, mergeGate}`.
- **Should feel:** Invisible — no extra fetch pass and no question; the gate rides the pre-flight call that already ran.
- **Should understand:** The gate fires only on a strict demand, on a `## Deliverables` / `## Prerequisites` line that names one of the record's own in-batch `blocked-by` prerequisites. Examples: "#2670 is actually merged", "merged to/into {integration branch}", "lands on main". The generic "must be merged first" phrasing does not fire, because the shared branch already carries that prerequisite's content ahead of the dependent's build. A `## …` line inside a fenced code block is quoted content, not a section boundary: it neither ends the Deliverables scan nor opens a Prerequisites one (#4369).
- **Red flags:** The flag passed with the claim step's open-queue extras appended; a hardcoded `main` in a repo whose integration branch is something else; a demand after a fenced `## …` line in Deliverables that is not split out.

### 2. Split before claiming — Validation step 4a
- **URL:** `plugin/skills/flow/multispec-merge-gate.md` Procedure steps 2–3
- **Action:** When `mergeGate.deferred` is empty, nothing happens and nothing is written. Otherwise `/flow` continues with `mergeGate.kept` as the run's target list (a single remaining record runs as an ordinary single-record run), and Step 2.8 claims only those.
- **Should feel:** Decisive — the run keeps moving with what can actually be built here.
- **Should understand:** The deferred set is closed over in-batch dependents: a record blocked by a deferred record is deferred too, so no kept record is left blocked by one that left. A deferred record is never claimed, so nothing needs releasing.
- **Red flags:** An `AskUserQuestion` about batch sequencing under default `auto`; a deferred record claimed or labeled `bot:in-progress`.

### 3. Read the audit line and the re-run command
- **URL:** the parent run's `decisions.md` (`## /flow`); the Pipeline Preview footer
- **Action:** After Step 3's Manifesto write, `/flow` appends the `AUTO … — Step 1: merge-state gate split #… out of the run (#{record} requires #{requires…} merged to the integration branch). Re-run after the merge: /claude-tweaks:flow #…` line via `log-decision.js`. The Pipeline Preview prints `Deferred until #{requires…} merge: /claude-tweaks:flow #…`.
- **Should feel:** Like a handoff note — one paste-ready command to run once the prerequisite merges.
- **Should understand:** The re-run covers one layer. If a deferred dependent itself demands a deferred record be merged, the re-run splits again by the same rule.
- **Red flags:** A split with no `decisions.md` line, or a footer with no runnable command.

### 4. When pre-flight itself fails, the run stops before the gate is ever read
- **URL:** `plugin/skills/flow/multispec-merge-gate.md` Procedure step 1; `plugin/skills/flow/multispec-preflight-failure.md`
- **Action:** A non-zero pre-flight exit never reaches this gate. Step 3's ruling settles it first. Exit 1 is retried once, and a second exit 1, or any exit 2, is a STOP before claiming. In a gh-absent sandbox the records come in through `--records-json`, so the gate is evaluated on real record bodies. Under `work-links: native` the gate runs on body-text `blocked-by` only, and Step 3's single `Step 1 native dependency links (skipped)` line records that.
- **Should feel:** Honest — a gate that could not be evaluated stops the run; it never passes as "nothing to defer".
- **Should understand:** The gate keeps no fallback of its own. Everything about a failed pre-flight lives in `multispec-preflight-failure.md`; see `handle-a-failed-multispec-preflight-3351.md`.
- **Red flags:** A run that splits nothing and carries on after a pre-flight failure, or a gate reported as passed when pre-flight exited non-zero.

## Origin
- Created during #2733's build (multi-spec run 2026-10-16T172750-spec-2775-2733-2677): the multi-spec merge-state gate, `merge-gate.js`, and `preflight-records.js --merge-gate --integration-branch`.
- Related: #2682 (the incident batch whose record demanded #2670/#2681 "actually merged"), `respond-to-multispec-boundary-drift.md` (the later, per-boundary freshness check).
- Updated during #3351's build (run 2026-10-17T095806-spec-3351): step 4's "proceed unsplit with a SKIP" fallback was replaced by Step 3's failure ruling (`multispec-preflight-failure.md`).
- Updated during #4369's build (run 2026-10-28T192900-record-4369): the section scan skips heading lines inside fenced blocks (shared `fencedLineMask`, `plugin/bin/lib/issues/record-payload.js`).
