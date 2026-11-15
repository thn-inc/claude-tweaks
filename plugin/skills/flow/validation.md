# Pipeline Pre-flight Validation

Loaded by /flow Step 2 when performing pre-flight checks. Each substep returns OK / WARNING (continue with log entry) / BLOCKED (cannot proceed).

Run substeps 2.5, 2.6, 2.7, and 2.7b in order. Any hard fail or rejection stops the pipeline before the Config Manifesto runs.

**Ledger-bound notes (#3036).** Under the `worktree` strategy the open-items ledger does not exist yet at this step — every "ops ledger entry" below is logged to `decisions.md` now and appended to the ledger as an `ops` row by whichever step creates it (`build/worktree-setup.md` Step 4.6, or `multi-spec.md`'s "Shared worktree" step 1 — the creation points `SKILL.md` Step 1 item 8 names). Under `current-branch`, Step 1 already created the ledger — write the entry directly.

> **Parallel execution (conditional):** 2.5's fetch + ahead-count and 2.6/2.7's content scans of the plan file have no cross-dependency in the common all-pass path. When git strategy resolves to `worktree` (so 2.5 applies), dispatch the three substeps' underlying reads as parallel tool calls, then evaluate pass/fail in the documented 2.5→2.7 priority order once all reads return. When git strategy resolves to `current-branch` (2.5 is skipped), run 2.6 and 2.7 sequentially — two reads are not worth parallelizing.

**Bookend note (hybrid mode):** Pre-flight stops at 2.5 and 2.6 may surface in hybrid mode because their decisions have `reversibility: low` (worktree divergence persists, tangled-task risk persists) which fails the hybrid floor. These pre-flight stops are exempt from the "two stops" bookend count — they fire before the Manifesto and protect against starting a pipeline that would otherwise corrupt downstream state. See `_shared/auto-mode-contract.md` for the HARD-GATE exemption list.

## 2.5 — Branch-divergence check

Resolve the `branch-divergence-check` setting — `BRANCH_DIVERGENCE_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values branch-divergence-check)`. When enabled and worktree strategy resolves to `worktree`, run `_shared/worktree-setup.md`'s `## Pre-flight divergence check` — the canonical resolution + fetch + `ahead`-count procedure, consolidated out of what were two byte-identical copies here and in `skills/build/worktree-setup.md` (`[IL-32]`). That section's `AskUserQuestion` and auto-mode handling apply as written there; this step's own log line reads:

```
AUTO {time} — Step 2.5: pre-flight branch-divergence-check — {UPSTREAM} is {N} ahead. Continued; ops entry held for the open-items ledger. Reversibility: low (divergence persists).
```

> **Base ref:** `/flow` worktrees branch from the current local HEAD via `worktree.baseRef: "head"` (settings.json), and `/build` Common Step 1 unconditionally catches the resulting worktree up with the integration branch after creation regardless of the actual base. See `skills/build/worktree-setup.md` ("Base ref" + Step 4) and `_shared/worktree-setup.md`'s `## Post-creation catch-up` — the harness default `fresh` branches from a possibly-stale `origin/<default-branch>` and the plugin cannot override it through `EnterWorktree`.

> **The reverse direction (local ahead of origin) is handled separately, not here.** This check's own `ahead` computation only measures the behind direction (commits reachable from upstream not yet on HEAD) — it says nothing about local HEAD carrying unpushed commits ahead of `origin/{integration-branch}`, which is this project's normal `worktree.baseRef: head` operating state, not drift. That reverse direction gets its own headless-only stop, at worktree-creation time rather than here: `_shared/worktree-setup.md`'s Post-creation catch-up "Headless ride-along check" (`flow/claim-targets.md`'s "Local-ahead-of-origin ride-along stop", #1780).

**Memo stamp (re-read cut).** When this check runs (worktree strategy resolves to `worktree` and `branch-divergence-check: true`), capture `{UPSTREAM}` from the procedure above and the sha `git rev-parse {UPSTREAM}` prints, run as its own call. Step 4's `/claude-tweaks:build` invocation carries these forward as `MERGE_CHECK_PASSED=true UPSTREAM_SHA={sha}` so `build/worktree-setup.md`'s own Pre-flight branch-divergence check — otherwise a byte-for-byte re-run of this same fetch-and-compare, moments later, in the freshly created worktree — can trust this run's result instead of repeating it. This is the same conversational context-threading convention already used for `VERIFICATION_PASSED`/`STORIES_DIR`/`DEV_URL` (`SKILL.md` Step 4's "Pass context forward"), not a new file — the value only needs to survive one hop (this step to the `/build` invocation the same orchestrating turn composes), and every consumer of `_shared/pipeline-run-dir.md`'s state already lives in files, which this narrow, single-hop value doesn't need to. When `branch-divergence-check: false` or git strategy is `current-branch`, this step is skipped entirely — nothing to stamp, and `MERGE_CHECK_PASSED` is simply never passed (build's own check runs normally, fail-open).

## 2.6 — Shape check (structural coupling)

Replaces the previous size-based scope check. Plan size (line count, file count, task count) is **not** a stop signal — a clean 50-task spec is mechanically simpler than a tangled 5-task spec. What matters is structural coupling between tasks. Apply these structural signals before starting:

**Hard fails** (block the pipeline; surface to user):

| Signal | Detection | Why it blocks |
|---|---|---|
| Cross-task dependency chains > 3 deep | Trace `depends-on:` / "after Task N" / "uses Task N output" references | Tasks aren't independently executable; subagent-driven execution requires loose coupling |
| Task references files outside its declared "Files:" block | For each task, compare in-task file mentions against its declared file list | Spec leaks scope — tasks will collide on files the plan didn't anticipate |
| A single task touches > 5 files | Count files in each task's "Files:" block | Task is itself too large; should be sub-decomposed before dispatch |
| Plan has no "Files:" or "Tasks:" structure at all | Look for canonical headings | Input is a design doc, not an executable spec — see Step 2.7 |

**Soft warnings** (proceed by default; note in ledger):

| Signal | Threshold | Note added to ledger |
|---|---|---|
| Task count > 30 | Count `^### Task \d` / `^## Task \d` headings | "Large dispatch count: {N} subagents — may benefit from `/specify` split if review fails" |
| Plan describes a major version bump | Scan for `v{N}.0.0` or `vMAJOR` in the design context | "Major version bump — review will scrutinize backward-compat implications" |

**Behavior:**

- **Hard fail** → present the specific signal, then call `AskUserQuestion`:
  - `question`: `"{signal} was detected — how do you want to proceed?"`, `header`: `"Shape check"`, `multiSelect`: `false`
  - Option 1 — `label`: `"Tighten via /specify (Recommended)"`, `description`: `"Run /claude-tweaks:specify {plan-path} to decompose before continuing"`
  - Option 2 — `label`: `"Proceed anyway"`, `description`: `"Accept tangled-task risk and continue"`
  - Option 3 — `label`: `"Cancel"`, `description`: `"Stop the pipeline"`
  Under `auto`, choose option 2 and add an `ops` ledger entry naming the specific signal hit.
- **Soft warning** → proceed by default. Add an `ops` ledger entry with the warning text. Do NOT prompt the user. Under `auto` or in default mode, behavior is identical (silent proceed with ledger note).

**Anti-pattern:** Stopping the pipeline because the plan is "big." Size is not a coupling signal. See `_shared/auto-mode-contract.md` — the model is forbidden under `auto` from inserting size-driven reality-checks beyond what this step prescribes.

## 2.7 — Design-doc rejection (granularity contract)

A design doc is strategic (multi-phase, scopes the program); a spec is executional (agent-sized, /flow-runnable). `/flow` accepts specs only.

Detection: if the input is a design doc (filename matches `*-design.md` OR file contains `## Phase` / `## Phases` section headings OR file lacks both "Files:" and "Tasks:" canonical structure):
```
Input is a design doc, not a spec. /flow executes specs.

Decompose first:
  /claude-tweaks:specify {input-path}                — produces all phase specs
  /claude-tweaks:specify {input-path} phase-{N}      — produces specs for one phase
Then /flow on the produced specs:
  /claude-tweaks:flow {N},{M},{P}                    — sequential execution
```
Stop the pipeline with this message. **Do not** silently proceed — the design-mode escape hatch was the source of the wrong-granularity bug. Under `auto`, this rejection still fires (it's a hard validation failure, not a UX preference — see `_shared/auto-mode-card.md`).

## 2.7b — Blocker landing (single-record)

A closed prerequisite is not enough — its closing commit must have reached `origin/{integration-branch}`, or the run builds on code the integration branch never received (#4553). This substep covers a run invoked with one record target only; a run invoked with several — even one the merge-state gate splits down to a single record — gets the same verdicts from `multi-spec.md` Validation step 3's call and never runs 2.7b. It runs after 2.7, ahead of Step 2.8's claim, in this order:

1. **`work-backend: local-files`** — skip the substep entirely, the way Step 2.8 skips itself: no `preflight-records.js` call and no log line. This is the first check, ahead of every `work-links` branch.
2. **An unresolved topic name (no record number), or a step list with neither `build` nor `test`** — Step 2.8's own skip conditions (a `review,polish,wrap-up` resume, a `/claude-tweaks:dispatch` second call included, has already built): skip with no call and no log line.
3. **Read `work-links`** (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links`). Under `body-text`, when Step 1 item 5's `materialize.js --check` envelope reported `bodyBlockedBy: []`, the substep is a no-op — no `preflight-records.js` call. Under `native` the call always runs: it is how native links are read.
4. **Call.** Resolve `$INTEGRATION_BRANCH` per `_shared/integration-branch.md`, then run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"
   ```
   With `gh` absent add `--records-json {file}` per `multispec-preflight-failure.md`'s Transport paragraph, then follow its `**Blocker landing.**` paragraph's `--blocker-states-json` re-run, so an open blocker still stops.
5. **Exit code.** A non-zero exit is handled per `multispec-preflight-failure.md`'s Exit 1 and Exit 2 paragraphs: re-run once on exit 1, then a STOP before claiming quoting stderr; exit 2 is a STOP at once. Decide on the exit code and the `preflight-records.js:` line — `gh`'s own stderr can precede it, so never assume stderr is one line or empty. A non-zero exit is never read as "no blockers".
6. **Read the envelope.** When the envelope carries `nativeLinksUnchecked: true` (native blocked-by links went unread under `--records-json`), hold one `SKIP` — it is never "no blockers":
   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 2 blocker landing (native links unchecked)" --text "condition: blocker landing ran under --records-json with work-links: native — native blocked-by links unread → fallback: only body-text blockers judged" --reversibility n/a
   ```
   Then apply `multispec-dependency-ordering.md`'s out-of-run verdict table to every entry of `records["{n}"].blockerLanding`, whether or not that flag is set (`blockerLanding: []` → no-op; the body-text blockers the CLI still judged can be `open`): `open` or `unlanded` is BLOCKED — a STOP before Step 2.8 claims (nothing to tear down; render that file's stop card for `unlanded`); `undetermined` proceeds, holding that file's per-blocker `SKIP`; every other verdict is as the table says.
7. **Write the held `SKIP`s, exactly once.** Every `SKIP` this substep holds is written once the run directory carries more than Step 2.8's claim lines legitimately — on Step 2.9's express route (which never reaches Step 3), right after `express-entry.md`'s Bind step, and not again if an express-escalated run continues at Step 3; on every other route right after Step 3's Manifesto write or adoption (any case) — never before: Step 3's adoption tolerates only Step 2.8's claim lines in `decisions.md`. Under `interactive` mode no Manifesto runs (`mode-table.md`), so `decisions.md` never legitimately carries more than Step 2.8's claim lines; 2.7b writes none and instead states each `undetermined` verdict, and the native-links-unread note, in the conversation, one line each.
