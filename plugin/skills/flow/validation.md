# Pipeline Pre-flight Validation

Loaded by /flow Step 2 when performing pre-flight checks. Each substep returns OK / WARNING (continue with log entry) / BLOCKED (cannot proceed).

Run substeps 2.5, 2.6, and 2.7 in order. Any hard fail or rejection stops the pipeline before the Config Manifesto runs.

> **Parallel execution (conditional):** 2.5's fetch + ahead-count and 2.6/2.7's content scans of the plan file have no cross-dependency in the common all-pass path. When git strategy resolves to `worktree` (so 2.5 applies), dispatch the three substeps' underlying reads as parallel tool calls, then evaluate pass/fail in the documented 2.5→2.7 priority order once all reads return. When git strategy resolves to `current-branch` (2.5 is skipped), run 2.6 and 2.7 sequentially — two reads are not worth parallelizing.

**Bookend note (hybrid mode):** Pre-flight stops at 2.5 and 2.6 may surface in hybrid mode because their decisions have `reversibility: low` (worktree divergence persists, tangled-task risk persists) which fails the hybrid floor. These pre-flight stops are exempt from the "two stops" bookend count — they fire before the Manifesto and protect against starting a pipeline that would otherwise corrupt downstream state. See `_shared/auto-mode-contract.md` for the HARD-GATE exemption list.

## 2.5 — Branch-divergence check

Resolve the `branch-divergence-check` setting — `BRANCH_DIVERGENCE_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values branch-divergence-check)`. When enabled and worktree strategy resolves to `worktree`, run `_shared/worktree-setup.md`'s `## Pre-flight divergence check` — the canonical resolution + fetch + `ahead`-count procedure, consolidated out of what were two byte-identical copies here and in `skills/build/worktree-setup.md` (`[IL-32]`). That section's `AskUserQuestion` and auto-mode handling apply as written there; this step's own log line reads:

```
AUTO {time} — Step 2.5: pre-flight branch-divergence-check — {UPSTREAM} is {N} ahead. Continued and added ops ledger entry. Reversibility: low (divergence persists).
```

> **Base ref:** `/flow` worktrees branch from the current local HEAD via `worktree.baseRef: "head"` (settings.json), and `/build` Common Step 1 unconditionally catches the resulting worktree up with the integration branch after creation regardless of the actual base. See `skills/build/worktree-setup.md` ("Base ref" + Step 4) and `_shared/worktree-setup.md`'s `## Post-creation catch-up` — the harness default `fresh` branches from a possibly-stale `origin/<default-branch>` and the plugin cannot override it through `EnterWorktree`.

> **The reverse direction (local ahead of origin) is handled separately, not here.** This check's own `ahead` computation only measures the behind direction (commits reachable from upstream not yet on HEAD) — it says nothing about local HEAD carrying unpushed commits ahead of `origin/{integration-branch}`, which is this project's normal `worktree.baseRef: head` operating state, not drift. That reverse direction gets its own headless-only stop, at worktree-creation time rather than here: `_shared/worktree-setup.md`'s Post-creation catch-up "Headless ride-along check" (`flow/claim-targets.md`'s "Local-ahead-of-origin ride-along stop", #1780).

**Memo stamp (re-read cut).** When this check runs (worktree strategy resolves to `worktree` and `branch-divergence-check: true`), capture `$UPSTREAM` and `$(git rev-parse "$UPSTREAM" 2>/dev/null)` from the block above. Step 4's `/claude-tweaks:build` invocation carries these forward as `MERGE_CHECK_PASSED=true UPSTREAM_SHA={sha}` so `build/worktree-setup.md`'s own Pre-flight branch-divergence check — otherwise a byte-for-byte re-run of this same fetch-and-compare, moments later, in the freshly created worktree — can trust this run's result instead of repeating it. This is the same conversational context-threading convention already used for `VERIFICATION_PASSED`/`STORIES_DIR`/`DEV_URL` (`SKILL.md` Step 4's "Pass context forward"), not a new file — the value only needs to survive one hop (this step to the `/build` invocation the same orchestrating turn composes), and every consumer of `_shared/pipeline-run-dir.md`'s state already lives in files, which this narrow, single-hop value doesn't need to. When `branch-divergence-check: false` or git strategy is `current-branch`, this step is skipped entirely — nothing to stamp, and `MERGE_CHECK_PASSED` is simply never passed (build's own check runs normally, fail-open).

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
