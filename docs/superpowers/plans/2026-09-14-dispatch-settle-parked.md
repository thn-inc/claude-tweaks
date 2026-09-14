# Dispatch --settle-parked Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/claude-tweaks:dispatch --settle-parked` standalone entry point that batches every open `bot:parked` PR into one human-present review (freshness probe + CI read + multi-select confirm), then sequentially resumes only the selected PRs through `resume-confirmation.md`'s existing re-adopt mechanics.

**Architecture:** `--settle-parked` is a new, mutually-exclusive form of `/claude-tweaks:dispatch` (same posture as `backlog refine --reset-breaker`): human-present only, never Routine-fired. Its procedure lives in a new sub-file, `plugin/skills/dispatch/settle-parked.md`, cited from `SKILL.md`'s Input/Workflow sections. It reuses `resume-confirmation.md`'s freshness probe (`check-resume-freshness`) and re-adopt mechanism (`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up`) rather than reimplementing them, and `_shared/github-pr-scan.md`'s `bot:parked` label-fetch shape for discovery.

**Tech Stack:** Markdown skill-prose editing (this plugin's skills are natural-language procedures, not executable code) + `node --test` prose-conformance tests pinning the new wording, mirroring `tests/dispatch-drain-overlap-prose.test.js`'s style.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T185249-record-2428/work/2428-spec.md` (materialized from record #2428)

## Global Constraints

- `--settle-parked` is mutually exclusive with a ref (`#N`) or `--budget` — reject the combination with a one-line notice, perform no fetch (spec AC1).
- Human-present only, never invoked by a scheduled Routine (spec's Overview, Non-Goals).
- Does not change `merge-check`'s `needs-human` classification and does not touch `_shared/policy-schema.md` or the `autonomy` ceiling (spec Non-Goals).
- Never resumes two selected PRs in parallel — strictly sequential (spec Non-Goals, Gotchas).
- Reuses `resume-confirmation.md`'s freshness-probe and re-adopt mechanics; does not reimplement resume logic (spec Technical Approach).

---

### Task 1: Add `--settle-parked` to dispatch's Input grammar

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md:3` (frontmatter `argument-hint`)
- Modify: `plugin/skills/dispatch/SKILL.md:40-55` (`## Input` section)
- Test: `tests/dispatch-settle-parked-prose.test.js` (new)

**Interfaces:**
- Produces: the literal grammar row and mutual-exclusion sentence that Task 2's test file (Task 4) and Task 2's `## Settle Parked` pointer section both cite by exact substring.

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-settle-parked-prose.test.js`:

```javascript
// tests/dispatch-settle-parked-prose.test.js
//
// Pins record #2428's --settle-parked entry point: dispatch/SKILL.md's Input
// grammar and mutual-exclusion rule, and settle-parked.md's fetch/freshness/
// batch-confirm/sequential-resume procedure.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');
const SETTLE_PARKED = read('plugin/skills/dispatch/settle-parked.md');

test('argument-hint and Input grammar advertise --settle-parked', () => {
  assert.match(DISPATCH_SKILL, /argument-hint:.*--settle-parked/);
  assert.match(DISPATCH_SKILL, /`--settle-parked`/);
});

test('--settle-parked is rejected when combined with a ref or --budget', () => {
  assert.match(DISPATCH_SKILL, /--settle-parked.*mutually exclusive/i);
});

test('--settle-parked is human-present only, never Routine-fired', () => {
  assert.match(DISPATCH_SKILL, /--settle-parked.*human-present only, never.*Routine/is);
});

test('settle-parked.md fetches bot:parked PRs and excludes BLOCKED rows separately', () => {
  assert.match(SETTLE_PARKED, /bot:parked/);
  assert.match(SETTLE_PARKED, /excluded — still live/);
  assert.match(SETTLE_PARKED, /check-resume-freshness/);
});

test('settle-parked.md renders a multi-select AskUserQuestion, distinct from resume-confirmation.md\'s single-select', () => {
  assert.match(SETTLE_PARKED, /multiSelect.*true/is);
  assert.match(SETTLE_PARKED, /multi-select/i);
});

test('settle-parked.md re-probes freshness immediately before each resume and continues past a BLOCKED result', () => {
  assert.match(SETTLE_PARKED, /second.*freshness/is);
  assert.match(SETTLE_PARKED, /continues to the next selected PR/i);
});

test('settle-parked.md resumes into the PR\'s own resolved run-dir via wrap-up, never a newly-minted one', () => {
  assert.match(SETTLE_PARKED, /PIPELINE_RUN_DIR="\{run-dir\}" \/claude-tweaks:flow "\{target\}" wrap-up/);
});

test('SKILL.md points to settle-parked.md for the full procedure', () => {
  assert.match(DISPATCH_SKILL, /settle-parked\.md/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-settle-parked-prose.test.js`
Expected: FAIL — `plugin/skills/dispatch/settle-parked.md` does not exist yet (module resolution / `ENOENT` error), and none of the asserted strings exist in `SKILL.md`.

- [ ] **Step 3: Edit SKILL.md's frontmatter and Input section**

In `plugin/skills/dispatch/SKILL.md`, change the frontmatter `argument-hint` (line 3) from:

```yaml
argument-hint: "[#N[,#M...]] [--budget <n|all>] [--priority high|medium|low]"
```

to:

```yaml
argument-hint: "[#N[,#M...]] [--budget <n|all>] [--priority high|medium|low] [--settle-parked]"
```

Add one row to the `## Input` table (after the `--priority` row, before the "Repo-wide infra outage stop" paragraph):

```markdown
| `--settle-parked` (standalone form) | Batch-review every open `bot:parked` PR in one pass and let a human pick which subset to resume — human-present only, never invoked by a scheduled Routine (same posture as `backlog refine --reset-breaker`). **Mutually exclusive** with a ref (`#N`/`#N,#M,...`) or `--budget` — reject the combination with a one-line notice and perform no fetch. Read `settle-parked.md` in this skill's directory for the full fetch/freshness-probe/batch-confirm/sequential-resume procedure. |
```

- [ ] **Step 4: Run test to verify the SKILL.md assertions now pass (settle-parked.md ones still fail)**

Run: `node --test tests/dispatch-settle-parked-prose.test.js`
Expected: the four `DISPATCH_SKILL`-only assertions pass; the `SETTLE_PARKED` assertions still fail (file doesn't exist) — confirms Step 3 wrote the right substrings before Task 2 creates the cited file.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md tests/dispatch-settle-parked-prose.test.js
git commit -m "dispatch: add --settle-parked to Input grammar (refs #2428)"
```

---

### Task 2: Write settle-parked.md's fetch, freshness-probe, and batch-confirm procedure

**Files:**
- Create: `plugin/skills/dispatch/settle-parked.md`
- Test: `tests/dispatch-settle-parked-prose.test.js` (from Task 1, extended assertions already present)

**Interfaces:**
- Consumes: `resume-confirmation.md`'s `check-resume-freshness` probe and re-adopt command shape (already documented in that file — cite, don't restate); `_shared/github-pr-scan.md`'s `bot:parked` label-fetch convention.
- Produces: the batch table shape and the multi-select `AskUserQuestion` call Task 3 (SKILL.md's `## Settle Parked` pointer section) links to.

- [ ] **Step 1: Write the failing test**

Already written in Task 1 (the `SETTLE_PARKED` assertions in `tests/dispatch-settle-parked-prose.test.js`). No new test file — extend coverage by re-running the existing suite after this task's file lands.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-settle-parked-prose.test.js`
Expected: FAIL — `plugin/skills/dispatch/settle-parked.md` does not exist (`ENOENT` on `read('plugin/skills/dispatch/settle-parked.md')`).

- [ ] **Step 3: Create settle-parked.md**

```markdown
# Dispatch — Settle Parked (`--settle-parked`)

Canonical procedure for `/claude-tweaks:dispatch --settle-parked` (`SKILL.md`'s Input
table): a batch review of every open `bot:parked` PR, so a human settles a whole
backlog of parked runs in one pass instead of looping `resume-confirmation.md`'s
per-PR confirm one PR at a time.

**Standalone form, human-present only.** Same posture as `backlog refine
--reset-breaker` — never invoked by a scheduled Routine, and rejected in
combination with a ref (`#N`/`#N,#M,...`) or `--budget` (mutually exclusive;
report the conflict and perform no fetch, mirroring `backlog/SKILL.md`'s
`--source` conflict rule).

This does not change `merge-check`'s `needs-human` classification, and does not
touch `_shared/policy-schema.md` or the `autonomy` ceiling — it only collapses
the per-PR "do you want to look?" click `resume-confirmation.md` already asks
into a single batch decision.

## Step 1: Fetch every open `bot:parked` PR

```bash
gh pr list --repo {owner}/{repo} --label bot:parked --state open \
  --json number,title,headRefName,url,isDraft
```

For each result, resolve its run-dir from the PR body's `claude-tweaks-run:`
marker (dual-marker scheme — `_shared/pr-early-run-lifecycle.md`: read the
HTML-comment form on a `gh`-present read, the plain-text companion form on a
`gh`-absent MCP read) rather than re-deriving it from the branch name.

## Step 2: Freshness probe + fresh CI read, per PR

For each PR resolved in Step 1, run two checks — reusing
`resume-confirmation.md`'s existing mechanics rather than reimplementing them:

1. **Freshness probe:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-resume-freshness --run "{run-dir}"` — same call `resume-confirmation.md` makes before its own per-PR resume.
2. **Fresh CI/mergeability read:** `gh pr view {n} --json state,mergeStateStatus,statusCheckRollup` — the same shape `_shared/pr-first-merge.md`'s Step 2.5 state read already uses.

**A `BLOCKED` freshness result (worktree live, or recently committed) is
excluded from the batch table** — it is not silently dropped: report it on a
separate `excluded — still live` line naming the PR, so the human sees it was
considered and why it isn't offered. Every other PR (an `OK` freshness result)
proceeds to Step 3.

## Step 3: Render the batch table and multi-select confirm

One table, one row per eligible PR from Step 2:

```markdown
| Target | PR # | Park reason | CI status | Files changed |
|---|---|---|---|---|
| #123 | #456 | check-failed:test | passing | 3 |
| #789 | #790 | checks-pending-timeout | pending | 1 |
```

- **Park reason** — parsed from the original park comment `_shared/pr-first-merge.md`'s Red path posted (the `reason: check-failed:{names} | checks-pending-timeout` text `_shared/pr-first-merge.md`'s Step 2.5 log line already uses).
- **CI status** — summarized from Step 2's `statusCheckRollup` as `passing`/`failing`/`pending`, same vocabulary `resume-confirmation.md` uses.
- **Files changed** — from `gh pr diff {n} --name-only | wc -l`.

Then one `AskUserQuestion` call, **multi-select** — distinct from
`resume-confirmation.md`'s own per-PR single-select question:

```
question: "Which parked PRs should resume toward merge? Unselected rows stay parked, untouched."
header: "Settle parked PRs"
multiSelect: true
options: one per eligible row — label: "#{n} (PR #{pr})", description: "{park reason} · CI: {status} · {files} files"
```

Unpicked rows are left exactly as they are — `bot:parked` label and worktree
untouched, nothing written.

## Step 4: Sequential resume, selected PRs only

For each PR the human selected in Step 3, **in order, never in parallel** (see
`SKILL.md`'s Anti-Patterns and the spec's Non-Goals — two concurrent
`/claude-tweaks:flow ... wrap-up` invocations against one session have no
supported way to render two Review Consoles at once):

1. **Skip `resume-confirmation.md`'s own per-PR `AskUserQuestion`** — the batch
   step above already made that decision for this PR.
2. **Re-run the freshness probe** (`check-resume-freshness`) immediately before
   resuming — state can drift between batch-confirm and this PR's turn in the
   sequence, especially for the last PR in a long batch. A `BLOCKED` result
   here: report it (naming the PR and the blocking reason), leave it parked,
   and **continue to the next selected PR** — never abort the rest of the
   batch over one PR's drift.
3. **Resume**, from inside this PR's own already-assigned worktree:
   `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — the
   PR's own resolved run-dir from Step 1, never a newly-minted one. Let that
   run's own Review Console render fully before moving to the next selected
   PR.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Resuming two selected PRs in parallel | Each resume re-adopts a worktree and its own `/claude-tweaks:flow ... wrap-up` invocation renders its own Review Console — no supported way to run two concurrently against one session |
| Aborting the whole batch when one selected PR's pre-resume freshness check returns `BLOCKED` | That PR alone stays parked and reports why; every other selected PR still resumes |
| Reusing `resume-confirmation.md`'s single-select question for the batch step | Defeats the point of batching — one PR at a time is exactly what this entry point exists to collapse |
| Silently dropping a `BLOCKED` PR from the batch table with no trace | Report it on its own `excluded — still live` line so the human knows it was considered |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dispatch-settle-parked-prose.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/settle-parked.md
git commit -m "dispatch: add settle-parked.md's fetch/freshness/batch-confirm/resume procedure (refs #2428)"
```

---

### Task 3: Wire settle-parked.md into SKILL.md's Workflow, Component-Skill Contract, and Anti-Patterns

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md:84` (`## Workflow` — add a `## Settle Parked` section)
- Modify: `plugin/skills/dispatch/SKILL.md` — `## Component-Skill Contract` section
- Modify: `plugin/skills/dispatch/SKILL.md` — `## Anti-Patterns` table
- Test: `tests/dispatch-settle-parked-prose.test.js` (Task 1's `settle-parked.md` pointer assertion already covers the `## Settle Parked` section; this task adds no new assertions, it satisfies the existing "SKILL.md points to settle-parked.md" test from a second angle)

**Interfaces:**
- Consumes: nothing new — cites Task 2's `settle-parked.md` by relative reference.
- Produces: nothing new consumed by a later task — this is the last content task before verification.

- [ ] **Step 1: (no new test — Task 1's `settle-parked\.md` assertion already exercises this)**

- [ ] **Step 2: (n/a — see Step 1)**

- [ ] **Step 3: Add the `## Settle Parked` section**

Insert a new top-level section immediately before `## Preflight` in
`plugin/skills/dispatch/SKILL.md` (after the `## Input` section's closing
paragraph):

```markdown
## Settle Parked

`--settle-parked` skips the rest of this file's Preflight/Workflow (queue
pull, ranking, group claiming, minting — none of that applies to a batch
review of already-parked PRs) and instead follows `settle-parked.md` in this
skill's directory end to end: fetch every open `bot:parked` PR, freshness-
probe and CI-read each one, render the batch table and multi-select confirm,
then sequentially resume only the selected PRs. Read that file now if
`--settle-parked` is the resolved form.
```

Add one row to `## Anti-Patterns`:

```markdown
| Resuming `--settle-parked`-selected PRs in parallel, or in a headless/Routine-fired context | Sequential-only by design (see `settle-parked.md`'s own Anti-Patterns); human-present-only, same posture as `backlog refine --reset-breaker` |
```

Add one sentence to `## Component-Skill Contract`, after the existing
"never invoked as a pipeline component" sentence:

```markdown
`--settle-parked` carries the same human-present-only posture as `backlog refine --reset-breaker` — never Routine-fired, and never invoked by another skill.
```

- [ ] **Step 4: Run the full prose-conformance test file to verify it passes**

Run: `node --test tests/dispatch-settle-parked-prose.test.js`
Expected: PASS — all 8 assertions green (unchanged from Task 2's Step 4; this task adds prose but no new pinned assertions).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md
git commit -m "dispatch: wire settle-parked.md into Workflow, Anti-Patterns, Component-Skill Contract (refs #2428)"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test 2>&1 | tail -60`
Expected: PASS — all suites green, including the three new/modified prose-conformance assertions from Tasks 1-3.

- [ ] **Step 2: Fix any unrelated failures if the full suite surfaces them**

If `npm test` reports failures outside `tests/dispatch-settle-parked-prose.test.js`
or any test asserting on `plugin/skills/dispatch/SKILL.md`'s byte content (a
sibling conformance test that pins an exact section list or line count could
be affected by this plan's insertions) — read the failing assertion, and
either adjust this plan's insertion point/wording to satisfy it (if the
existing test's expectation is still correct) or flag it as a pre-existing
conflict requiring a design decision (never silently work around a real
conformance test).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "dispatch: settle-parked fixups after full suite verification (refs #2428)"
```

(Skip this step entirely if Step 1 passed clean with no fixes needed.)
