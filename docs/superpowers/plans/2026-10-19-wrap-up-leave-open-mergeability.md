# Wrap-up Leave-Open Mergeability Re-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pr-first run's Review Console resolves the merge half to leave-open, wrap-up's final phase-exit push acts on the PR's merge state: a `DIRTY` PR gets `origin/{integration-branch}` merged in (git's own auto-merge only) and re-pushed, a real conflict is reported, and the outcome is logged and named in the Verdict line and the flow summary's resume-to-merge row.

**Architecture:** Skill-prose change only. `_shared/git-discipline.md`'s Post-push merge-state check already reads the PR's merge state after every phase-exit push (`pr-merge-state.js --phase wrap-up` at wrap-up's exit) but routes "no catch-up at wrap-up's exit — the merge path owns it". On leave-open the merge path never runs. A new paragraph in `wrap-up/execution-and-verification.md` reuses that one read and runs that section's Catch-up steps with conflict resolution removed; the two report templates name the logged outcome.

**Tech Stack:** Markdown skill files; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T203713-record-3483/work/3483-spec.md`

Scope keywords: Leave-open mergeability

Premise-refs: plugin/skills/_shared/git-discipline.md
Premise-refs: plugin/bin/pr-merge-state.js
Premise-refs: plugin/bin/lib/console/resolve.js

## Global Constraints

- Log line shape (spec): `AUTO … mergeability: {CLEAN|BLOCKED|DIRTY → merged main as {sha}|DIRTY — conflict in {files}}`.
- Conflict Verdict wording (spec): `blocked — conflict with main in {files}`, never "everything shipped".
- Resolve nothing automatically beyond git's own auto-merge (spec Deliverable 1).
- Read the merge state once (spec). Premise reversal logged in `decisions.md`: the read already exists — `pr-merge-state.js --phase wrap-up` (prints `mergeStateStatus`, `plugin/bin/pr-merge-state.js:60-66`); reuse it, never a second `gh pr view`. `pack.pr` is a Phase 3 snapshot, stale by the final push.
- `console.json`'s leave-open value is the literal `leave-open` (`plugin/bin/lib/console/resolve.js:303-336`, `return { resolution: 'leave-open', … }`).
- Branch names in git commands go in quoted (`git-discipline.md`'s Catch-up step 2 rule).
- Byte headroom vs `RAIL_BYTES` = 52,500: `execution-and-verification.md` 13,274 B (+~2.6 KB → ~15.9 KB), `git-discipline.md` 20,414 B (+~0.3 KB), `wrap-up/summary-template.md` ~13 KB (+~0.9 KB), `flow/summary-template.md` 10,264 B (+~0.5 KB). All far under the rail.

## Review Focus

1. Leave-open via the attended "Approve all, leave PR open" choice (no `console.json` `leave-open`) — the paragraph must name both triggers. Pinned in Task 1's test.
2. A merge outcome of `merged`/`armed`/merge-path `pending-review` must NOT run this re-check (pr-first-merge.md Step 2.5 already read state). Pinned in Task 1's test.
3. A failed read (`read-failed`/`gh-absent`/`no-pr`) must not be reported as clean — it logs its state, keeps the existing SKIP. Pinned in Task 1's test.
4. A conflicted merge must never leave the tree mid-merge (`merge --abort` as its own Bash call) and must list the conflicting files before aborting. Pinned in Task 1's test (ordering assertion).
5. The existing git-discipline pin phrase `no catch-up runs there, in any mode — the merge path (\`_shared/pr-first-merge.md\`) owns a conflict from there` must survive (tests/git-discipline-merge-state-conformance.test.js:146-149). Task 1 appends after it rather than rewording it.

---

### Task 1: Leave-open re-check paragraph + git-discipline exception

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (insert a new paragraph after the `**Phase exit (\`worktree\` mode, \`integration-model: pr-first\`):**` paragraph ending "A no-op under `local-merge` or `current-branch` mode." and before `### Verify execution`)
- Modify: `plugin/skills/_shared/git-discipline.md:99-100` (the `**At wrap-up's exit**` bullet)
- Modify: `docs/journeys/notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md:54` (red flag "A catch-up attempted at wrap-up's exit (the merge path owns that case).")
- Create: `tests/wrap-up-leave-open-mergeability-conformance.test.js`

Moved-prose / prose-held pin check: no prose is moved. `git grep -n -F "At wrap-up's exit" -- tests plugin docs` hits git-discipline.md:99, the journey above, a historical plan (`docs/superpowers/plans/2026-10-19-phase-exit-merge-state-check.md`, left untouched), and the pin in `tests/git-discipline-merge-state-conformance.test.js:146-149`, whose phrase stays intact.

**Interfaces:**
- Produces: heading literal `**Leave-open mergeability re-check` in execution-and-verification.md; log `--step "Leave-open mergeability re-check"`; outcome vocabulary `mergeability: {outcome}` with outcomes `DIRTY → merged main as {after short}`, `DIRTY — conflict in {files}`, `DIRTY → nothing to merge (forge state stale)`, `DIRTY — not caught up ({reason})`, `{mergeStateStatus}`, `{state}`. Task 2's templates read these.
- Produces: test helper `assertLeaveOpenParagraph(text)` in the new test file; Task 2 adds tests to the same file.

- [ ] **Step 1: Write the failing test** — `tests/wrap-up-leave-open-mergeability-conformance.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');
// #3483: a pr-first run whose console resolves leave-open never reaches the merge path, so
// wrap-up's last phase-exit push owns a DIRTY PR there. These pins keep the prose on its ACs.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const EXEC = read('plugin', 'skills', 'wrap-up', 'execution-and-verification.md');
const GIT_DISCIPLINE = read('plugin', 'skills', '_shared', 'git-discipline.md');
const HEADING = '**Leave-open mergeability re-check';

function leaveOpenParagraph(text) {
  const start = text.indexOf(HEADING);
  assert.ok(start !== -1, `"${HEADING}" paragraph not found`);
  const phaseExit = text.indexOf('**Phase exit (`worktree` mode, `integration-model: pr-first`):**');
  const verify = text.indexOf('### Verify execution');
  assert.ok(phaseExit !== -1 && phaseExit < start && start < verify,
    'the paragraph sits after the Phase exit paragraph and before ### Verify execution');
  return text.slice(start, verify).replace(/\s+/g, ' ');
}

function assertLeaveOpenParagraph(text) {
  const p = leaveOpenParagraph(text);
  const has = (needle, msg) => assert.ok(p.includes(needle), `${msg}: missing ${JSON.stringify(needle)}`);
  // Triggers and exclusions.
  has("`merge.resolution` reads `leave-open`", 'trigger: console.json leave-open');
  has('"Approve all, leave PR open"', 'trigger: attended leave-open choice');
  has('`merged`, `armed`, or the merge path\'s own `pending-review` skips this paragraph', 'exclusion: merge-path outcomes');
  // One read, reused.
  has('`pr-merge-state.js --phase wrap-up`', 'reuses the post-push read');
  has('never a second read', 'reads once');
  // AC1.1 — clean auto-merge: commit pushed, decisions line names the sha.
  has("Catch-up steps 1-5", 'AC1.1: runs the shared catch-up');
  has('`DIRTY → merged main as {after short}`', 'AC1.1: decisions line names the merge sha');
  // AC2.1 — conflict: git auto-merge only, files listed before abort, decisions line names files.
  has('Step 4 never resolves a conflict', 'AC2.1: no conflict resolution');
  const list = p.indexOf('diff --name-only --diff-filter=U');
  const abort = p.indexOf('merge --abort');
  assert.ok(list !== -1 && abort !== -1 && list < abort, 'AC2.1: conflicting paths are listed before merge --abort');
  has('`DIRTY — conflict in {files}`', 'AC2.1: decisions line names the conflicting files');
  // AC3.1 — any other read: one log line, nothing else.
  has('log `mergeability: {mergeStateStatus}`', 'AC3.1: CLEAN/BLOCKED/UNKNOWN log one line');
  has('nothing else changes', 'AC3.1: nothing beyond the one log line');
  has('(`read-failed`, `gh-absent`, `no-pr`)', 'AC3.1: a failed read logs its state, never clean');
  // The log command.
  has('--step "Leave-open mergeability re-check"', 'log step name');
  has('--text "mergeability: {outcome}"', 'log text shape');
}

test('AC1.1/AC2.1/AC3.1: execution-and-verification.md carries the leave-open mergeability re-check', () => {
  assertLeaveOpenParagraph(EXEC);
});

test('go-red control: dropping the files-before-abort listing makes the shared assertion throw', () => {
  const mutated = EXEC.replace('diff --name-only --diff-filter=U', 'diff --stat');
  assert.ok(mutated !== EXEC, 'the control must actually mutate the text');
  assert.throws(() => assertLeaveOpenParagraph(mutated), /AC2\.1/);
});

test('git-discipline.md names the leave-open exception at wrap-up exit and keeps the merge-path rule', () => {
  const flat = GIT_DISCIPLINE.replace(/\s+/g, ' ');
  assert.ok(flat.includes('no catch-up runs there, in any mode — the merge path (`_shared/pr-first-merge.md`) owns a conflict from there'));
  assert.ok(flat.includes("`wrap-up/execution-and-verification.md`'s Leave-open mergeability re-check takes it"),
    'the wrap-up-exit bullet must point at the leave-open exception');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js`
Expected: FAIL with `"**Leave-open mergeability re-check" paragraph not found`

- [ ] **Step 3: Insert the paragraph into `plugin/skills/wrap-up/execution-and-verification.md`** — immediately after the Phase exit paragraph (ends "A no-op under\n`local-merge` or `current-branch` mode."), one blank line, then exactly (wrap at ~100 cols like the neighbours):

```markdown
**Leave-open mergeability re-check (`worktree` mode, `integration-model: pr-first`, #3483).** When
the Review Console's merge half resolved leave-open — `console.json`'s `merge.resolution` reads
`leave-open`, or an attended console chose "Approve all, leave PR open" — the merge path
(`_shared/pr-first-merge.md`) never runs, so the push above is the last time anything reads the PR
before a human opens it. A sibling merge that landed during the run can have left the PR `DIRTY`,
and GitHub then runs no `pull_request` workflow on it: the parked PR shows no test run, which reads
as "checks still pending" (#3298). Here the run takes the conflict that `_shared/git-discipline.md`'s
Post-push merge-state check otherwise leaves to the merge path at wrap-up's exit. Reuse the state
that check's `pr-merge-state.js --phase wrap-up` call just printed — never a second read — and
route on it in every mode; only git's own auto-merge runs, so there is no judgment to surface:

- **`conflicting`** — run that section's Catch-up steps 1-5 against this worktree, with two
  substitutions. Step 4 never resolves a conflict: on a conflicted merge, list the conflicting
  paths (`git -C "{worktree-path}" diff --name-only --diff-filter=U`), then run
  `git -C "{worktree-path}" merge --abort` as its own Bash call, and skip step 5. And the steps'
  own log lines give way to one `mergeability:` line: a clean merge step 5 pushed logs
  `DIRTY → merged main as {after short}`; a conflict logs `DIRTY — conflict in {files}`; a merge
  that brought in nothing (step 5's stale-forge case) logs `DIRTY → nothing to merge (forge state
  stale)`; a catch-up that could not run — step 1's uncommitted changes, a failed fetch or push —
  logs `DIRTY — not caught up ({reason})`.
- **Any other state** — log `mergeability: {mergeStateStatus}` (`CLEAN`, `BLOCKED`, `UNKNOWN`, …),
  or the printed `state` when no `mergeStateStatus` was read (`read-failed`, `gh-absent`, `no-pr`);
  nothing else changes. The `SKIP` that check already wrote for a failed read stays as written.

Log with `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO
--section "/wrap-up" --step "Leave-open mergeability re-check" --reversibility high --text
"mergeability: {outcome}"`. The phase-trace report's Verdict line (`summary-template.md`) and
`/claude-tweaks:flow`'s resume-to-merge row (`flow/summary-template.md`) name the same outcome, so a
parked PR whose CI GitHub suppressed is visible from the summary. A merge outcome of `merged`,
`armed`, or the merge path's own `pending-review` skips this paragraph — `_shared/pr-first-merge.md`
Step 2.5 already read the state on that path.
```

Note the test pins `--step "Leave-open mergeability re-check"` and `--text "mergeability: {outcome}"` against whitespace-collapsed text, so a line wrap inside either is fine only between tokens that are separated by a space.

- [ ] **Step 4: Amend `plugin/skills/_shared/git-discipline.md`'s wrap-up-exit bullet** — after "...owns a conflict from there, unchanged." append (same bullet, continuation-indented two spaces):

```markdown
  The one exception is a Review Console that resolved leave-open: the merge path never runs, so
  `wrap-up/execution-and-verification.md`'s Leave-open mergeability re-check takes it (git's own
  auto-merge only — a conflict is reported, never resolved).
```

- [ ] **Step 5: Amend the journey red flag** in `docs/journeys/notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md:54` to: `- A catch-up attempted at wrap-up's exit when the merge path runs (it owns that case); only a leave-open run catches up there, per \`wrap-up/execution-and-verification.md\`.` and add `plugin/skills/wrap-up/execution-and-verification.md` to its `files:` frontmatter list.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js tests/git-discipline-merge-state-conformance.test.js tests/wrap-up-verify-execution-pin.test.js`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md plugin/skills/_shared/git-discipline.md docs/journeys/notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md tests/wrap-up-leave-open-mergeability-conformance.test.js
git commit -m "Add wrap-up leave-open mergeability re-check — merge main into a DIRTY parked PR, refs #3483"
```

### Task 2: Name the outcome in the Verdict line and the flow resume-to-merge row

**Files:**
- Modify: `plugin/skills/wrap-up/summary-template.md` (insert inside the template fence, after the `**Reporting a structural verify fail that's out of this run's own reach (#2550).**` paragraph, before `### State`)
- Modify: `plugin/skills/flow/summary-template.md:100` and `:106-108` (Next Actions resume row + "Resume-to-merge row." paragraph + its restated row)
- Test: `tests/wrap-up-leave-open-mergeability-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's outcome vocabulary (`DIRTY → merged main as {sha}`, `DIRTY — conflict in {files}`, `DIRTY — not caught up ({reason})`) and its `--step "Leave-open mergeability re-check"` decisions line (producer).

- [ ] **Step 1: Append the failing tests**

```js
const WRAP_SUMMARY = read('plugin', 'skills', 'wrap-up', 'summary-template.md');
const FLOW_SUMMARY = read('plugin', 'skills', 'flow', 'summary-template.md');

function assertVerdictRule(text) {
  const flat = text.replace(/\s+/g, ' ');
  const start = flat.indexOf('**Leave-open mergeability (#3483).**');
  const state = flat.indexOf('### State');
  assert.ok(start !== -1 && start < state, 'AC2.1: the Verdict rule sits before ### State');
  const rule = flat.slice(start, state);
  assert.ok(rule.includes('`blocked — conflict with main in {files}`'), 'AC2.1: conflict Verdict wording');
  assert.ok(rule.includes('never "everything shipped"'), 'AC2.1: never everything shipped');
  assert.ok(rule.includes('`decisions.md` line'), 'AC2.1: read from the decisions line, never memory');
}

function assertResumeRow(text) {
  const flat = text.replace(/\s+/g, ' ');
  const row = '— resume to re-offer the merge decision, PR #{n} {is ready | is blocked} — mergeability: {outcome}';
  const first = flat.indexOf(row);
  assert.ok(first !== -1, 'AC1.2: the Next Actions resume row names the mergeability outcome');
  assert.ok(flat.indexOf(row, first + 1) !== -1, 'AC1.2: the Resume-to-merge row restatement names it too');
  assert.ok(flat.includes('Leave-open mergeability re-check'), 'AC1.2: the row cites its producer');
  assert.ok(flat.includes('DIRTY → merged main as {sha}'), 'AC1.2: the row names the merge');
}

test('AC2.1: wrap-up Verdict reads blocked on a leave-open conflict', () => {
  assertVerdictRule(WRAP_SUMMARY);
});

test('AC1.2: flow summary resume-to-merge row names the mergeability outcome', () => {
  assertResumeRow(FLOW_SUMMARY);
});

test('go-red control: an unnamed resume row or a softened Verdict makes the shared assertions throw', () => {
  const row = FLOW_SUMMARY.split('{is ready | is blocked} — mergeability: {outcome}').join('is ready');
  assert.ok(row !== FLOW_SUMMARY, 'the control must actually mutate the text');
  assert.throws(() => assertResumeRow(row), /AC1\.2/);
  const verdict = WRAP_SUMMARY.replace('never "everything shipped"', 'usually not "everything shipped"');
  assert.ok(verdict !== WRAP_SUMMARY, 'the control must actually mutate the text');
  assert.throws(() => assertVerdictRule(verdict), /AC2\.1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js`
Expected: FAIL with `AC2.1: the Verdict rule sits before ### State`

- [ ] **Step 3: Insert into `plugin/skills/wrap-up/summary-template.md`** (inside the fence, after the #2550 paragraph's last line "never a general license to downgrade an unrelated failure.", one blank line before `### State`), wrapped like its neighbour:

```markdown
**Leave-open mergeability (#3483).** When the run left its PR open,
`execution-and-verification.md`'s Leave-open mergeability re-check logged
one `mergeability:` outcome — read it from that `decisions.md` line, never
from memory, and name it in the Verdict. `DIRTY → merged main as {sha}`
reads as caught up ("PR #{n} left open, caught up with main as {sha} — CI
runs on the new head"). `DIRTY — conflict in {files}` makes the Verdict
read `blocked — conflict with main in {files}`, never "everything shipped":
a PR GitHub runs no CI on has not shipped. `DIRTY — not caught up
({reason})` reads `blocked — PR conflicts with main, not caught up
({reason})`. Any other outcome (`CLEAN`, `BLOCKED`, `UNKNOWN`, a failed
read) adds nothing to the Verdict.
```

- [ ] **Step 4: Edit `plugin/skills/flow/summary-template.md`** — in both places the row appears (line 100's Next Actions list and line 108's restatement), replace `PR #{n} is ready` with `PR #{n} {is ready | is blocked} — mergeability: {outcome}` (line 100 keeps its trailing ` — when this run's own outcome is armed/pending-review under pr-first`). Then append to the "**Resume-to-merge row.**" paragraph, before the restated row:

```markdown
`{outcome}` is the `mergeability:` outcome wrap-up's Leave-open mergeability re-check
(`wrap-up/execution-and-verification.md`) logged to `decisions.md`, verbatim — e.g.
`DIRTY → merged main as {sha}` — so a parked PR whose CI GitHub suppressed is visible from this
summary; `is blocked` replaces `is ready` when that outcome is `DIRTY — conflict in {files}` or
`DIRTY — not caught up ({reason})`. No such line (an `armed` or merge-path `pending-review`
outcome) drops the ` — mergeability: {outcome}` suffix.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/release-recommendation-gate-conformance.test.js tests/next-actions-premise.test.js`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/summary-template.md plugin/skills/flow/summary-template.md tests/wrap-up-leave-open-mergeability-conformance.test.js
git commit -m "Name the leave-open mergeability outcome in the Verdict and resume-to-merge row, refs #3483"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (read once, merge main on DIRTY, report conflict) | Task 1 |
| Deliverable 2 (decisions.md line; Verdict line; resume row) | Task 1 (log), Task 2 (Verdict, row) |
| Deliverable 3 (conformance test pins both files) | Tasks 1-2 |
| AC1.1 | Task 1 test `AC1.1/AC2.1/AC3.1` |
| AC1.2 | Task 2 test `AC1.2` |
| AC2.1 | Task 1 test (decisions line) + Task 2 test (Verdict) |
| AC3.1 | Task 1 test |

## As-built deviations (Common Step 4.5 — all Beneficial)

1. Read source: the re-check reuses git-discipline.md's post-push `pr-merge-state.js --phase wrap-up` read and, when that read printed `unknown` or exited 3 (cleanup item 8 archived the run dir before wrap-up's push), takes one read of its own as the last call before Verify execution against the live or archive run-dir path — instead of the spec's `pack.pr` shape (a stale Phase 3 snapshot). Final-review finding, fix 6b5095932.
2. The Verdict line and the flow resume-to-merge row name only a `DIRTY …` outcome; CLEAN/BLOCKED/UNKNOWN/failed reads stay in decisions.md only — spec AC3 over the plan's "name the same outcome" (SDD ruling, staged/sdd-ruling-1.md; fix 022f7e117).
3. The re-check runs git's own auto-merge in every mode (spec silent); git-discipline.md's interactive/hybrid sentence and the #2986 journey name the exception (6b5095932).
4. git-discipline.md's "no catch-up at wrap-up's exit" and "`unknown` never re-read" bullets name the leave-open exception, and the journey's red flag was reworded, so no skill file contradicts the new paragraph.
