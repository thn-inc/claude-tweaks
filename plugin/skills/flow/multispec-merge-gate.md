# Multi-Spec — Merge-State Gate (#2733)

Loaded by `multi-spec.md`'s Validation step 4a, after dependency-aware ordering and before Step 2.8's claim.

## Decision

A target whose own `## Deliverables` or `## Prerequisites` text demands that one of its **in-run** `blocked-by` prerequisites already be **merged into the integration branch** cannot be satisfied inside a multi-spec run: every spec commits into one shared, unmerged branch, so that prerequisite is built there, never merged, before the dependent's build reads the demand. `/flow` therefore resolves the case itself — it never calls `AskUserQuestion` for it, in any mode — by splitting the target, and every in-run record that transitively depends on it, out of this run. The decision is derivable from record text, which is `_shared/auto-mode-contract.md`'s bar for resolving rather than asking.

Not split: the generic content-dependency phrasings — "must be merged first", "until #N is merged", "merged into this leaf's build base". Inside the shared branch the prerequisite's content lands ahead of the dependent's build, which is what those records need, and their builds re-verify by content. Splitting them would make decomposition families — multi-spec's main use — unrunnable as a batch.

Evidence (2087-record corpus, 2026-10-16): any ref-plus-"merged" line matched 75 records (state literals, titles, residue rows); merge-requirement verb forms 40, mostly decomposition-family rows; the strict class below 6, five genuine once restricted to in-run blockers — #2682 (the incident: "confirm #2670 and #2681 are actually merged (not merely CLOSED)"), #1989, #2466, #530, #595.

## Signal

`plugin/bin/lib/preflight-records/merge-gate.js`'s `buildMergeStateRe(integrationBranch)` (default `main`, exported module-level as `MERGE_STATE_RE`) — "actually merged", or "merge(s/d) to/into" / "land(s/ed) on/in/into" the resolved integration branch, optionally with `origin/`, backticks, a leading "the" or a trailing "branch", or "the integration branch" — on a line inside the target's `## Deliverables` or `## Prerequisites` section that names one of the target's own `blocked-by` prerequisites that is also in this run.

The phrase and the `#N` must be on the same line. A wrapped bullet, or a demand naming no ref, is not detected — the target's own build-time premise check catches it. The re-run command covers one layer: if a deferred dependent itself demands a deferred record be merged, the re-run splits again by the same rule.

## Procedure

1. Read `mergeGate` off Validation Step 3's own `preflight-records.js --merge-gate --integration-branch "$INTEGRATION_BRANCH"` call (`multi-spec.md` Step 3) — never a second invocation.

   If that call exited non-zero (1 = a fetch or the native GraphQL call failed, including a gh-absent sandbox; 2 = malformed invocation), the gate was not evaluated — this is never read as "nothing to defer." Proceed with the full target list, and once the parent run directory exists (after Step 3's Manifesto write), write one `SKIP` entry:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 1 merge-state gate (skipped)" --text "condition: preflight-records.js --merge-gate exited non-zero ({stderr reason}) → fallback: proceed with the full target list, no split; each target's own build-time premise check is the backstop." --reversibility n/a
   ```
   Stop here — do not continue to steps 2-4.
2. `mergeGate.deferred` empty → no-op, write nothing.
3. Otherwise, before Step 2.8 claims anything: continue with `kept` as the run's target list (one remaining record → an ordinary single-record run). Once the parent run directory exists (after Step 3's Manifesto write), write one `AUTO` entry:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status AUTO --step "Step 1" --reversibility high --text "merge-state gate split #{deferred…} out of the run (#{record} requires #{requires…} merged to the integration branch). Re-run after the merge: {rerun}"
   ```
4. Print the same re-run command as a Pipeline Preview footer line: `Deferred until #{requires…} merge: {rerun}`.

Multi-spec `$PIPELINE_RUN_DIR` here is the **parent** run dir, which `/flow` sets before scaffolding any `spec-{N}/`.

A deferred record is never claimed, so nothing needs releasing.
