---
files:
  - plugin/skills/flow/SKILL.md
  - plugin/skills/flow/validation.md
  - plugin/skills/build/worktree-setup.md
  - plugin/skills/flow/multi-spec.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/review/code-mode-steps.md
---

# Get the Run Ledger Inside the Worktree

**Persona:** a maintainer of a `worktree-always` project who runs `/claude-tweaks:flow #N` (or hands it off from `/claude-tweaks:dispatch`) from the main checkout or from a session that is already sitting in a linked worktree, and expects every phase's findings to land in one ledger the wrap-up gate can resolve.
**Goal:** the open-items ledger exists at `docs/plans/{date}-{feature}-ledger.md` inside the run's own worktree before the first build task can raise a finding — no gate refusal, no stray `{run-dir}/ledger.md`, no pre-flight note dropped — and review's QA Ledger Check finds the creation line.
**Entry point:** `/claude-tweaks:flow #N` Step 1 item 8 ("Create the open items ledger"), then `build/worktree-setup.md` Step 4.6 (single-spec) or `flow/multi-spec.md`'s "Shared worktree" step 1 (multi-spec).
**Success state:** one ledger per run, committed on the run's branch; `decisions.md` holds exactly one `AUTO {time} — flow: created open-items ledger {path}. Reversibility: n/a.` line; any Step 2.5/2.6 `ops` note appears as a row in it; a `current-branch` or wrap-up-only run still gets its ledger where it always did.

## Steps

### 1. Step 1 decides who creates the ledger
- **URL:** `plugin/skills/flow/SKILL.md` Step 1 item 8
- **Action:** When Step 1.3 resolved `current-branch`, Step 1 creates the ledger now. For every `worktree`-strategy run — a new worktree or the one the session already sits in — Step 1 creates nothing and names the later creation point.
- **Should feel:** Invisible — no new prompt, no new stop; the run just proceeds to pre-flight.
- **Should understand:** Writing the ledger here would fail twice over: under `worktree-always` a `docs/plans/` write from the main checkout is denied, and inside an already-isolated session an untracked ledger makes the Adopt-or-create clean-tree check (`git status --porcelain`) treat the worktree as dirty and abandon it.
- **Red flags:** a ledger file appearing in the main checkout or the run dir before the worktree is set up; a session's own worktree abandoned for a fresh one right after Step 1.

### 2. Pre-flight notes are held, not lost
- **URL:** `plugin/skills/flow/validation.md` "Ledger-bound notes (#3036)"
- **Action:** Step 2.5's divergence note and Step 2.6's shape-check warnings are logged to `decisions.md` as they occur (the 2.5 line reads "ops entry held for the open-items ledger").
- **Should feel:** Like nothing is pending — the notes are on disk in the audit log.
- **Should understand:** The ledger does not exist yet for a `worktree` run; whichever step creates it appends these as `ops` rows. Under `current-branch` the ledger already exists and the note is written straight in.
- **Red flags:** a pre-flight divergence or shape warning in `decisions.md` with no matching `ops` row in the final ledger.

### 3. The ledger is created once the worktree exists
- **URL:** `plugin/skills/build/worktree-setup.md` Step 4.6; `plugin/skills/flow/multi-spec.md` "Shared worktree" step 1
- **Action:** Right after the worktree is created or adopted (and stamped), the ledger is created at `docs/plans/…-ledger.md` inside it, the held notes are appended, and the creation line is logged. Multi-spec runs create one shared ledger, `{feature}` = the shared `spec-{N1}-{N2}…` slug, logged to the parent run dir's `decisions.md`.
- **Should feel:** Like it was always there by the time build's first task runs.
- **Should understand:** A resumed run whose active ledger already exists creates nothing and logs no second creation line; standalone `/claude-tweaks:build` (no `$PIPELINE_RUN_DIR`) never creates one here. An older run dir already holding a pre-#3036 `{run-dir}/ledger.md` keeps using it — the run-dir-first resolution rule finds it.
- **Red flags:** two creation lines in one run's `decisions.md`; a `{run-dir}/ledger.md` at the end of a run that created a worktree.

### 4. Review's QA Ledger Check explains a missing ledger
- **URL:** `plugin/skills/review/code-mode-steps.md` "QA Ledger Check"
- **Action:** When review finds no ledger file for the spec's `{feature}`, it looks in `decisions.md` for the creation line (Step 1.8 or Step 4.6), and on a multi-spec run in `$MULTISPEC_PARENT_DIR/decisions.md` as well, before writing its soft `SKIP` line.
- **Should feel:** A silent pass when the ledger exists; a self-explaining no-op when the creation line accounts for it.
- **Should understand:** A wrap-up-only or `current-branch` run that never has a worktree still uses `{run-dir}/ledger.md` / Step 1's creation — the No-worktree exception keys on the resolved strategy or run shape, never on `run-state.json` momentarily lacking a `worktree` field.
- **Red flags:** the QA Ledger Check reporting a missing creation line on a run whose ledger plainly exists.

## Origin
- Created during `/claude-tweaks:build` of record #3036 (2026-10-17): `/flow` ledger creation moved behind the worktree; Step 1.8 kept for `current-branch` only; pre-flight ledger-bound notes held until creation.
- Related: `docs/journeys/recover-from-a-bookkeeping-stamp-deny.md` (the worktree stamp Step 4.6 follows)
