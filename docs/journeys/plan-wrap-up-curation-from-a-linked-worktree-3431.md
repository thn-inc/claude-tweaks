---
files:
  - plugin/bin/wrap-up-engine.js
  - plugin/bin/lib/wrap-up/facts.js
  - plugin/bin/lib/wrap-up/engine-plan.js
  - plugin/skills/wrap-up/curation-engine.md
---

# Plan Wrap-Up Curation From Inside a Linked Worktree

**Persona:** the agent session running `/claude-tweaks:wrap-up` Phase 2 for a `/flow` record, whose cwd is the run's linked worktree (`.claude/worktrees/{name}`) rather than the main checkout — which is every `/flow` and `/dispatch` run.
**Goal:** get a curation worklist whose journeys, references, and CLAUDE.md rows reflect this branch's own diff, so the gates that should open do open.
**Entry point:** `curation-engine.md`'s Step 1, `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" plan --run-dir "$PIPELINE_RUN_DIR" --base "$BASE_SHA" …`, invoked from the worktree (or any subdirectory of it).
**Success state:** the printed worklist's `journeys` row lists, under `scope.candidates`, every `docs/journeys/*.md` whose `files:` frontmatter overlaps the branch diff; the telemetry line lands in the main checkout's `.claude-tweaks/wrap-up-outcomes.tsv`.

## Steps

### 1. Run `plan` from the worktree
- **URL:** `node plugin/bin/wrap-up-engine.js plan --run-dir "$PIPELINE_RUN_DIR" --base {base-sha}` with cwd = the linked worktree (or a subdirectory such as `<worktree>/web`)
- **Action:** Invoke it exactly as `curation-engine.md` instructs; `--run-dir` stays the main-checkout-anchored run directory.
- **Should feel:** Location-independent — the same worklist whether the shell sits at the worktree root, in a subdirectory, or (for a non-worktree run) in the main checkout.
- **Should understand:** Repo facts (changed files, renamed/deleted paths, journey frontmatter, CLAUDE.md) are read from `git rev-parse --show-toplevel` of the cwd — the worktree being built — while telemetry alone resolves through the common git dir to the main checkout (#3431). Before #3431, facts also went through the common dir, so `git diff {base}...HEAD` ran against the main checkout's HEAD and came back empty in every worktree run.
- **Red flags:** A worktree run whose branch plainly touches a file named in a journey's `files:` list, yet the `journeys` row prints `candidates: []`; the references or CLAUDE.md-Commands rows closing when the branch renamed a referenced path or a Commands entry.

### 2. Read the journeys row's candidates
- **URL:** the same command's stdout (the worklist JSON), `rows[id=journeys].scope.candidates`
- **Action:** Check that each listed journey's `files:` frontmatter shares at least one path with the branch diff, and that no overlapping journey is missing.
- **Should feel:** Trustworthy — the candidate list is computed from the diff that will actually merge, so the Journeys curation row reviews the right files without the model re-deriving overlap by hand.
- **Should understand:** An empty list now means "no journey overlaps this branch," not "the diff was read from the wrong checkout."
- **Red flags:** Candidates that match the main checkout's recent history rather than this branch's commits.

### 3. Confirm telemetry stayed in the main checkout
- **URL:** `{main checkout}/.claude-tweaks/wrap-up-outcomes.tsv`
- **Action:** After a non-`--dry-run` plan from the worktree, confirm the new telemetry line is in the main checkout's TSV and that no `.claude-tweaks/wrap-up-outcomes.tsv` appeared inside the worktree.
- **Should feel:** Durable — outcome telemetry survives worktree teardown because it was never written there.
- **Should understand:** The two roots are deliberate and separate: facts follow the worktree, telemetry follows the main checkout.
- **Red flags:** A worktree-local TSV (lost when the reconciler reaps the worktree).

## Origin
- Created during build of #3431
- Steps 1-3 built in this session
- Related specs: #3017 (subdirectory-cwd facts root), #3389 (the run where the empty-diff journeys row was observed)
