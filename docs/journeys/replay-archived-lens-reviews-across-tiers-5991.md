---
files:
  - tools/review-replay.js
  - tools/review-replay/reviews-extract.js
  - tools/review-replay/reviews-rewrite.js
  - tools/review-replay/reviews-score.js
  - tools/review-replay/replay.workflow.js
  - tools/review-replay/schema.js
---

# Replay Archived Lens Reviews Across Tiers

**Persona:** a maintainer who wants to change which model tier or effort `/review`'s lens reviewers run at (a cheaper tier, a lower effort, a reworded lens prompt). They need to know what the change does to the findings before it ships, and they want a measurement over real past reviews, not a guess.
**Goal:** rerun archived lens reviewer dispatches in clean repositories at one or more arms (tier and effort), then get, per lens, how many of the review's confirmed findings each arm raised, how its rows relate to the archived reviewers' rows, and what the control arm says about how reproducible a reviewer is.
**Entry point:** `node tools/review-replay.js extract-reviews --runs .claude-tweaks/pipelines --out <dir> --role lens --transcripts <claude projects dir> --arm name=haiku,profile=fast,repeat=1`, run in the main checkout, where the archived run directories live.
**Success state:** `score-reviews` exits 0. That means every replayed reviewer produced a reply that parsed as a lens report. The maintainer posts, per lens, the arm's confirmed recall, its `new` rows and its agreement with the reference arm, each set beside `control`'s `fidelity`.

## Steps

### 1. Build the replay set — `extract-reviews`
- **URL:** `node tools/review-replay.js extract-reviews --runs .claude-tweaks/pipelines --out <dir> --role lens --transcripts <claude projects dir> --arm name=<id>,profile=<profile>[,effort=<low|medium|high|xhigh|max>],repeat=<n> [--arm ...] [--select <run,...>] [--lens <id,...>] [--max-per-lens <n>] [--min-reviews <n>]`
- **Action:** pick the archived lens reviewer dispatches a replay can rerun. Into a new empty directory, write one clean two-commit repository per run and range (`repos/{run}--r{k}/repo`, holding the archived base then head as `base` and `head`). Write each slot's context bundle, spec and procedure copies beside it, one prompt per arm and slot, `reviews-manifest.json`, `reviews-fixture.json` and `archived-reports.json`. The archived shas and the worktree and main-checkout paths in a prompt become the replay repository's.
- **Should feel:** declarative. An arm is data (profile, effort, repeats), so comparing a new variant means adding another `--arm`. A control arm per archived tier and effort is added for you: it reruns the slots at the tier and effort they were archived at.
- **Should understand:**
  - A dispatch that cannot be replayed is listed in `excluded` with its reason and gets no prompt: `unlabelled-dispatch`, `no-archived-tier`, `no-transcript`, `report-unparsed`, `no-sha-range`, `commit-not-in-clone`, `unknown-run-input` (the prompt names a run-directory file the replay does not copy, such as `decisions.md`), `run-input-gone` (a context bundle the prompt names has been deleted) and `unrewritten-path` (an archived worktree, main-checkout or own-run path is left after rewriting, or any absolute path naming a `.claude/worktrees/` or `.claude-tweaks/pipelines/` directory outside `--out` that exists on this machine; a dead path, such as one in test-fixture or comment text of the diff, stays as text). A whole run is excluded with the reason `readRun` gives.
  - The main checkout is taken to be `--runs/../..`. Point `--runs` at a copy of the run directories somewhere else and nothing in the prompts matches it, so nothing is rewritten: while the archived checkout is still on this machine, every slot is then excluded as `unrewritten-path` rather than written with live archived paths in it.
  - Runs are read newest first by name, in whatever order `--select` lists them.
  - The control arm is `control` when every selected slot was archived at one tier and effort, and `control.{tier}.{effort|none}` per group otherwise. A user arm named `control` or `control.*` exits 2.
  - No archived reply text and no `decisions.md` verdict line reaches a prompt, a repository or a copy. A copy replaces a path to another run's directory with `[run-directory path removed]`; a relative mention of another run in diff text stays as it was.
  - No selected slot, or fewer than `--min-reviews`, is a shortfall: exit 3, and nothing is written.
- **Red flags:**
  - A prompt or repository that contains a row from the archived reply or a `confirmed by tiebreak` line.
  - A prompt that still names an archived sha or an archived worktree path.
  - A dispatch that disappears without being listed in `excluded`.

### 2. Run the reviewers — the Workflow script
- **URL:** `tools/review-replay/replay.workflow.js`, started through the Workflow tool with the contents of `<dir>/reviews-manifest.json` as its args
- **Action:** start one reviewer per arm, repeat and prompt file. Each runs on its arm's model and effort and is told only its label and where its prompt file is.
- **Should feel:** hands-off. This is the one step that spends model tokens, and its size is known before it starts: arms times repeats times prompts.
- **Should understand:**
  - A dispatched build agent has no Workflow tool. This step runs from an interactive session. A reviewer that does not reply is not a review with no findings; step 3 reports it as `notJudged`.
  - Every repeat of an arm shares one scratch directory per slot (`scratch/{arm}/{run}/{slot}/…`), so a later repeat can see what an earlier one left there. A second Workflow run over the same `<dir>` also starts with that scratch non-empty. Re-extract into a new `<dir>` for a clean start.
- **Red flags:**
  - A reviewer given anything beyond its label and prompt path.

### 3. Score the arms — `score-reviews`
- **URL:** `node tools/review-replay.js score-reviews --out <dir> --transcripts <workflow dir> [--reference <arm>]`
- **Action:** read every reviewer's reply and print, per arm and lens: the review's confirmed findings the arm raised (`confirmed` over first passes, with `unlocated`; `confirmedRereview` for re-reviews; `confirmedMissingSource` for slots whose unit has no `decisions.md`), the archived reviewers' rows it raised (`archived`), the rows no archived reviewer of the run raised (`new`), the reference arm's rows it also raised (`vsReference`), the rows by severity and `rowsUnlocated`, agents, tokens and minutes. `fidelity` per lens is the control arms' recall of the archived rows. `fixture.byLens` repeats what the extraction selected and excluded per lens.
- **Should feel:** trustworthy. Exit 0 means every reviewer was judged. Exit 3 means some were not, and they are listed under `notJudgedByReason`: `no-reply`, `unidentified-agent`, `effort-mismatch` (an arm with an effort whose reviewer recorded another), or `could-not-parse`.
- **Should understand:**
  - `notJudged` is never a review that found nothing. A `No findings` reply is scored with zero rows and does not affect the exit code.
  - An arm's numbers are read against `control`'s `fidelity`. A rerun at the archived tier that recovers only part of the archived rows shows how much of an arm's difference is a different reviewer and how much is the same reviewer run again.
  - Confirmed recall is per slot, summed, over first passes only. A slot that is not the first labelled dispatch of its lens and side in its unit, counting dispatches that were excluded (`ordinal` above 1 in `reviews-fixture.json`), re-reviewed a later head, where the confirmed findings may already have been fixed. Its tally is reported apart, per lens, as `confirmedRereview`, and `byRepeat` leaves it out. It still counts in `reviews`, `rowsBySeverity`, `archived`, `new`, `vsReference` and `fidelity`.
  - A row counts as raising a finding when it is within 5 lines of it in the same file. A severity row with no `path:line` cannot raise one; it is counted in `rowsUnlocated`, so a recall of 0 beside a non-zero `rowsUnlocated` is not a review that found nothing.
  - Confirmed recall rewards an arm that behaves like the archive: the confirmed set comes from the archived tier's own output.
  - A `new` row is neither noise nor signal until sampled.
  - A clean repository holds two commits, so `git log` and `git blame` differ from the archived review.
- **Red flags:**
  - A recall that rose because `notJudged` reviewers were left out.
  - A lens whose `confirmedMissingSource` is non-zero read as a lens with nothing confirmed.
  - An arm compared without its `control` `fidelity` beside it.

## Origin
- Created during the build of #5991 (run `2026-11-22T104506-spec-5991`). This replays the lens reviewers where `replay-archived-reviews-to-measure-a-tiebreak-change-5557.md` replays the tiebreak judge.
