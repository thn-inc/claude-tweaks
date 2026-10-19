# Multi-Spec Consolidated Pass Re-entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/claude-tweaks:flow #A,#B review-console` re-enter a multi-spec run's consolidated pass after its parent session ended, and have the SessionStart banner name that command for eligible runs.

**Architecture:** A shared merge-evidence helper in `run-integrity.js` answers "has this run's branch landed?" without the wrap-up-event gate. A new read-only module `plugin/bin/lib/flow/consolidated-pass.js` composes the eligibility rule from run-dir files plus that helper. `session-residue.js` and the `review-console` skill prose both consume it, so they cannot drift.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T034326-spec-3497/work/3497-spec.md`

Scope keywords: checkRunIntegrity, collectStaleRuns, Nothing re-runs a forfeited

## Global Constraints

- Zero runtime npm dependencies; CommonJS `'use strict'` modules like their neighbours.
- `session-residue.js` and `run-integrity.js` are read-only by contract: no writes, no event appends, no git mutations, no fetch (SessionStart must stay offline-safe).
- Every ambiguity in a SessionStart detection resolves toward NOT alarming (no suffix), per `run-integrity.js`'s header.
- Skill references in actionable prose use the fully qualified `/claude-tweaks:{skill}` form.
- Never write the literal tokens TBD/TODO in authored prose.
- Suffix text, verbatim: ` — consolidated pass never ran: /claude-tweaks:flow #{id1},#{id2} review-console` (ids in `manifest.yml` `specs[]` order).

## Premise reversal (logged to decisions.md before Task 1)

The spec's landed condition ("`run-integrity.js` does not return `shipped-unclosed`") cannot work: `checkRunIntegrity` returns `in-progress` whenever the run's `events.jsonl` holds a `claude-tweaks:wrap-up` `skill_invoked` event (`run-integrity.js:275`), and every multi-spec spec's deferred `/wrap-up` writes exactly that event into the parent's `events.jsonl` (probe: `archive/2026-10-17T100123-spec-3368-3365/events.jsonl` holds 2). Landed therefore comes from branch merge evidence directly (Task 1). Second deviation: the helper lives in a new `plugin/bin/lib/flow/consolidated-pass.js`, not `manifest.js`, because it reads `config.yml`, `run-state.json`, `console.json` and git evidence that `manifest.js` does not own. Third: a sixth condition, run-state status not `clean`, so a `close-run`-closed run falls to the documented per-record fallback (matches `multi-spec.md`'s "Already closed?" and `collectStaleRuns`' non-clean iteration).

## Review Focus

- A merged multi-spec run whose per-spec wrap-ups logged wrap-up events: must NOT get the suffix (landed), even though `checkRunIntegrity` says `in-progress`. Pinned in Task 1 and Task 3.
- A git failure / unresolvable branch (non-git project, reaped worktree with no fallback branch): verdict `landed-unknown`, no suffix, never a throw. Pinned in Task 2 (non-git fixture).
- A malformed or missing `config.yml` `mode:` line: treated as not auto/hybrid → `mode` reason, no suffix. Pinned in Task 2.
- A `failed`/`not-run` spec among `complete` ones: still eligible (the pass covers partial runs). Pinned in Task 2.
- The run dir under `pipelines/archive/`: `archived` regardless of other files. Pinned in Task 2.

---

### Task 1: `checkBranchLanded` in run-integrity.js

**Files:**
- Modify: `plugin/bin/lib/hooks/run-integrity.js` (extract the branch/merge derivation out of `checkRunIntegrity`, lines 249-282; add export)
- Test: `tests/run-integrity.test.js`

**Interfaces:**
- Produces: `checkBranchLanded(runDir: string, opts?: { cache?: object }) => { landed: true | false | null, evidence: { branch: string|null, merged: 'ancestor'|'cherry'|false|null } }`. `landed: true` when `merged === 'cherry'`, or `merged === 'ancestor'` and `hasCommitSinceRunStart` holds; `landed: false` when `merged === false`; `null` for everything else (no valid run-state, no branch, no integration ref, ancestor without a post-start commit, any throw). Reads `run-state.json` via `readValidatedRunState` and accepts any valid status (including `clean`).
- `checkRunIntegrity` keeps its exact outputs; it calls the same extracted internal function for branch + merged evidence.

- [ ] **Step 1: Write the failing tests** in `tests/run-integrity.test.js` (reuse `fixtureRepo`, `fixtureZeroCommitRepo`, `writeEvents`, `EV_BUILD`; define `EV_WRAPUP = { type: 'skill_invoked', skill: 'claude-tweaks:wrap-up' }` beside `EV_BUILD` if absent):
  - `'#3497 checkBranchLanded: unmerged feature branch -> landed false'` — `fixtureRepo()`; assert `landed === false`, `evidence.branch === 'feat-branch'`.
  - `'#3497 checkBranchLanded: merged branch with wrap-up events -> landed true while checkRunIntegrity stays in-progress'` — `fixtureRepo()`, `sh(root,'merge','-q','--no-edit','feat-branch')`, `writeEvents(runDir,[EV_BUILD, EV_WRAPUP])`; assert `checkBranchLanded(runDir).landed === true` AND `checkRunIntegrity(runDir).state === 'in-progress'` (the reversed premise, pinned).
  - `'#3497 checkBranchLanded: zero-commit branch -> landed null'` — `fixtureZeroCommitRepo()`; assert `landed === null`.
  - `'#3497 checkBranchLanded: no run-state -> landed null, never throws'` — tmp dir with no `run-state.json`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="#3497" tests/run-integrity.test.js`
Expected: FAIL — `checkBranchLanded is not a function`.

- [ ] **Step 3: Implement** — extract a private `branchMergeEvidence(runDir, state, cache)` returning `{ branch, merged, hasCommit }` from the existing body (same `deriveBranch` → `fallbackBranch` → `resolveIntegrationBranch` → `mergedEvidence` order, `hasCommitSinceRunStart` only when `merged === 'ancestor'`); `checkRunIntegrity` keeps its NON_TERMINAL guard and event gates around it; add `checkBranchLanded` and export it.

- [ ] **Step 4: Run the whole file** — `node --test tests/run-integrity.test.js` → all PASS (existing tests prove `checkRunIntegrity` unchanged).

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/hooks/run-integrity.js tests/run-integrity.test.js` then `git commit -m "Add checkBranchLanded to run-integrity — merge evidence without the wrap-up gate (refs #3497)"`

### Task 2: `checkPassReentry` eligibility module

**Files:**
- Create: `plugin/bin/lib/flow/consolidated-pass.js`
- Test: `tests/bin-lib/flow/consolidated-pass.test.js`

**Interfaces:**
- Consumes: `readManifest(runDir)` (`plugin/bin/lib/flow/manifest.js`); `checkBranchLanded` (Task 1).
- Produces: `checkPassReentry(runDir: string, opts?: { cache?: object, deps?: { checkBranchLanded?: Function } }) => { eligible: boolean, reason: string, specIds: Array<number|string>, detail: string }` and `REENTRY_REASONS` (frozen array of the codes below). `specIds` is `manifest.multispec.specs[].id` in order (empty when no manifest). Checks run in this order, first failure wins:
  1. `archived` — `path.basename(path.dirname(runDir)) === 'archive'`
  2. `no-manifest` — `readManifest` returns null or zero specs
  3. `closed` — `run-state.json` status is `clean` (missing/unparseable run-state is not `closed`; fall through)
  4. `mode` — `config.yml` line `^mode:\s*(\S+)` absent or not `auto`/`hybrid`
  5. `console-exists` — `{runDir}/console.json` exists
  6. `spec-unfinished` — any spec status `pending`/`running`; `detail` names each as `#{id} {status}`
  7. `landed` — `checkBranchLanded(...).landed === true`
  8. `landed-unknown` — `landed === null`
  9. otherwise `eligible: true, reason: 'eligible'`
- Read-only. File reads use try/catch and treat a failure as "absent". Only the `checkBranchLanded` call is wrapped to map a throw to `landed-unknown` — a file-read problem must surface as its own reason, never as `landed-unknown`.

- [ ] **Step 1: Write the failing tests** — fixtures build a run dir under `{tmp}/.claude-tweaks/pipelines/2026-08-01T090000-spec-11-12/` with `manifest.yml` (two specs, ids 11 and 12, `status: complete`, the shape `manifestInit` writes), `config.yml` `mode: auto`, `run-state.json` `{status:'active'}`; inject `deps.checkBranchLanded` returning `{landed:false}` unless the test says otherwise. Tests:
  - `'AC4.1 eligible run -> eligible, specIds [11, 12]'`
  - `'AC4.1 console.json present -> console-exists'`
  - `'AC4.1 a spec running -> spec-unfinished naming #12 running'`
  - `'AC4.1 a spec pending -> spec-unfinished'`
  - `'AC4.1 mode interactive -> mode'`; also `config.yml` without a `mode:` line → `mode`
  - `'AC4.1 no manifest.yml -> no-manifest'`
  - `'#3497 archived dir -> archived'` (same files, parent dir named `archive`)
  - `'#3497 run-state clean -> closed'`
  - `'#3497 failed + not-run specs alongside complete -> eligible'`
  - `'#3497 landed true -> landed; landed null -> landed-unknown'`
  - `'#3497 real checkBranchLanded in a non-git tmp project -> landed-unknown, no throw'` (no `deps` injected)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/flow/consolidated-pass.test.js`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement** `plugin/bin/lib/flow/consolidated-pass.js` per the Interfaces block; header comment names #3497 and the reversed premise in one sentence.

- [ ] **Step 4: Run** — same command → PASS.

- [ ] **Step 5: Real-input probe** — run against the live unarchived run and one archived run, record the printed verdicts in the commit body:
  `node -e "const {checkPassReentry}=require('./plugin/bin/lib/flow/consolidated-pass.js');for(const d of process.argv.slice(1))console.log(d.split('/').pop(),JSON.stringify(checkPassReentry(d)))" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-08-30T105718-spec-1703-1704" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-17T100123-spec-3368-3365"`
  Expected: 1703-1704 → `spec-unfinished` (both `pending`, independently confirmed by `grep -c "status: pending"` on its manifest = 2); 3368-3365 → `archived`.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/flow/consolidated-pass.js tests/bin-lib/flow/consolidated-pass.test.js` then commit `"Add checkPassReentry — one eligibility rule for consolidated-pass re-entry (refs #3497)"`.

### Task 3: SessionStart banner suffix

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js` (`collectStaleRuns`, lines 54-81)
- Modify: `plugin/bin/hooks.js` (line ~1339 comment: "only a shipped-unclosed verdict embeds one" becomes "only a shipped-unclosed or pass-re-entry line embeds one" — no behavior change)
- Test: `tests/bin-lib/hooks/session-residue.test.js`, `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: `checkPassReentry` (Task 2).
- Produces: `collectStaleRuns` entry `line` = `{base}{suffix}` when eligible; unchanged otherwise. Order: the existing `shipped-unclosed` return stays first; the re-entry check runs only when that branch did not return, inside its own try/catch (advisory, never breaks the scan).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/hooks/session-residue.test.js` and `tests/hooks-session-start.test.js` (appended to both existing files). A shared git fixture (in each test file, modeled on `tests/run-integrity.test.js`'s `fixtureRepo` with `fixtureGit` from `tests/helpers/git-fixtures`): `trunk` integration branch via `policy.yml`, linked worktree on `feat-branch` with one commit dated after `2026-08-01T10:00:00Z`, run dir `2026-08-01T090000-spec-11-12` with `run-state.json {status:'active', worktree}`, `manifest.yml` (11, 12 complete), `config.yml mode: auto`, `events.jsonl` with build + wrap-up `skill_invoked` events.
  - session-residue.test.js `'AC5.1 eligible multi-spec parent line ends with the review-console command'` — `assert.ok(line.endsWith(' — consolidated pass never ran: /claude-tweaks:flow #11,#12 review-console'))`.
  - `'AC5.1 ineligible variants carry no suffix'` — for each mutation (write `console.json`; set spec 12 `running`; `mode: interactive`), `assert.doesNotMatch(line, /review-console/)`.
  - `'AC5.1 merged branch -> no suffix and no shipped line'` — merge `feat-branch` into `trunk`; assert line has neither `review-console` nor `appears shipped` (wrap-up events suppress shipped-unclosed; landed suppresses the suffix).
  - `'AC5.1 shipped-unclosed keeps the shipped line, no suffix'` — merged, events with build only (no wrap-up) → line matches `/appears shipped/` and not `/review-console/`.
  - Existing `mkRun` tests (non-git) stay byte-identical — no edits.
  - hooks-session-start.test.js `'AC6.1 SessionStart banner carries the review-console suffix for an eligible multi-spec run'` — `runSessionStart({input:{}, runDir:null, runState:null, cwd: root})`; `additionalContext` includes `/claude-tweaks:flow #11,#12 review-console`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="AC5.1" tests/bin-lib/hooks/session-residue.test.js`
Expected: FAIL — no review-console suffix on the line.

- [ ] **Step 3: Implement** in `collectStaleRuns` per Interfaces; build the ids as `specIds.map((id) => '#' + id).join(',')`.

- [ ] **Step 4: Run both files** — `node --test tests/bin-lib/hooks/session-residue.test.js tests/hooks-session-start.test.js` → PASS (old tests unchanged; AC6.1 included). Pass `{ cache }` from `collectStaleRuns` into `checkPassReentry` so SessionStart's per-invocation cache is shared; run `npm run test:perf` once and record the result (SessionStart timing budget).

- [ ] **Step 5: Commit** — stage the three files; commit `"Name the review-console re-entry in the unfinished-run banner (refs #3497)"`.

### Task 4: Skill prose — widen `review-console`, scope the fallback

**Files:**
- Modify: `plugin/skills/flow/steps-and-gates.md` (lines 22 and 39)
- Modify: `plugin/skills/flow/multispec-review-console.md` (line 213) and add a section after `## Locating the parent run directory` (line 44), before `## Numbering rules`
- Modify: `plugin/skills/flow/multi-spec.md` (lines 147 and 152)
- Modify: `plugin/skills/flow/multispec-batch-curation.md` ("When to run the batch pass", line 16)
- Modify: `docs/journeys/rejoin-a-multispec-run-with-a-spec-built-outside-flow-3033.md` step 5 (lines 45-49)
- Test: `tests/flow-pass-reentry-conformance.test.js` (new)

**Interfaces:**
- Consumes: `checkPassReentry`, `REENTRY_REASONS` (Task 2) — the prose invokes it, never restates the conditions.

- [ ] **Step 1: Write the failing conformance test** `tests/flow-pass-reentry-conformance.test.js` (live-prose reads, `collapse = s => s.replace(/\s+/g,' ')`). One `assertReentryProse(text)` per surface, used by both the positive test and a negative control on a doctored copy (go-red control check):
  - `'AC1.1 steps-and-gates.md names both entry conditions at both review-console sites'` — each of the two lines containing `` `review-console` `` (the bold resume-only paragraph and the valid-examples bullet) contains `after a Halt` AND `ended-parent re-entry`.
  - `'AC1.1 multispec-review-console.md On stop paragraph cross-references re-entry'` — the `## On stop (option 3)` section contains `ended-parent re-entry`.
  - `'AC1.2 multispec-review-console.md has the re-entry section'` — heading `## Re-entry after the parent session ended`, located after `## Locating the parent run directory` and before `## Numbering rules`; section contains `checkPassReentry`, `consolidated-pass.js`, `multispec-batch-curation.md` with `engine-state.json` (batch-pass-first), and `/claude-tweaks:wrap-up #{n}` (landed/archived stop message).
  - `'AC2.1 retired limit sentences are gone'` — no file under `plugin/skills` contains `no documented step re-runs the pass` or `only re-presents a console after a Halt` (walk with `fs.readdirSync(..., {recursive:true})`).
  - `'AC3.1 Mixed execution step 3 names the review-console re-entry'` — the step-3 bullet of `## Mixed execution` contains `/claude-tweaks:flow #{A},#{B} review-console`.
  - `'AC3.2 Already closed? is scoped to landed or archived and keeps the lossy fallback'` — the paragraph contains `landed`, `archived`, `/claude-tweaks:wrap-up #{n}`, and `never the run-level batch pass`.
  - `'#3497 every REENTRY_REASONS code is named in the re-entry section'` — loop `REENTRY_REASONS`, each `` `{code}` `` appears.
  - `'#3497 negative control'` — delete `ended-parent re-entry` from a copy of steps-and-gates.md; `assert.throws(() => assertReentryProse(...))`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/flow-pass-reentry-conformance.test.js`
Expected: FAIL — re-entry prose absent.

- [ ] **Step 3: Edit the prose** (content requirements; the implementer words it in the neighbouring style):
  - steps-and-gates.md:22 — `review-console` is accepted in two cases: resume **after a Halt** at the consolidated console, and **ended-parent re-entry** (the parent session ended before the pass ran; eligibility per `multispec-review-console.md`'s "Re-entry after the parent session ended"). Keep "Not a normal pipeline step; not valid in a comma-separated step list".
  - steps-and-gates.md:39 — same two cases, one line.
  - multispec-review-console.md new section `## Re-entry after the parent session ended` (≤1,400 bytes): resolve the parent run dir from `{specs}` (step 2 of Locating, or `PIPELINE_RUN_DIR` adoption — the parent dir must be adopted so Step 2.8's self-owned skip-guard holds the dead parent's claims); run `node -e` requiring `${CLAUDE_PLUGIN_ROOT}/bin/lib/flow/consolidated-pass.js` and printing `checkPassReentry(dir)` as JSON; on `eligible` run "When to run the consolidated console" from step 0 when `engine-state.json` is absent from the parent (batch pass first), else from step 1, then approval and Shared teardown as normal; on any other reason stop with one line naming `reason` + `detail`; for `landed`/`archived`/`closed` that line points at `/claude-tweaks:wrap-up #{n}` once per record. Name every `REENTRY_REASONS` code once. `spec-unfinished` line names the `hooks.js spec-status --run … --spec {id} --status complete` correction for a manifest left stale.
  - multispec-review-console.md:213 — after the Halt sentence add: the same step also serves ended-parent re-entry (see the new section).
  - multi-spec.md:147 — replace "If the parent session has already ended, no documented step re-runs the pass — `review-console` only re-presents a console after a Halt — so treat the run as already closed (below)." with: if the parent session has already ended, re-enter the pass with `/claude-tweaks:flow #{A},#{B} review-console` (`multispec-review-console.md`'s "Re-entry after the parent session ended") — the same pass, not a second path.
  - multi-spec.md:152 — "Already closed?" scoped to runs whose branch has landed, or whose run dir was archived or closed: nothing re-runs the pass then; keep the `/claude-tweaks:wrap-up #{n}` fallback sentence and "never the run-level batch pass".
  - multispec-batch-curation.md:16 — add one sentence: re-entry via `review-console` runs this pass first when the parent holds no `engine-state.json`.
  - journey step 5 — retitle to cover both paths: re-enter with `review-console` while the branch is unmerged; per-record fallback only once landed or archived; replace "Nothing re-runs a forfeited consolidated pass." accordingly.

- [ ] **Step 4: Run** — `node --test tests/flow-pass-reentry-conformance.test.js tests/flow-mixed-execution-convention.test.js tests/scratch-worktree-remote-branch-delete.test.js` → PASS. Then `wc -c plugin/skills/flow/multispec-review-console.md` < 51200 (and record the number).

- [ ] **Step 5: Commit** — stage the six files; commit `"Widen review-console into ended-parent re-entry; scope the per-record fallback (refs #3497)"`.

## Consumers checked (no change needed)

Check B surfaced these through the scope keywords; each was read and needs no edit: `plugin/bin/lib/hooks/session-start.js` and `plugin/bin/hooks.js` check-session-residue (render `e.line` verbatim — they gain the suffix for free); `plugin/bin/lib/reconcile/archive-merged.js`, `docs/reconcile-checks.md` (use `checkRunIntegrity`/`fallbackBranch`, whose outputs Task 1 keeps unchanged); `plugin/bin/lib/hooks/context.js` (event scanner, read-only dependency); `docs/hooks.md`, `docs/incident-log.md`, `plugin/skills/_shared/integration-branch.md` (descriptive mentions, still accurate); `tests/bin-lib/hooks/reconcile-background.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (exercise unchanged `checkRunIntegrity` behavior — run in Common Step 5's full suite).

## AC coverage map

| Clause | Test |
|---|---|
| AC1.1 | Task 4 `AC1.1` tests |
| AC1.2 | Task 4 `AC1.2` test |
| AC2.1 | Task 4 `AC2.1` test |
| AC3.1 | Task 4 `AC3.1` test |
| AC3.2 | Task 4 `AC3.2` tests |
| AC4.1 | Task 2 `AC4.1` tests |
| AC5.1 | Task 3 `AC5.1` tests |
| AC6.1 | Task 3 `AC6.1` test |
| AC7.1 | Every task's Step 2 red run before Step 3 (go-red) |
| AC8.1 | /build Common Step 5 full `npm test` |
