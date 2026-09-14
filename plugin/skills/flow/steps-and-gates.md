# Flow — Allowed Steps, Step Arguments, and Gate Behavior

This file is the canonical reference for which steps `/flow` allows in its pipeline, how step arguments resolve (resume vs explicit subset), and what each step's gate enforces. SKILL.md points here rather than duplicating these tables.

## Allowed Steps

Only automatable skills can be included in the pipeline:

| Step | Skill invoked | Why it's automatable |
|------|--------------|---------------------|
| `build` | `/claude-tweaks:build` | Fully autonomous — plans, implements, simplifies, verifies. Always uses `subagent` execution. Passes `worktree` through if specified. |
| `stories` | `/claude-tweaks:stories` | Autonomous — browses app, generates YAML stories. Auto-triggered when build produces UI file changes (unless `no-stories`). |
| `test` | `/claude-tweaks:test` | Mechanical pass/fail gate — types, lint, tests, QA story validation. Sets `TEST_PASSED=true` on pass. |
| `review` | `/claude-tweaks:review` | Code review, simplification, visual browser review with idea generation (when browser available) — produces a verdict. Gates on `TEST_PASSED`. |
| `polish` | `/claude-tweaks:design-wrapper polish <spec>` | Invokes Impeccable polish + clarify + harden (the refinement set) plus suggestion-driven commands, each dispatched when an audit finding's own `suggestion` names it. Modifies code. Followed by re-verify (`/test skip-qa`) only when polish modified code — see the polish-phase decision tree below. Gates on review verdict PASS. Skipped on non-frontend specs (wrapper detection) and, since #1926, under `ceremony-profile: fast-lane` — read from the run's `config.yml` before invoking the wrapper, logged `SKIP {time} — polish skipped: fast-lane. Reversibility: n/a.` written with `log-decision.js --status SKIP --section "/flow"` per `_shared/auto-decision-log.md`'s Degrade-trace rule (roster tag `polish`, `_shared/ceremony-profile.md`; `/claude-tweaks:test`'s Design CLI gate and `/claude-tweaks:review` Step 6.5 still run). |
| `wrap-up` | `/claude-tweaks:wrap-up` | Reflection, cleanup, knowledge routing — produces actionable summary |

**Not allowed in flow:** `capture`, `specify`, `init`, `tidy`, `help`, `browse` — these require interactive decision-making or are utility skills.

`re-verify` is **bundled** with `polish` — it is not a separately addressable step. When `polish` runs and modifies code, the re-verify gate runs automatically afterward (`/test skip-qa`, one-cycle cap) — scoped per `test/verification.md`'s re-verify scoping table. Including `re-verify` in a step list is a no-op; treat it as already implied by `polish`.

**Resume-only step `review-console`** — accepted only on multi-spec resume after a Halt at the consolidated console (see `multispec-review-console.md`). Usage: `/claude-tweaks:flow {specs} review-console` re-reads the parent run dir and re-presents the console. Not a normal pipeline step; not valid in a comma-separated step list with other steps.

## Step Arguments

Steps must follow lifecycle order. Invalid orderings are rejected.

| Form | Meaning | Example |
|------|---------|---------|
| No steps | Full pipeline | `/flow 42` → build, test, review, polish, wrap-up |
| Single step | Resume from that step onward | `/flow 42 review` → review, polish, wrap-up |
| Multiple steps (comma-separated) | Run exactly those steps | `/flow 42 review,wrap-up` → review, wrap-up only (skips polish) |

**Resume mode** (single step argument, no comma) assumes all prior steps completed successfully. The pipeline reads existing context (ledger, `TEST_PASSED`, etc.) from files rather than generating it. If prior context is missing (e.g., no ledger file when resuming from review), the pipeline creates fresh context as needed and notes: "No existing ledger found — creating fresh."

**Explicit subset** (comma-separated steps) runs only the listed steps. Context from skipped prior steps is read from files if available.

**Valid examples:**
- `review-console` — valid only on multi-spec resume after a Halt at the consolidated console (re-reads the parent run dir and re-presents the console)
- `build,test,review,polish,wrap-up` — valid (default; stories auto-inserted if UI changed)
- `build,stories,test,review,polish,wrap-up` — valid (stories always runs regardless of UI changes)
- `build,test,review,wrap-up` — valid (skips polish — equivalent to `no-polish`)
- `build,test,review` — valid
- `build,test` — valid
- `test,review,polish,wrap-up` — valid (assumes build is already done)
- `review,polish,wrap-up` — valid (assumes build and test are done)
- `polish,wrap-up` — valid (assumes build, test, and review are done — useful when iterating on polish manually)
- `wrap-up` — valid (assumes build, test, review, and polish are done)
- `stories` (standalone) — valid; assumes build already ran (resume mode reads its output the same as any other single-step resume). Explicit like `build,stories,...`, this skips the UI-change-detection gate — stories runs unconditionally, the same "always runs regardless of UI changes" rule that applies when `stories` is explicit anywhere in the list.
- `stories,test,review,polish,wrap-up` — valid (resume from stories onward; equivalent in effect to leading with `stories` above, then continuing the rest of the pipeline)
- `review,build` — **invalid** (out of order)
- `wrap-up,review` — **invalid** (out of order)

**Intentional two-call consumer:** `/claude-tweaks:dispatch` Step 5 (refs #296) is a deliberate, supported consumer of this resume contract — not an incidental one. It splits one group's pipeline into two sequential `/flow` invocations against the same run: `/flow {target} build,test` (first call, stops after the test gate), then `/flow {target} review,polish,wrap-up` (second call, a fresh Task-tool dispatch with zero conversation history from the first). The two calls share **one** run directory, and the mechanism is the `PIPELINE_RUN_DIR` env var — `_shared/run-dir-resolution.md`'s resolution-order **step 1**, its documented preferred path: dispatch mints the run directory itself, before either call, and passes that same value inline on *both* calls' command lines (see `dispatch/SKILL.md` Step 4 and `dispatch/task-prompt.md`; inline, since a dispatched agent inherits no environment) — there is nothing parsed out of the first call's report to derive it. Spec-slug matching (that file's step 2) is *not* the mechanism and could not be — `/flow` never consults it, always creating and owning a fresh run directory (Step 3) when the env var is unset, which is exactly why passing it is mandatory rather than a convenience. This is the two-call form the `review,polish,wrap-up` example above already covers (`polish,wrap-up` — "useful when iterating on polish manually" is the adjacent precedent for a mid-pipeline resume) — no new step-list grammar is introduced, only a new caller relying on the existing one.

### Adopting an inherited run directory (`PIPELINE_RUN_DIR` already set)

`flow/SKILL.md` Step 3 branches on the `PIPELINE_RUN_DIR` env var **as it stands when the invocation starts**, before any directory is created. Five cases, checked in this order:

**Gather the facts once (#1931).** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/flow-preflight.js" --run "$PIPELINE_RUN_DIR" --steps "{steps}"` — one process writes `{run-dir}/preflight.json`: `adoption` (the case below and its note line, computed by `bin/lib/flow/preflight.js` from the same predicates the cases state — the note literals live there and are rendered here verbatim), `freshness` (`check-resume-freshness`'s verdict and its exact line), `inventory` (`check-staged-inventory`'s status and line), `levers`, `spec`, `pr` (with the phase checklist), `stamp`, and `changedFiles`, each `{ok, value | error}`. Branch on `preflight.adoption.value.case` and print `adoption.value.note` verbatim. **Then, before anything else:** if `freshness.value.verdict === 'BLOCKED'`, report `freshness.value.line` verbatim and stop the pipeline before Step 3 — do not adopt; a pack that was produced is never evidence that adoption is safe. The pack file was still written into the owning session's run directory before that verdict was read — a gitignored, atomically written, diagnostic-only `preflight.json`, and the only write the pack makes; stopping here leaves nothing else behind. If `inventory.value.status === 'MISMATCH'`, note `inventory.value.line` verbatim (non-blocking). An `ok: false` field takes that read's own failure path (a `pr` probe failure is the `gh`-absent MCP/no-forge path; never fabricate checklist state). **A non-zero exit means there is no pack to branch on.** An exit code 3 (nothing written) *is* case 4 — the adoption call passes no `--json`, so an exit 3 here is always the `--run` refusal, never the `--json`-directory one: the CLI refused the `--run` value before writing anything, so there is no `adoption` field to read — print the case-4 note yourself, filling its `{does not exist | is not anchored to the main checkout}` span from the reason the CLI's own stderr names (`missing` → `does not exist`; anything else → `is not anchored to the main checkout`), then take case 5's creation path. An exit code 2 is a malformed invocation — an empty `{steps}` is the usual cause: fix the call and re-run it, never adopt on a code-2 exit. When `PIPELINE_RUN_DIR` is unset the pack is not called — case 5 below creates the run directory as before.

1. **Set, the directory it names exists, resolves under `$RUN_ROOT`, AND already carries `config.yml`** (`_shared/pipeline-run-dir.md`'s Anchoring section: `RUN_ROOT=$(git rev-parse --git-common-dir); RUN_ROOT=$(cd "$(dirname "$RUN_ROOT")" && pwd)` — the adopted path's realpath must be a descendant of `$RUN_ROOT`, never merely inside whatever worktree happens to be cwd) → **adopt it as-is.** The freshness probe (`_shared/run-resume-freshness.md`, `check-resume-freshness`) already ran inside the pack — read `freshness`. This is the gate that protects a `/claude-tweaks:dispatch`-orchestrated two-call handoff (`build,test` then `review,polish,wrap-up` sharing this same directory) from ever being blocked here — see that fragment's own explanation of why the probe structurally reads `not-interrupted`/safe throughout that handoff. A `BLOCKED` result means a live process still holds this run's worktree, or committed to it recently, under a stamp this adoption did not itself just create — report that line verbatim and stop the pipeline before Step 3; do not adopt. The staged-inventory companion (`check-staged-inventory`) ran in the same pack — `inventory`, non-blocking. On `OK`, create no new run directory. Do **not** re-initialize `config.yml` or `decisions.md` — both already exist, written by the invocation that created this run, and overwriting them destroys exactly the auto-decision trail the handoff exists to preserve. Read this run's policy levers from `preflight.levers` (the pack read `config.yml`; never recompute them from the precedence chain), and render the mode's Manifesto behavior (the FYI table in `auto`, the approval gate in `confirm`/`hybrid`) from those values. Note it in the pipeline's output, one line, so the adoption is visible rather than silent:

   `Resuming existing run directory: {path}`

   Everything downstream then resolves this same directory through `_shared/run-dir-resolution.md`'s resolution-order step 1 as usual — Step 3's own export is a re-export of the value it was handed.

2. **Set, the directory it names exists, resolves under `$RUN_ROOT`, has no `config.yml`, AND is otherwise EMPTY** (no `decisions.md`/`events.jsonl` content, no `work/{n}-spec.md` committed on the run's branch) — `adoption.value.hasOtherContent === false` → **adopt the directory's identity, then initialize it as if it were freshly created.** This is the case a minted-but-not-yet-adopted directory hits — `/claude-tweaks:dispatch` Step 4 creates the directory (mkdir only) before claiming, so both of a group's Task calls can be handed the same `PIPELINE_RUN_DIR` value from run start; the *first* call to actually invoke `/flow` against it is the one that turns it into a real run. Create no new directory (the mkdir already happened) — write `config.yml` and initialize `decisions.md` **into this same directory**, exactly as case 5 below does for a from-scratch run, then proceed identically to case 5 from that point on (Manifesto computation, FYI/approval-gate rendering per mode). Note it in the pipeline's output:

   `Adopting minted run directory: {path}`

3. **Set, the directory it names exists, resolves under `$RUN_ROOT`, has no `config.yml`, but already carries other run content** (a non-empty `decisions.md` and/or `events.jsonl`, or a `work/{n}-spec.md` file already committed on the run's branch) → **a prior call's session ended before completing `build/worktree-setup.md` Step 6 (PR-early push + draft PR) and/or `materialize.md`'s spec-materialization commit — recover explicitly, do not treat this like case 2.** — `adoption.value.backfills` names which of the three backfills the note lists. This is the gap #1013 named: a `/claude-tweaks:dispatch`-orchestrated two-call handoff (`build,test` then `review,polish,wrap-up` sharing one `PIPELINE_RUN_DIR`) whose first call ended abnormally mid-`build` leaves exactly this shape — real audit-trail content, but no `config.yml` and no `run-state.json` `worktree`/`pr` fields.

   - Compute this run's policy levers fresh from the precedence chain and write `config.yml` into this directory via the batch form — one `set-config.js --run <dir> --set mode={v},scope-creep={v},...` call carrying the whole lever set, never 13 sequential `--key`/`--value` calls (`manifesto.md`'s Write mechanism section, #1580/#2081) — same as case 5, but **never re-initialize `decisions.md`/`events.jsonl`**: append to whatever content already exists, preserving the interrupted first call's audit trail (case 1's same "do not overwrite" rule, extended here because `config.yml`'s absence is not evidence that nothing happened yet).
   - Check `run-state.json`: if it does not exist, or exists without a `worktree` field, run `record-worktree` now (`build/worktree-setup.md` Step 4.5). If `integration-model: pr-first` and there is no `pr` field, run `_shared/pr-early-run-lifecycle.md`'s push-and-open-draft-PR procedure now, before proceeding.
   - Check whether `work/{n}-spec.md` is committed on the run's branch (`materialize.md`'s "When this runs"); if not, invoke `bin/materialize.js <n> --run-dir <dir>` now (`gh`-present) — or, in a `gh`-absent sandbox, fetch the record via MCP `issue_read` and invoke `bin/materialize.js <n> --record-json <file> --run-dir <dir>` (`materialize.md`'s `--record-json` paragraph, #1459) — then commit the written `work/{n}-spec.md`, before proceeding to whichever step this call was actually asked to run. Neither path hand-composes the header/file by any other means.

   Note it in the pipeline's output:

   `Recovering inherited run directory: {path} (missing config.yml; backfilled {worktree registration | PR-early lifecycle | materialize commit} before proceeding).`

4. **Set, but the directory does not exist, OR it exists but does not resolve under `$RUN_ROOT`** (e.g. it points inside a linked worktree instead of the main checkout — the shape `[IL-127]` recorded) → stale/unanchored value: fall through to case 5's creation path, and note the discrepancy rather than silently ignoring that a value was supplied and turned out wrong:

   `PIPELINE_RUN_DIR was set to {path}, which {does not exist | is not anchored to the main checkout} — created a fresh run directory instead.`

5. **Unset** → existing behavior, unchanged: create `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` — via `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "{spec-slug}" --create`, never by composing `$RUN_ROOT` from the current directory (`_shared/pipeline-run-dir.md`'s Anchoring section — this creation can run from inside a worktree; see `manifesto.md`'s Path conventions) — write `config.yml`, initialize `decisions.md`, export the printed path.

The distinction between case 1 and cases 2/3 is `adoption.value.hasConfig`; the distinction between case 2 and case 3 is `adoption.value.hasOtherContent` — `config.yml`'s absence alone is not evidence that nothing has happened yet (case 3 is exactly the counterexample).

**Writing into cases 1 or 3's inherited directory from inside a worktree session (#1457).** Every write these cases make — `config.yml`, `decisions.md`, `run-state.json` — targets the anchored main-checkout path (`_shared/pipeline-run-dir.md`'s Anchoring section), never a worktree-local copy: an ordinary run doesn't have one (only `*-tidy-standalone*`/`*-sweep-standalone*` runs do, per that section's own exceptions). If an Edit/Write/NotebookEdit attempt against that path is refused because this session is pinned to a worktree, do not go looking for a worktree copy to edit instead — there isn't one to find. Use the sanctioned run-dir writers, which resolve the anchored path directly and are not subject to that refusal: `bin/log-decision.js` for `decisions.md`, `bin/stage-item.js` for `staged/`, `bin/set-config.js` for `config.yml`, and `record-worktree`/`close-run` for `run-state.json` — see `_shared/pipeline-run-dir.md`'s "hook-level exemption above is necessary but not sufficient" paragraph.

`/claude-tweaks:dispatch` Step 4 mints the directory case 2 adopts, before either Task call runs — both of a group's two Task calls (per `dispatch/task-prompt.md`) receive that same minted `PIPELINE_RUN_DIR` value directly on their command line; there is no longer a `MANIFEST:` line parsed out of the first call's report to derive it, and the earlier per-firing run-identity variable that bridged the two is gone with it — see `_shared/issue-claims.md`'s Identity section. A multi-spec run adopts the directory it is handed as the parent and still sub-namespaces `spec-{N}/` beneath it (`multi-spec.md`), exporting the per-spec subdirectory downstream exactly as a self-created parent would.

### Partial step lists — what Step 5 does when `wrap-up` is absent

`flow/SKILL.md`'s Step 5 (Present Pipeline Summary) runs after whichever steps were requested, including a subset that stops short of `wrap-up`. **Everything in that step is conditional on `wrap-up` being in the resolved step list.** This is a general rule about partial step lists, not a special case for `/dispatch` or any other caller.

When `wrap-up` is absent — `build,test`, `build,test,review`, `review` alone, any subset ending short of it — skip **all** of Step 5's normal content: the nothing-left-behind ledger gate, the Creative Opportunities survey, the Depth Opportunities survey, and the full Pipeline Summary template. Two reasons, both structural:

- **The run is deliberately unfinished.** Rendering "Pipeline Complete" and resolving the ledger would assert a completion that has not happened.
- **The ledger gate is un-answerable there.** It is not silenced by `auto` mode (`_shared/auto-mode-contract.md`'s "what auto never silences" list) and requires per-item resolution, so firing it mid-pipeline in a headless run — a scheduled `/claude-tweaks:dispatch next` firing has nobody present — is exactly the new mid-flow `auto` stop CLAUDE.md's Don'ts forbid.

Ledger items simply stay `open` in the ledger *file*, a durable artifact by design, for whichever later invocation does include `wrap-up` to resolve. Nothing is silenced or dropped: only *when* the gate runs moves, onto the step list that reaches the step where resolution actually happens — which is what `_shared/ledger-format.md`'s Resolve Gate section already assumes. Render this instead of everything else in Step 5:

```markdown
## Flow: Steps Complete

Steps {resolved step list} complete for {spec/record}. This run is not finished — `wrap-up` was not in the step list, so the nothing-left-behind gate, the Creative/Depth surveys, and the Pipeline Summary are deferred to the invocation that includes it.

{N} ledger item(s) remain open, held in the ledger file for that later invocation.
Run directory: {PIPELINE_RUN_DIR}
```

Carrying `PIPELINE_RUN_DIR` in that note is load-bearing for any caller resuming this run: the resuming invocation must be handed this same directory (`_shared/run-dir-resolution.md`'s resolution-order step 1), because a bare `/flow` invocation always creates a new one rather than finding this one.

**`cleanup-only` produces this same branch even when `wrap-up` IS in the step list (#298).** The condition above is "`wrap-up` absent OR `cleanup-only` set" — not "`wrap-up` absent," full stop. A `/flow {target} wrap-up cleanup-only` invocation runs `wrap-up` in `cleanup-only` mode specifically to reach `cleanup-procedures.md`'s worktree/branch/claim teardown (`[IL-116]` forbids any other route) without dragging in Phase 1-4's reflection/routing/settle content or Step 5's un-answerable nothing-left-behind ledger gate — this Step 5 gate is what this flag was originally built to skip. `/claude-tweaks:dispatch`'s own teardown call (`skills/dispatch/two-call-gate.md` §5) no longer routes through `/flow` for this — it invokes `/claude-tweaks:wrap-up {target} cleanup-only` directly, since #1766 found this Step 5 exception insufficient on its own: Step 1.5's materialize gate, upstream of Step 5, has no matching `cleanup-only` exception, so a `/flow`-routed teardown of a materialize-gate-originated failure never reached this branch at all. Do not conclude the ledger gate fires just because `wrap-up` ran this time — under `cleanup-only` it does not: render the identical `## Flow: Steps Complete` note above (ledger items stay `open`, Creative/Depth surveys skipped, no Pipeline Summary) even though `wrap-up` is present. A normal `/flow {target} wrap-up` call (no `cleanup-only`) is unaffected — this branch is additive to the existing `wrap-up`-absent condition, not a rewrite of it.

**Auto-insert `test`:** If `review` is in the step list but `test` is not, auto-insert `test` before `review` and note: "Auto-inserted `test` before `review` — review gates on test passing." This ensures backward compatibility.

**Polish bundled with re-verify:** If `polish` is in the step list, the re-verify gate runs automatically when polish modifies code. Users do not need to add a separate `re-verify` step. If a user includes the literal `re-verify` in the step list, treat it as a no-op (already bundled with polish) and note: "`re-verify` is bundled with `polish` — no separate step needed."

**Re-verify scoping:** every in-pipeline re-verify — the auto-inserted `test`, the polish re-verify, the review-fix re-verify, and a multi-spec spec-N `test` step — runs scoped against the last full pass per `test/verification.md`'s "Re-verify scoping" table. `/flow` states this once here and does not restate the rule.

**`no-polish` argument behavior:** When `no-polish` is set, the polish phase (and its re-verify gate) is removed from the pipeline. The default pipeline becomes `build,test,review,wrap-up` (the pre-Phase-2 default). `no-polish` overrides any explicit `polish` in the step list — the user's explicit step request wins on the rest of the pipeline, but polish is unconditionally dropped.

### Record-reference input (`#<n>`)

Not a step — an alternative *record source*, resolved before Step 1 via
`materialize.md`'s Resolution + Materialization hard gate (in this skill's
directory). Used primarily by `/claude-tweaks:dispatch`'s hand-off
(`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{n}[,#{m}...]`) —
a human can also run it directly against any record carrying no live claim. A record
reaching `/flow` already arrives spec-shaped (`ready` + spec-shaped body per
`_shared/work-record.md`), so `materialize.md` resolves it directly and
writes `{run-dir}/work/{n}-spec.md` — no derivation pre-step runs first. A
single record then runs the normal step pipeline
(`build,test,review,polish,wrap-up`) against that file — the step pipeline
and gates below are unchanged. Multiple
records (`#A,#B`) run Multi-spec mode instead (see `multi-spec.md`), each
materializing to its own file. `/flow` performs no selection or filtering of
its own; see `/claude-tweaks:dispatch` (selection) and `/claude-tweaks:backlog
refine` (authorization) for that logic. `/flow` does claim its own named
targets at Step 2.8 (`claim-targets.md`), whether the invocation came from
dispatch's hand-off or a human running `/flow #{n}` directly against any
record carrying no live claim.

## Gate Behavior

Each step has a gate that determines whether to proceed to the next step.

| Step | Gate condition | On pass | On failure |
|------|---------------|---------|-----------|
| `build` | Final verification passes (type check + lint + tests) | Check for UI changes → auto-trigger stories if applicable → proceed | **STOP** — present verification failures |
| `stories` (auto) | YAML files created + no parse errors | Proceed to test | **STOP** — present generation failures |
| `test` | All checks pass — types, lint, tests, QA (when stories exist). `PASS_WITH_CAVEATS` counts as passed (caveats are informational). Sets `TEST_PASSED=true`. | Proceed to review | **STOP** — present test/QA failures |
| `review` | Verdict is **PASS**. Gates on `TEST_PASSED=true`. Runs in full mode (code + visual) when browser available; falls back to code mode otherwise. | Proceed to polish (or wrap-up if `no-polish`) | **STOP** — present **BLOCKED** verdict with findings |
| `polish` | Wrapper returns `{result: "ok"}`. Acceptable returns include `commands_invoked: []` (no refinement set applicable, no audit finding named a dispatchable command — no work to do) and `{skipped: ...}` (non-frontend, no Impeccable, integration disabled). | See the polish-phase decision tree below. | **STOP** — wrapper returned an error (rare; usually means Impeccable plugin crashed mid-dispatch). Present the error. |
| `re-verify` (bundled with polish) | `/test skip-qa` passes (types + lint + tests). | Proceed to wrap-up | **STOP** — present "Polish broke verification" failure card. One-cycle cap — no automatic retry. |
| `wrap-up` | Always passes | Pipeline complete | — |

**Zero-test edge case:** If no test commands are configured in CLAUDE.md and no QA stories exist, the test gate passes vacuously — there is nothing to fail. Note in the pipeline output: "Test gate: no checks configured. Consider adding test commands to CLAUDE.md." This is a pass, not a skip.

### Polish-phase decision tree

This is the canonical rendering of the polish-phase branch logic. The gate-behavior row for `polish` (above) and the Step 4 polish-execution prose in SKILL.md both point here.

```
Polish phase entry (after review PASS, no-polish not set, ceremony-profile not fast-lane — a fast-lane run logs the polish SKIP, removes the polish PR row, and proceeds to wrap-up)
    │
    ▼
Invoke /claude-tweaks:design-wrapper polish <spec>
    │
    ├─ {skipped: ...}                  → Note skip in summary, proceed to wrap-up (no re-verify)
    │
    ├─ {result: "ok", commands_invoked: []}
    │                                   → Note "polish: no work to do", proceed to wrap-up (no re-verify)
    │
    └─ {result: "ok", commands_invoked: [...], files_modified: [...]}
                                        → Run re-verify gate (`/claude-tweaks:test skip-qa`)
                                              │
                                              ├─ Pass  → Proceed to wrap-up
                                              └─ Fail  → STOP — "Polish broke verification" card
```

**Re-verify one-cycle cap:** The re-verify gate runs at most once per flow run. The pipeline tracks this with an in-memory marker (`re_verify_ran: true` in pipeline state — same in-memory marker pattern as `/claude-tweaks:design-wrapper`'s availability skip de-dupe). If polish modifies code and re-verify fails, the pipeline stops; it does not retry polish. The user resolves the failure (typically by reverting the polish commit or fixing the underlying issue) and resumes with `/claude-tweaks:flow {spec} polish` to re-attempt polish + re-verify in a fresh flow run (which resets the marker).

**Why the cap exists:** Without it, polish could oscillate (polish modifies code → re-verify fails → user fixes → re-runs polish → polish modifies again → re-verify fails again). The single-cycle cap makes the failure mode predictable: one polish attempt, one re-verify attempt, success or stop.

**Phase exit (`worktree` mode, `integration-model: pr-first` — `_shared/integration-model.md`):** on every "Proceed to wrap-up" arrow above (skipped, no-work, or modified-and-passed) — push the branch and flip this phase's PR checklist row — `_shared/git-discipline.md`'s Phase-exit push section and `_shared/pr-checklist-refresh.md`'s Phase-checklist update section. A no-op under `local-merge` or `current-branch` mode. The row is omitted at PR creation only for a backend `surface:` (that file's checklist composition rule), so there is nothing to flip on that path; a `no-polish` or `ceremony-profile: fast-lane` run gets the row unchecked and removes it at polish's would-be exit (that file's skipped-phase rule), with no phase-exit push — nothing landed.
