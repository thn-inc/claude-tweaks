# Plans Prune After Wrap-Up (this repository) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This repository deletes each run's execution plan at that run's wrap-up (`superpowers-plans-retention: prune-after-wrapup`), with the rule, its incident entry and a decision record saying so, the closed-record plans already on the tree pruned once by `/claude-tweaks:tidy`, and two records filed (ledger leftovers, a parked measurement).

**Architecture:** A one-line policy setting plus documentation, a one-time tidy pass, two filed records, and evidence tables appended to PR #5629's body. No plugin code or skill prose changes; the plugin default stays `keep-forever`.

**Tech Stack:** Markdown docs, `.claude-tweaks/policy.yml`, the installed claude-tweaks 6.170.0 CLIs, `gh`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T021500-record-5562/work/5562-spec.md` (record #5562)

Scope keywords: superpowers-plans-retention, prune-after-wrapup, IL-36

## Global Constraints

- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-5562` (branch `worktree-record-5562`, draft PR #5629). Every command runs there; `pwd` and `git rev-parse --show-toplevel` must both print it before any commit.
- Run dir (main-checkout anchored): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T021500-record-5562`. Write evidence there only with a plain Bash `cp`/redirect (the Write tool is refused there): write the file with Write into the scratchpad, then `cp` it into `{run-dir}/evidence/` after `mkdir -p "{run-dir}/evidence"`.
- Plugin root (literal): `/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0`.
- "Do not change the plugin default. A consuming project that keeps plans on purpose must see no change." — no edit under `plugin/`.
- "Do not add text to `plugin/skills/tidy/scan-procedures.md` … or `plugin/skills/tidy/step-6-auto.md`." No edit to either.
- `docs/plans/` (run ledgers) and `docs/superpowers/plans/` (plans) are different things (IL-37). The tidy prune touches only `docs/superpowers/plans/`.
- `docs/superpowers/specs/` is out of scope.
- No tracked file may name this plan's own filename (`2026-11-16-plans-prune-after-wrapup.md`): wrap-up's cleanup item 1 keeps a cited plan, and AC3 needs this plan deleted on the branch. Name it only in the PR body or the run dir — and never in a row of the tracked open-items ledger `docs/plans/2026-11-16-plans-prune-after-wrapup-ledger.md` (the citation check reads `docs/plans/`; refer to "this run's plan" there).
- Never `git stash`; never `git rm` a plan outside the tidy pass (spec Gotcha: "do not replace the tidy pass with a bare `git rm`").
- Decision rule for an unsettled reading (spec, author 2026-11-16): prefer the reading that keeps a run on the previous plugin release working; then the one that puts the rule in code, not prose; then the one inside the Key Files. State each such choice in the PR body (Task 6).
- Commit style: `{Verb} {what} — {detail}`, "refs #5562" (never closes/fixes), trailer `Claude-Session: https://claude.ai/code/session_017vXcAfgnMHSKjpcUW23qJj`.
- Governing project skills: none apply — no task edits `plugin/bin/**`, a test, or `plugin/skills/**` (`skill-prose-conformance-tests` and `bin-source-scan-conformance` govern test and bin edits only).

Waived plugin/skills/wrap-up/cleanup-procedures.md: read-only, Task 1 classifies its reads (no edit expected; the record says no edit to wrap-up's files).
Waived plugin/skills/tidy/scan-procedures.md: read-only, Task 1 classifies it and Task 3 runs it via `/claude-tweaks:tidy`.
Waived plugin/skills/tidy/step-6-auto.md: read-only, Task 3 runs it via `/claude-tweaks:tidy`.
Waived plugin/skills/wrap-up/SKILL.md: read-only, Task 1 Step 2 confirms its packet plan snapshot runs before cleanup item 1.
Waived bin/lib/policy-schema.js: read-only (installed copy), Task 2 Step 2's AC8 check greps it.

**Check B scope-keyword hits, classified no-change** (each describes the plugin's own behavior and default, which this record does not change; Task 1 re-checks the `plugin/**` ones as readers): `README.md:84`, `docs/getting-started.md:69`, `docs/journeys/keep-recent-plans-and-approve-a-bulk-prune-4465.md`, `docs/journeys/tidy-standalone-auto-report.md`, `docs/plugin-structure.md:327`, `docs/skill-graph.md:733`, `plugin/skills/help/context-flow.md:141`, `plugin/bin/lib/plan-retention/route.js`, `plugin/bin/lib/policy-schema.js`, `plugin/bin/plan-retention.js`, `plugin/skills/_shared/policy-schema.md`, `plugin/skills/tidy/SKILL.md`, `plugin/skills/tidy/plan-citation-check.md`, `plugin/skills/tidy/scan-procedures.md`, `plugin/skills/tidy/step-6-auto.md`, `plugin/skills/wrap-up/cleanup-procedures.md`, `plugin/skills/wrap-up/summary-template.md`, `tests/bin-lib/plan-retention/route.test.js`, `tests/plan-citations-resolve.test.js`, `tests/policy-schema.test.js` (Task 2 Step 8 runs the last one). `docs/superpowers/specs/2026-11-15-process-efficiency-design.md` (out of scope, spec Gotcha), `docs/superpowers/plans/2026-11-02-risk-flags-at-intent-time.md` (an old plan; Task 3's tidy pass decides it), and `docs/plans/2026-11-16-plans-prune-after-wrapup-ledger.md` (this run's ledger) are not edited.

## Spec coverage map

| AC clause | Task / step |
|---|---|
| AC1.1, AC1.3 | Task 1 Steps 1-2 (both greps, every printed file a row) |
| AC1.2, AC1.4, AC1.5 | Task 1 Steps 2-3 (exempt list, BLOCKED stop) |
| AC1.6 | Task 2 Step 7 (ADR-0034 states the rule and lists the readers) |
| AC2.1 | Task 2 Steps 1, 3, 8 |
| AC4.1 | Task 3 Step 2 |
| AC4.2 | Task 3 Step 3, Task 6 Step 1 |
| AC5.1 | Task 2 Step 8 |
| AC6.1 | Task 4 Steps 1-2, Task 6 Step 1 |
| AC7.1 | Task 5 Step 1 |
| AC8.1 | Task 2 Step 2, Task 6 Step 1 |

Waived AC3.1: observable only at wrap-up (the review/wrap-up call deletes the plan under cleanup item 1); this build guarantees its precondition via the "no tracked file names this plan" constraint.
Waived AC3.2: the run summary is rendered at wrap-up, after this build/test call.

## Review Focus

- A reader classified "before cleanup item 1" that actually runs after it (e.g. wrap-up summary or console steps that run post-cleanup) — Task 1 must cite the step order, not the list order (plan-authoring Ordering-fix location check).
- The tidy pass deleting a plan of a live sibling run or an open record — Task 3 relies on tidy's own re-verification; the kept list must name this run's own plan as kept (live run).
- A committed file (ADR-0034, the ledger, a reworded rule) naming this run's plan filename, which would make cleanup item 1 keep it and fail AC3.
- The reworded `[IL-36]` rule breaking a pin in `tests/` (`docs/donts.md` prose is pinned); Task 2 runs the suites named in AC5 plus `tests/claude-md-budget.test.js`.
- A sibling session on the previous release reading `policy.yml`: Task 2's AC8 check confirms 6.170.0 knows the value.

---

### Task 1: Reader check

**Role:** judgment

**Files:**
- Read: every file printed by `git grep -l "superpowers/plans" -- plugin tools docs/reference` and `git grep -l -E "['\"]plans['\"]" -- plugin/bin`, plus `git grep -l "docs/superpowers/plans" -- plugin` (Deliverable 1's list; a subset of the first)
- Create (run dir, not committed): `{run-dir}/evidence/reader-table.md`

**Interfaces:**
- Produces: `{run-dir}/evidence/reader-table.md` — a Markdown table with columns `File | What it reads | Before/after cleanup item 1 | When the plan is absent on main | Verdict`, one row per file from the union of the greps, sorted by path; Verdict ∈ `ok`, `exempt`, `no plan read` (e.g. `docs/plans` ledgers only, or a mention in prose), `BLOCKS`. Task 2 (ADR) and Task 6 (PR body) consume it.

- [ ] **Step 1: Run the AC1 greps and save their output**

Run each as its own call and keep the output: `git grep -l "superpowers/plans" -- plugin tools docs/reference` (34 files at plan time), `git grep -n -E "['\"]plans['\"]" -- plugin/bin` (8 lines in 4 files at plan time: statusline, wrap-up `engine-verify.js`, `ledger-write.js`, `pack.js` — all `docs/plans`), `git grep -l "docs/superpowers/plans" -- plugin`.

- [ ] **Step 2: Classify each file (AC1.1, AC1.2)**

For each file read the lines naming the path and decide the five columns. "Before/after cleanup item 1" is decided from where the reader runs in the lifecycle (build, review, wrap-up phase/step before or after `cleanup-procedures.md` item 1, tidy, help, init), citing the step. Exempt list (spec AC1): `/claude-tweaks:tidy`'s plan scan, `plugin/bin/plan-retention.js` (and its `lib/plan-retention/`), the reconciler's `Spec:` pointer upkeep. Known case to confirm: `plugin/skills/wrap-up/SKILL.md`'s packet plan snapshot (`git diff --name-only --diff-filter=AM "origin/{integration-branch}...HEAD" -- docs/superpowers/plans/`) runs before cleanup item 1. `plugin/skills/wrap-up/summary-template.md` cites `[IL-36]` for a kept design-mode plan — classify it (it describes the `keep-forever` plugin default; no edit unless it contradicts Task 2's wording, in which case report it rather than edit, since it is outside Key Files).

- [ ] **Step 3: Stop on a blocking reader**

Any row with Verdict `BLOCKS` (a non-exempt reader that needs the plan after cleanup item 1, or breaks when it is absent on `main`): stop and report `BLOCKED` naming the reader and the line. Do not continue to Task 2.

- [ ] **Step 4: Save the evidence**

Write the table to the scratchpad, `mkdir -p "{run-dir}/evidence"`, `cp` it to `{run-dir}/evidence/reader-table.md`. Log: `node "{plugin-root}/bin/log-decision.js" --run "{run-dir}" --section "/build" --status AUTO --step "AC evidence" --text-file "{file}"` with one line: `AC1: reader table covers {N} files from the two AC1 greps; {B} BLOCKS, {E} exempt, {K} ok, {P} no plan read — {run-dir}/evidence/reader-table.md`. No commit (nothing tracked changes).

### Task 2: Setting, rule, incident entry and decision record

**Role:** integration

**Files:**
- Modify: `.claude-tweaks/policy.yml` (append one line)
- Modify: `docs/donts.md:67`
- Modify: `docs/incident-log.md:163` (the IL-36 entry body)
- Modify: `docs/decisions/0007-historical-design-doc-archive-is-periodically-pruned.md:3` (one line added under Status)
- Create: `docs/decisions/0034-this-repository-deletes-each-runs-plan-at-wrap-up.md`
- Test: `tests/tidy-plan-retention-conformance.test.js`, `tests/bin-lib/plan-retention/`, `tests/claude-md-budget.test.js`, `tests/policy-schema.test.js`

**Interfaces:**
- Consumes: `{run-dir}/evidence/reader-table.md` (Task 1) — the ADR's reader list.

- [ ] **Step 1: Confirm the setting is absent**

Run: `test "$(node plugin/bin/resolve-policy.js --values superpowers-plans-retention)" = prune-after-wrapup`
Expected: FAIL (exit 1; the resolver prints `keep-forever`).

- [ ] **Step 2: AC8 check on the installed build (AC8.1)**

Run: `grep -c prune-after-wrapup` on each of `{plugin-root}/bin/lib/policy-schema.js`, `{plugin-root}/skills/wrap-up/cleanup-procedures.md`, `{plugin-root}/skills/tidy/scan-procedures.md` (three separate calls). Expected: each ≥ 1 (1, 1, 1 at plan time). Any 0 → stop, `BLOCKED`. Save the three lines plus the version `6.170.0` to `{run-dir}/evidence/ac8-installed-version.txt` and log an `AC evidence` entry naming AC8.

- [ ] **Step 3: Write the setting (AC2.1)**

Append `superpowers-plans-retention: prune-after-wrapup` as the last non-comment line of `.claude-tweaks/policy.yml` (after `declare-claude-tweaks: false`). If `origin/main` gained a changelog opt-in line meanwhile (spec Gotcha, #5563), keep both.

- [ ] **Step 4: Reword the `[IL-36]` rule**

Replace `docs/donts.md` line 67 with exactly:

```
- For a design-mode build (brainstorm → design doc → plans → SDD, skipping `/specify`), keep the design doc under `docs/superpowers/specs/` at wrap-up — nothing consumes it, and bulk pruning is a separate deliberate action (ADR-0007). The plan follows `superpowers-plans-retention`: this repository sets `prune-after-wrapup`, so the run's own wrap-up deletes it on the branch (ADR-0034); the plugin default stays `keep-forever` `[IL-36]`
```

- [ ] **Step 5: Reword the IL-36 incident entry**

Replace the body paragraph under `## IL-36 — Design-mode build artifacts at wrap-up` (line 163; keep the heading) with a paragraph that: keeps the history (the rule originally kept both design doc and plan as permanent record, with the archive pruned in bulk per ADR-0007); states what the repository does now (design doc still kept for a design-mode build; the plan follows `superpowers-plans-retention`, set to `prune-after-wrapup` here since #5562, so each run deletes its own plan at wrap-up's cleanup item 1 and tidy deletes leftovers of closed records; ADR-0034); keeps "`docs/decisions/` ADRs are excluded from any such prune". Do not name this plan's filename.

- [ ] **Step 6: Add the ADR-0007 narrowing line**

Directly under `- **Status:** accepted` add: `- **Narrowed by:** [0034](0034-this-repository-deletes-each-runs-plan-at-wrap-up.md) — in this repository a plan is deleted by its own run at wrap-up; design docs are still kept until `/claude-tweaks:specify` consumes them.` Do not edit the Decision section.

- [ ] **Step 7: Write ADR-0034**

Follow `docs/decisions/0033-*.md`'s shape (title `# 0034. This repository deletes each run's plan at wrap-up`, Status accepted, Date 2026-11-16, Context #5562; sections Context / Decision / Alternatives considered / Consequences). Context: the measured churn from the spec's Current State (699 added, 641 deleted in 30 days on 2026-11-15; 79 tracked, 2.8 MB) and that nothing reads a plan after the merge. Decision: `superpowers-plans-retention: prune-after-wrapup` in this repository; the rule "a plan exists on its run's branch only"; it narrows ADR-0007 for this repository — a plan is deleted by its own run, a design doc is still kept until `/claude-tweaks:specify` consumes it; the plugin default stays `keep-forever`. A "Readers that rely on this rule" list: every Task 1 row with Verdict `ok` or `exempt`, one line each (path — what it reads — why it is safe). Alternatives: keep `keep-forever` plus periodic bulk prunes (rejected: a commit per prune and plans on `main` between prunes); change the plugin default (rejected: consuming projects that keep plans would change). Consequences: runs that close without wrap-up leave their plan until tidy prunes it once the record closes; the parked measurement record (Task 5) checks the result. Do not name this plan's filename.

- [ ] **Step 8: Verify (AC2.1, AC5.1)**

Run: `node plugin/bin/resolve-policy.js --values superpowers-plans-retention` — Expected: `prune-after-wrapup`.
Run: `node --test tests/tidy-plan-retention-conformance.test.js tests/bin-lib/plan-retention/*.test.js tests/claude-md-budget.test.js tests/policy-schema.test.js > {scratchpad}/task2-tests.txt 2>&1` — Expected: `# fail 0`, with no edit to any test file. Run cleanup item 1's own citation check (`plugin/skills/tidy/plan-citation-check.md`'s form): `git grep -lF -- '2026-11-16-plans-prune-after-wrapup.md' -- ':!docs/superpowers/plans/' ':!.claude-tweaks/'` — Expected: exit 1, no output. Control (per #4579's absence-grep rule): `git grep -lF -- '2026-11-16-plans-prune-after-wrapup.md' -- docs/superpowers/plans/` must print this plan's own path (its Global Constraints name it), proving the search can match; record both outputs.

- [ ] **Step 9: Commit**

`git add` the five files by path; commit `Set plans retention to prune-after-wrapup — reword IL-36, add ADR-0034 narrowing ADR-0007, refs #5562`.

### Task 3: One tidy prune under the new setting

**Role:** judgment

**Files:**
- Delete (via tidy only): plans under `docs/superpowers/plans/` that tidy routes Delete
- Create (run dir): `{run-dir}/evidence/kept-plans.md`

**Interfaces:**
- Consumes: Task 2's commit (the setting on the branch).
- Produces: `{run-dir}/evidence/kept-plans.md` — table `Plan | Reason kept` (reason ∈ open record #N, open PR #N, live run {run-id}, cited by {file}, state unreadable, no related record); Task 6 consumes it.

- [ ] **Step 1: Confirm the setting is live in this worktree**

Run: `node "{plugin-root}/bin/resolve-policy.js" --values superpowers-plans-retention` from the worktree — Expected: `prune-after-wrapup`.

- [ ] **Step 2: Run the tidy pass (AC4.1)**

Invoke the Skill `claude-tweaks:tidy` with args `--scope=plans`, from this worktree. Under `prune-after-wrapup` tidy's Step 4 routes a plan whose related record is complete as Delete and re-verifies each before deleting (`_shared/reverify-before-write.md`); the 30-plan threshold and 7-day cutoff belong to `keep-forever` and do not apply. The session is already isolated in this record's worktree, which carries the setting: when tidy's Step 7.5 says to provision a scratch worktree, adopt this worktree instead (per `_shared/worktree-setup.md`'s Adopt-or-create — `EnterWorktree` refuses inside a worktree session), run Step 7 and the tidy commit here, and skip tidy's own PR open/arm (the commit rides PR #5629). Log that adoption as one `AUTO` line in `{run-dir}/decisions.md`. Only plan deletions under `docs/superpowers/plans/` may land in this commit; any other tidy finding is left staged/unapproved. This run's own plan must be kept (live run).

- [ ] **Step 3: Record what was kept (AC4.2)**

From tidy's report, list every plan still tracked (`git ls-files docs/superpowers/plans`) with its reason. Save to `{run-dir}/evidence/kept-plans.md`; log an `AC evidence` entry: `AC4: tidy --scope=plans deleted {D} plans, kept {K}; every kept plan has an open record, open PR, live run or citing file — {path}`. A kept plan whose reason is none of those (e.g. state unreadable) is listed with that reason.

### Task 4: Ledger table and one filed record

**Role:** judgment

**Files:**
- Read: `git ls-files 'docs/plans/*-ledger.md'`, `.claude-tweaks/pipelines/*/run-state.json` and `decisions.md`, `.claude-tweaks/pipelines/archive/*/` in the main checkout (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks`), read with plain `ls`/Read
- Create (run dir): `{run-dir}/evidence/ledger-table.md`

**Interfaces:**
- Produces: `{run-dir}/evidence/ledger-table.md` (table `Ledger | Run dir | Status | Why wrap-up did not delete it`) and the filed record's number; Task 6 consumes both.

- [ ] **Step 1: Map each tracked ledger to its run (AC6.1)**

For each tracked `docs/plans/*-ledger.md`, find the run that created it: grep the main checkout's `.claude-tweaks/pipelines/**/decisions.md` (archive included) for `created open-items ledger docs/plans/{file}`, falling back to the ledger's date+slug against run-dir names. Status = that run dir's `run-state.json` `status`, or `archived` (under `archive/`), or `no run directory`. "Why not deleted" = the run's last recorded phase (no wrap-up reached, wrap-up `cleanup-only` skipped it, run interrupted, …), stated from its `decisions.md`, not guessed. This run's own ledger is a live run — list it as such.

- [ ] **Step 2: File the record**

Invoke the Skill `claude-tweaks:capture` with a spec-shaped body (Current State: the table and the commonest cause with its count; Deliverables; Acceptance Criteria; `### Key Files` naming `plugin/skills/wrap-up/cleanup-procedures.md` and whichever file the commonest cause points at), `Related: #5562`. No fix in this record. Save the table to `{run-dir}/evidence/ledger-table.md` and log an `AC evidence` entry naming AC6 and the new record number.

### Task 5: Parked measurement record

**Role:** transcription

**Files:**
- none in the repo (forge write via `/claude-tweaks:capture`)

- [ ] **Step 1: File the parked record (AC7.1)**

Invoke the Skill `claude-tweaks:capture` to file one parked record, wake date 2026-11-30 (14 days after filing on 2026-11-16; if filed on a later day, filing date + 14), `Related: #5562`, carrying verbatim: count commands `git log --since=<filing date> --diff-filter=A --name-only --format=%H origin/main -- docs/superpowers/plans` (files added) and `git ls-tree -r --name-only origin/main -- docs/superpowers/plans` (files still tracked), with `<filing date>` filled in; baseline: 699 files added in the 30 days before 2026-11-15, 79 tracked; pass bound: fewer than 65 files added in the 14 days, and no tracked plan whose record has been closed for more than 7 days; a plan added and then deleted by a later commit counts as added; on a miss: name the PR each adding commit belongs to and the lane that ran it, and file a fix record. Include a `### Key Files` naming `.claude-tweaks/policy.yml` and `plugin/skills/wrap-up/cleanup-procedures.md`. Read the record back (`gh issue view {n} --json labels,body`) and confirm the parked label and wake date. Log an `AC evidence` entry naming AC7 and the record number.

### Task 6: PR body evidence

**Role:** integration

**Files:**
- none tracked (PR #5629 body)

**Interfaces:**
- Consumes: Tasks 1-5's evidence files and record numbers.

- [ ] **Step 1: Append the evidence section (AC1.1, AC4.2, AC6.1, AC8.1)**

Read the current body (`gh pr view 5629 --json body -q .body` into a scratchpad file). Append, below the existing content (after the fixes block, keeping the session link last), a `## Build evidence (#5562)` section with: the reader table (Task 1); the kept-plans table and the tidy deletion count (Task 3); the ledger table and the filed record number (Task 4); the parked record number (Task 5); the AC8 line: installed plugin `6.170.0`, `prune-after-wrapup` present in `bin/lib/policy-schema.js`, `skills/wrap-up/cleanup-procedures.md`, `skills/tidy/scan-procedures.md`; the #3813 case: #3813 has landed (closer commit bbadf4be2 on `main`), so this run's wrap-up deletes its plan on the branch before the merge; and every decision-rule choice taken. Write with `gh pr edit 5629 --body-file {file}`. Read it back and confirm the section is present.
