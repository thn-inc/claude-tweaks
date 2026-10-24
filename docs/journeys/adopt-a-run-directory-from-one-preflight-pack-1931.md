---
files:
  - plugin/bin/lib/flow/preflight.js
  - plugin/bin/lib/run-header.js
  - plugin/bin/flow-preflight.js
  - plugin/bin/lib/log-decision/claim-log.js
  - plugin/skills/flow/steps-and-gates.md
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/SKILL.md
  - plugin/skills/_shared/git-discipline.md
  - tests/bin-lib/flow/preflight.test.js
  - tests/bin-lib/flow/preflight-cli.test.js
  - tests/flow-preflight-conformance.test.js
---

# Adopt a Run Directory From One Preflight Pack

**Persona:** the agent session running `/claude-tweaks:flow` as the second Task call of a `/claude-tweaks:dispatch` handoff (`review,polish,wrap-up` against a run directory the first call created) — an internal tooling user — and a maintainer reading `preflight.json` afterwards to see what the second call knew when it adopted the run.
**Goal:** replace a chain of separately-narrated reads (run-dir adoption cases, the resume-freshness probe, the staged-inventory check, the Manifesto levers, the materialized spec, the PR and its phase checklist, the runner stamp, the changed-file set — each its own tool call with a reasoning turn between) with one `flow-preflight.js` call whose JSON `steps-and-gates.md` branches on and `manifesto.md` renders from; and make the five adoption note lines live in one place.
**Entry point:** `PIPELINE_RUN_DIR` is set on entry and `flow/SKILL.md` Step 3 reaches `steps-and-gates.md`'s "Adopting an inherited run directory".
**Success state:** `{run-dir}/preflight.json` exists with `adoption`, `freshness`, `inventory`, `levers`, `spec`, `pr`, `stamp`, and `changedFiles` envelopes, exit code `0`; the adoption note printed matches the case's literal; a `BLOCKED` freshness verdict stopped the pipeline before Step 3 with the probe's own line; an open run PR reading `CONFLICTING` printed `pr.value.conflictNote` before any later phase and was caught up, or stopped as a HARD-GATE naming the conflicting paths; the `### Pipeline Config (auto)` table's values came from `preflight.levers`.

## Steps

### 1. Run the pack once, before branching on the adoption case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/flow-preflight.js" --run "$PIPELINE_RUN_DIR" --steps "{steps}"`
- **Action:** Invoke it where the adoption section places it; branch on `adoption.value.case` and print `adoption.value.note` verbatim.
- **Should feel:** The 24 minutes the second call once spent before review's first judgment collapse into one process; the five case descriptions are still the contract, but their probe commands are field reads.
- **Should understand:** `--steps` is metadata (echoed in the pack); every field is computed regardless. The adoption case is computed by `bin/lib/flow/preflight.js` from the same predicates the prose states — anchored under `$RUN_ROOT`, `config.yml` present, other run content present (a `decisions.md` holding only Step 2.8's own claim-log lines — its claim, canonical or a complete claim-anchored paraphrase, plus its file-overlap / `bot:in-progress` projection notes — is not run content — `/flow` logs them before this pack runs, and `bin/lib/log-decision/claim-log.js` owns those line shapes, #2861, #3665; and a dispatched first call whose `run-state.json` reads `dispatched: true` with no `pr` and no `config.yml` is case 2 whatever else `decisions.md` already holds — its Step 1.8 ledger line lands before Step 3, while a recorded `pr` keeps the #3226 call-2 repair in case 3, #3242), `work/*-spec.md` committed on the run's branch as seen from the main checkout's git — and its four note literals are constants there; `steps-and-gates.md` renders them and `tests/flow-preflight-conformance.test.js` pins the two equal. Case 5 (unset) has no note and never calls the pack. Exit `0` means a pack was produced; `2` malformed (an empty `{steps}` — fix the call, never adopt); `3` means `--run` (or `--json`'s directory) is missing or not anchored under the main checkout, nothing written — that IS case 4: print its note with the reason the CLI's stderr names and take case 5's creation path. On a multi-spec parent the pack reads the headers under `spec-*/work/` (`spec.value.records`). Since #3974 the `spec` probe and the committed-on-branch check both resolve the header through `bin/lib/run-header.js`, at its live path first and then under `.claude-tweaks/pipelines/archive/{run-id}/`, so a run whose header was archived on its branch still reports `spec.value.present: true`.
- **Red flags:** A note line that differs from the constant by a word (the pin fails); a case-3 note whose backfill list names something `run-state.json` already carries; a case-3 note on a directory that was minted and claimed moments ago (#2861 — its `decisions.md` holds something the claim-log parser did not recognise, so read the file before trusting the recovery); a case-3 note, with `PR-early lifecycle` and `materialize commit` backfills, on a dispatched call 1 whose `run-state.json` reads `dispatched: true` and no `pr` (#3242 — that call is fresh, and nothing it names is actually missing yet); a pack written on a `BLOCKED` verdict is normal (a gitignored, diagnostic-only file — the pack's only write) but adoption after it is not.

### 2. Read the freshness verdict before adopting — a produced pack is not permission
- **URL:** `jq .freshness "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** If `freshness.value.verdict === 'BLOCKED'`, report `freshness.value.line` verbatim and stop the pipeline before Step 3; if `inventory.value.status === 'MISMATCH'`, note `inventory.value.line` (non-blocking).
- **Should feel:** The same gate as before, with the same words — the pack carries the verdict, the skill still stops.
- **Should understand:** `freshness.value.line` and `inventory.value.line` are byte-for-byte the lines `hooks.js check-resume-freshness` and `check-staged-inventory` print; `detail` carries the probe's own verdict word (`not-interrupted`, `own-session`, …). `BLOCKED` is data, never an exit code — the conformance test pins that the prose's check-and-stop follows the call.
- **Red flags:** A run adopted while `freshness.value.verdict` reads `BLOCKED`; an adoption note printed before the freshness read.

### 3. Render the Manifesto FYI from the pack's levers
- **URL:** `plugin/skills/flow/manifesto.md` "Present the Manifesto"; `jq .levers "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** Fill the `### Pipeline Config (auto)` table from `preflight.levers` (`value` + `source`) and lever 1 from the pack's `mode`; do not re-resolve levers.
- **Should feel:** Twelve values and their sources arrive together, in the resolver's own vocabulary — a case-1 adoption only; cases 2 and 5 compute the levers fresh and write `config.yml` as before. Case 3 (#1826) prefers `decisions.md`'s "Pipeline config snapshot" header as the lever source when it is present and parses, falling back to computing fresh from the precedence chain only when that header is absent or unparseable.
- **Should understand:** A lever present in the adopted `config.yml` carries `source: run-config`; one absent from it resolves from `policy.yml` (`policy`) or the schema default (`default`), with the same derived defaults `resolve-policy.js` applies (`merge-verification`, `integration-model`); `ceremony-profile`'s source is `header` — it is a Manifesto fold, not a policy key, so the pack reads it from `config.yml`. A lever that failed to resolve carries `error` and renders as `unresolved`, never guessed.
- **Red flags:** A `resolve-policy.js` call for a lever the pack already carries; a `source` value outside the resolver's vocabulary.

### 4. Read the rest of the second call's facts from their fields
- **URL:** `jq '{spec, pr, stamp, changedFiles}' "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** `spec` names the materialized header; `pr` carries the PR record, its phase checklist (`{phase, done}` rows from the body's phases span), and its mergeability (`mergeable`, `mergeStateStatus` — `null` when the forge omits them — and `conflictNote`, step 5) or `value: null` when the run has no PR yet; `stamp` is `verify.js --stamp-status`'s object; `changedFiles` is `verify.js --changed-files`' set — against the run's own stamp anchor when one is usable, else the integration branch the pack passes.
- **Should feel:** Change analysis and the skip-if-recent decision start from facts already on disk.
- **Should understand:** `pr.ok === false` means the probe itself failed (`gh` absent while a PR number is recorded) — the `gh`-absent MCP/no-forge path; never fabricate checklist state. `stamp`/`changedFiles` run in the worktree `run-state.json` names, bounded like every pack subprocess.
- **Red flags:** `pr.ok: true, value: null` on a `pr-first` run that has pushed — `run-state.json` lost its `pr` field; a `changedFiles` probe erroring with "could not resolve a base" — the integration-branch policy is unset and no stamp anchors the run.

### 5. Catch a run PR that turned CONFLICTING between the two calls (#3014)
- **URL:** `jq '.pr.value | {state, mergeable, mergeStateStatus, conflictNote}' "$PIPELINE_RUN_DIR/preflight.json"`; `plugin/skills/flow/steps-and-gates.md`'s "A run PR that turned CONFLICTING between calls" paragraph
- **Action:** When `pr.value.conflictNote` is non-null (an `OPEN` PR reading `CONFLICTING`), print it verbatim before any later phase, log one `AUTO` decision, and catch the branch up per `_shared/git-discipline.md`'s Post-push merge-state check, **Catch-up (`auto`)**. If that merge itself conflicts: list the paths (`git -C "{worktree-path}" diff --name-only --diff-filter=U`, where `{worktree-path}` is `run-state.json`'s `worktree`, else the session's `git rev-parse --show-toplevel`), run `git -C "{worktree-path}" merge --abort`, log the abort, and stop as a HARD-GATE naming them, with the `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" {step}` resume form.
- **Should feel:** The conflict a sibling merge created while the first call was finishing shows up as one plain line at the start of the second call — not as a green stamp and an empty checks list that read like "CI pending" until someone thinks to run `gh pr view --json mergeable`.
- **Should understand:** The line is `Run PR #{n} is CONFLICTING with {integration branch} — CI will not run on it until the conflict is resolved.` — the `PR_CONFLICT_NOTE` constant in `bin/lib/flow/preflight.js`, rendered verbatim in the prose and pinned equal by `tests/flow-preflight-conformance.test.js`. `MERGEABLE`, `UNKNOWN` (GitHub still computing — never polled or re-read), a `null` field, a closed or merged PR, `pr.ok === false`, or `pr.value === null` print and log nothing. A catch-up that advanced HEAD invalidates the first call's stamp; the Auto-insert `test` rule puts `test` before `review`, so the re-verify needs no extra step. The stop is registered in `_shared/auto-mode-contract.md`'s HARD-GATE row.
- **Red flags:** Review running on a run whose PR reads `CONFLICTING` with no conflict line printed; a conflict line for a closed PR; the adoption path resolving a catch-up conflict itself instead of stopping (that latitude belongs to the phase-exit check, not here); a stop that names no conflicting paths; a conflict-path list or `merge --abort` run without `-C "{worktree-path}"` from a cwd that is the main checkout, not the run's worktree; a second `test` run queued on top of the auto-inserted one.
