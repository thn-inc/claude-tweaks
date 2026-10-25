# Close-out update path (#4273) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:dispatch close-out` offers a human-present, re-verified "update from {base}" path for a `DIRTY`/`CONFLICTING` or `BEHIND` candidate instead of a flag-only stop, while `_shared/github-pr-scan.md` item 11's headless sweep stays flag-only.

**Architecture:** A new lazy-loaded sub-file `plugin/skills/dispatch/close-out-update.md` holds the whole update procedure (offer → isolated worktree → merge or `gh pr update-branch` → full-suite `verify.js` → push → fresh CI read on the new HEAD → teardown), read only when step 2 finds a conflicting or behind PR — the same split `close-out-confirmation.md` already uses. `close-out.md` step 2 routes to it; `close-out-confirmation.md`'s question names the update; item 11 and the docs mirrors are re-pointed. Prose only, pinned by the existing close-out conformance test file.

**Tech Stack:** Markdown skill prose; `node --test` conformance tests (`tests/helpers/read-skill`'s `readText`).

**Spec:** `.claude-tweaks/pipelines/2026-10-25T135420-record-4273/work/4273-spec.md`

Scope keywords: pr-stale, rebase and re-verify, close-out-confirmation

## Global Constraints

- The update merges `origin/{base}` into the PR branch — never a rebase, never a force push (`_shared/git-discipline.md`'s Rules and Catch-up paragraph).
- `BEHIND` with no conflicts uses `gh pr update-branch {number}` — never with `--rebase`.
- A PR updated by close-out is never merged without a passing full-suite `verify.js` stamp matching the new HEAD and a green CI read on that HEAD.
- Declining the update offer leaves the PR exactly as it was.
- `_shared/github-pr-scan.md` item 11 stays flag-only.
- The `pr-scan` composed bundle (`tidy/scan-procedures.md` line 255) composes `github-pr-scan.md` at 50,138 B against the same rail — Task 3 net delta stays under +300 B.
- `plugin/skills/**/*.md` files stay under `RAIL_BYTES` = 52,500 B. Headroom at plan time: `_shared/github-pr-scan.md` 50,120 B (2,380 B left — Task 3 must be close to byte-neutral), `dispatch/SKILL.md` 47,989 B (4,511 B left), `dispatch/close-out.md` 10,171 B, `dispatch/close-out-confirmation.md` 4,098 B.
- Skill references in actionable instruction text use `/claude-tweaks:{skill}`; cite canonical procedures (`_shared/*.md`, `test/verification.md`) rather than restating them.

## Review Focus

1. The run's original worktree may still exist and hold the PR branch checked out (the reconciler reaps only on merged evidence) — the update must not try to check that branch out a second time or write into a live session's worktree; it uses its own detached worktree. (Task 1 pins the detached `.worktrees/close-out-{number}` worktree.)
2. A fresh worktree has no installed dependencies — a project with a lockfile fails `npm test` there for a reason unrelated to the update. (Task 1 pins the install step.)
3. Right after the push GitHub reports CI `pending` and mergeability `UNKNOWN`; step 1's own `pending` → stop rule would stop every updated candidate. The update waits on `gh pr checks --watch` (human present) before re-running step 1. (Task 1 pins it.)
4. A conflict resolution that keeps both texts but drops one side's intent (the #4205 incident: a resolved file whose test went red only under the full suite). The full suite gate is what catches it; a resolution the agent is unsure about goes to the human, who is present. (Task 1 pins the full-suite stamp read and the ask-the-human fallback.)
5. `BEHIND` declined must proceed exactly as today (BEHIND was never a stop); `DIRTY` declined must stop exactly as today. (Task 1 pins both declines.)

---

### Task 1: The update procedure and close-out step 2's routing

**Files:**
- Create: `plugin/skills/dispatch/close-out-update.md`
- Modify: `plugin/skills/dispatch/close-out.md` (intro paragraph lines 3-13, step 2 lines 42-57, Reporting line 104-106, Anti-Patterns table lines 113-120)
- Test: `tests/close-out-pr-state-contract-conformance.test.js`

**Interfaces:**
- Produces (consumed by Task 2): close-out-update.md ends by handing the confirmation gate three values named exactly `{update-method}` (`merge` or `gh pr update-branch`), `{conflicted-files}` (comma-joined paths, or `none`), and `{resolution-commit}` (short SHA of the merge commit that is the PR's new HEAD — the conflict-resolution merge on the `DIRTY` path, GitHub's update merge on the `BEHIND` path).
- Produces (consumed by Task 3): the file name `close-out-update.md` and its outcome strings below.

- [ ] **Step 1: Write the failing tests** — append to `tests/close-out-pr-state-contract-conformance.test.js` (keep the four existing tests unchanged; `STEP_2` keeps its current anchors `2. **Re-check mergeability` / `3. **Convert draft to ready`). Add `const UPDATE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'close-out-update.md'));` and one shared assertion function used by both the positive test and the go-red control:

```js
function assertUpdateRouting(step2, update, closeOut) {
  // AC1.1 — DIRTY/CONFLICTING and BEHIND route to the update offer, not only a stop
  assert.match(step2, /DIRTY[\s\S]{0,300}close-out-update\.md/, 'AC1.1: DIRTY routes to close-out-update.md');
  assert.match(step2, /CONFLICTING/, 'AC1.1: mergeable CONFLICTING is treated like DIRTY');
  assert.match(step2, /BEHIND[\s\S]{0,300}close-out-update\.md/, 'AC1.1: BEHIND routes to close-out-update.md');
  assert.ok(!step2.includes('rebase and re-verify'), 'AC1.1: the old rebase recommendation is gone from step 2');
  // AC1.2 — declining leaves the PR exactly as it was
  assert.match(update, /[Dd]eclin[\s\S]{0,200}exactly as it was/, 'AC1.2: declining leaves the PR exactly as it was');
  // AC2.1 — full-suite verify.js stamp on the new HEAD + green CI on that HEAD
  assert.ok(update.includes('verify.js') && update.includes('--stamp-status'), 'AC2.1: verify.js run and stamp read');
  assert.match(update, /verifiedHead[\s\S]{0,200}scope[\s\S]{0,40}full/, 'AC2.1: stamp must be verifiedHead + scope full');
  assert.match(update, /headRefOid/, 'AC2.1: CI read is tied to the PR head SHA');
  assert.ok(update.includes('gh pr checks') && update.includes('--watch'), 'AC2.1: waits for the new HEAD\'s checks');
  assert.match(update, /step 1/i, 'AC2.1: re-runs close-out step 1 on the new HEAD');
  // AC4.1 — no path rebases or force-pushes
  assert.match(update, /never a rebase/i, 'AC4.1: states never a rebase');
  assert.match(update, /force[- ]push/i, 'AC4.1: states never a force push');
  assert.ok(update.includes('gh pr update-branch'), 'AC4.1: BEHIND uses gh pr update-branch');
  const spans = [...update.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  for (const s of spans) {
    assert.ok(!/^git\b.*\brebase\b/.test(s), `AC4.1: no git rebase command: ${s}`);
    assert.ok(!/^git\b.*\bpush\b.*(--force|\s-f\b)/.test(s), `AC4.1: no force push command: ${s}`);
    assert.ok(!/^gh pr update-branch\b.*--rebase/.test(s), `AC4.1: no update-branch --rebase: ${s}`);
  }
  // AC5.1 (close-out half) — the Anti-Patterns ban is rescoped to the headless sweep
  assert.ok(!closeOut.includes('Rebasing a `DIRTY` candidate to clear it automatically'), 'AC5.1: old anti-pattern row removed');
  assert.match(closeOut, /\| Rebasing or force-pushing[^\n]*item 11[^\n]*\|/, 'AC5.1: rescoped anti-pattern row names item 11');
}

test('AC1.1/AC1.2/AC2.1/AC4.1/AC5.1: step 2 routes conflicting and behind PRs to the re-verified update path', () => {
  assertUpdateRouting(STEP_2, UPDATE, CLOSE_OUT);
});

test('go-red control: dropping the DIRTY routing from step 2 fails the same assertions', () => {
  const mutated = STEP_2.replace(/close-out-update\.md/g, 'REMOVED');
  assert.throws(() => assertUpdateRouting(mutated, UPDATE, CLOSE_OUT));
});

test('Review Focus: isolated detached worktree, dependency install, declines', () => {
  assert.match(UPDATE, /\.worktrees\/close-out-\{number\}/, 'own detached worktree under .worktrees/');
  assert.match(UPDATE, /--detach/, 'detached at origin/{head}, never the branch the run worktree may hold');
  assert.match(UPDATE, /git worktree remove/, 'torn down with git worktree remove (ExitWorktree does not operate on .worktrees/)');
  assert.match(UPDATE, /lockfile/i, 'installs dependencies before verifying');
  assert.match(UPDATE, /BEHIND[\s\S]{0,400}continue/i, 'a declined BEHIND update continues to step 3 as before');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: FAIL — `ENOENT` on `close-out-update.md` at module load (every test in the file errors).

- [ ] **Step 3: Write `plugin/skills/dispatch/close-out-update.md`** — a `# Dispatch — Close-out Update` file in the house shape of `close-out-confirmation.md` (opening paragraph: referenced by `close-out.md` step 2, read only when a candidate is `DIRTY`/`CONFLICTING` or `BEHIND`; why it exists: item 11's flag-only rationale is "nobody present", and close-out is human-present by construction — step 4's gate has no carve-out). Numbered procedure, one plain command per Bash call, values from `gh pr view {number} --json headRefName,headRefOid,baseRefName` (`{head}`, `{base}`):
  1. **Offer** — `AskUserQuestion`, header `"Update PR"`. `DIRTY`: options `"Update from {base} (Recommended)"` / `"Stop"`; `BEHIND`: `"Update from {base} (Recommended)"` / `"Skip update"`. The question states what an update does (merges `origin/{base}` in — never a rebase or force-push — runs the full suite, pushes, re-reads CI before the merge question). Declining touches nothing: the PR stays exactly as it was; `DIRTY` then stops the candidate (`stopped: mergeStateStatus DIRTY — update declined`), `BEHIND` continues to `close-out.md` step 3 unchanged (BEHIND was never a stop).
  2. **Worktree** — `git fetch origin {head}`, then `git worktree add --detach .worktrees/close-out-{number} origin/{head}` (git-fallback domain, `_shared/scratch-worktree.md` §2; never the main checkout, never the run's own worktree, which may still hold `{head}` checked out by a live session). `BEHIND` runs `gh pr update-branch {number}` (merge — never `--rebase`) *before* this step, so the worktree is created at the already-updated head. When the project has a lockfile, run its install command in the worktree first (the lockfile→command mapping in `_shared/worktree-adopt-freshness.md` step 4).
  3. **Merge (`DIRTY` only)** — `git -C .worktrees/close-out-{number} fetch origin {base}`, `git -C … merge --no-edit origin/{base}`; record `{conflicted-files}` with `git -C … diff --name-only --diff-filter=U` before resolving. Resolve per `_shared/git-discipline.md`'s Merge conflict resolution — read both sides and keep both intents; the human is present, so a resolution the agent is not confident in goes to them (that section's ask-the-user fallback applies here, unlike the `auto` catch-up). `git -C … add {paths}`, `git -C … commit --no-edit`. If the conflict cannot be resolved: `git -C … merge --abort`, stop the candidate (`stopped: update failed — conflict not resolved`), nothing pushed.
  4. **Verify** — from inside the worktree (cwd there; `verify.js` verifies only the checkout it runs from — `test/verification.md`'s cwd note), run `verify.js` with the project's full command set per `/claude-tweaks:test`'s `verification.md`, then `verify.js --stamp-status`: continue only when `verifiedHead` is true, `scope` is `full`, and its `sha` equals `git -C … rev-parse HEAD`. Otherwise stop (`stopped: update failed — verification`), push nothing (`DIRTY`), and report the worktree path so the human can fix and re-run close-out. On `BEHIND` the update is already on GitHub — the PR stays unmerged and the report says so.
  5. **Push (`DIRTY` only)** — `git -C … push origin HEAD:{head}` (plain; a rejection is reported and stops the candidate, never retried with force).
  6. **Re-read CI on the new HEAD** — confirm `gh pr view {number} --json headRefOid` equals the verified sha, wait with `gh pr checks {number} --watch` (the one place close-out waits — it created the pending state itself), then re-run `close-out.md` step 1's read; only `passing` continues (`stopped: CI {status} after update` otherwise). Then re-run step 2's mergeability read once — a still-`DIRTY` PR stops.
  7. **Tear down** — `git fetch origin {head}`, `git -C … merge-base --is-ancestor HEAD origin/{head}`, then `git worktree remove .worktrees/close-out-{number}` (`ExitWorktree` does not operate on `.worktrees/`, `_shared/scratch-worktree.md` §6). Left in place only on the step-4 failure above.
  8. **Hand off** — pass `{update-method}`, `{conflicted-files}`, `{resolution-commit}` (the Interfaces block) to `close-out-confirmation.md`, and continue at `close-out.md` step 3.

- [ ] **Step 4: Edit `plugin/skills/dispatch/close-out.md`**
  - Intro: "flags a PR that quietly went from clean to conflicting" → also says close-out offers to update it (keep the item-11 sentence).
  - Step 2: keep the `resolvePrStateByNumber(repoRoot, number)` sentence, the four string results, and "Any string result (or `null`) stops this candidate — report it, and never read it as "not DIRTY"" verbatim (existing pins). Replace the `DIRTY` paragraph: `mergeStateStatus: DIRTY` or `mergeable: CONFLICTING` → item 11's finding surfacing again; read `close-out-update.md` and follow it (offer, then a re-verified update). `mergeStateStatus: BEHIND` → read `close-out-update.md` too (offer `gh pr update-branch`); declining continues. `BLOCKED` sentence unchanged. Remove "Rebasing changes PR content without the author present … flag-only holds at close-out time too".
  - Reporting: replace `stopped: mergeStateStatus DIRTY — rebase and re-verify first` with `stopped: mergeStateStatus DIRTY — update declined`, and add `stopped: update failed — {conflict not resolved | verification | push rejected}` and `stopped: CI {status} after update`.
  - Anti-Patterns: replace the `Rebasing a \`DIRTY\` candidate to clear it automatically` row with `| Rebasing or force-pushing a candidate, or updating one without a passing full suite | …` — the branch is public behind its PR, so `close-out-update.md` merges `{base}` in and re-verifies; the no-update ban belongs to `_shared/github-pr-scan.md` item 11's headless sweep, where nobody is present to review a resolution, and to any update without a passing full-suite `verify.js` stamp on the new HEAD |. Add `| Merging an updated PR on its pre-update CI read | The update made a new HEAD — only a stamp and a CI read on that HEAD count |`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: PASS (all tests, including the four pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/close-out-update.md plugin/skills/dispatch/close-out.md tests/close-out-pr-state-contract-conformance.test.js
git commit -m "Offer a re-verified update path in dispatch close-out — refs #4273"
```

### Task 2: The confirmation question names the update

**Files:**
- Modify: `plugin/skills/dispatch/close-out-confirmation.md` (question line 14, "Source values live" paragraph lines 38-45)
- Test: `tests/close-out-pr-state-contract-conformance.test.js`

**Interfaces:**
- Consumes: `{update-method}`, `{conflicted-files}`, `{resolution-commit}` from Task 1's close-out-update.md step 8.

- [ ] **Step 1: Write the failing test** — append to `tests/close-out-pr-state-contract-conformance.test.js`; add `const CONFIRM = readText(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'close-out-confirmation.md'));`):

```js
test('AC3.1: the confirmation question names that an update ran, the conflicted files, and the resolution commit', () => {
  const question = CONFIRM.split('\n').find((l) => l.includes('`question`:'));
  assert.ok(question, 'question line found');
  assert.ok(question.includes('{update-clause}'), 'question carries {update-clause}');
  const def = CONFIRM.slice(CONFIRM.indexOf('{update-clause}', CONFIRM.indexOf(question) + question.length));
  for (const v of ['{update-method}', '{conflicted-files}', '{resolution-commit}']) {
    assert.ok(def.includes(v), `{update-clause} definition names ${v}`);
  }
  assert.match(def, /close-out-update\.md/, 'values come from close-out-update.md, never re-derived');
  assert.match(def, /empty|omitted/i, 'no update → the clause is empty');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: FAIL with "question carries {update-clause}"

- [ ] **Step 3: Edit `close-out-confirmation.md`** — insert `{update-clause}` into the question template right after `approved by: {approver-or-unknown}.`; define it after the option list: when close-out-update.md ran for this candidate, `" Updated from {base} this session via {update-method}: conflicted files {conflicted-files}, resolution commit {resolution-commit} — review it before merging."`; empty (omitted) when no update ran. Extend the "Source values live" paragraph: the update values come from close-out-update.md's own hand-off, never re-derived here.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/close-out-confirmation.md tests/close-out-pr-state-contract-conformance.test.js
git commit -m "Name the close-out update in the merge confirmation question — refs #4273"
```

### Task 3: Item 11 stays flag-only and points at the update path; doc mirrors

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md` (lines 358, 364, 383, 479 — near-byte-neutral, 2,380 B headroom)
- Modify: `plugin/skills/dispatch/SKILL.md` (line 55 `close-out` row: "detect staleness" → "detect staleness and offer a re-verified update")
- Modify: `docs/plugin-structure.md` (line 116 dispatch row: add `close-out-update.md` to the file list; replace "flag (never auto-fix) a PR gone from clean to conflicting per `_shared/github-pr-scan.md` item 11's own `[pr-stale]` finding" with an offer-to-update description naming close-out-update.md, merge never rebase, full-suite `verify.js` + fresh CI read on the new HEAD; add one sentence describing close-out-update.md)
- Modify: `docs/skill-graph.md` (dispatch section table: one new row `_shared/git-discipline.md` — `close-out-update.md` (#4273) merges the integration branch into a conflicting or behind `pending-review` PR, resolving conflicts per its Merge conflict resolution with the human present; never a rebase or force push, per its Rules)
- Modify: `docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md` (line 36: "red CI or `DIRTY` still stops the candidate first" → red CI stops it first, and a `DIRTY` PR is first offered close-out's re-verified update)
- Test: `tests/close-out-pr-state-contract-conformance.test.js`

**Interfaces:**
- Consumes: file name `close-out-update.md` (Task 1).

- [ ] **Step 1: Write the failing test** — append to `tests/close-out-pr-state-contract-conformance.test.js`; add `const SCAN = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'github-pr-scan.md'));`):

```js
test('AC5.1: github-pr-scan item 11 stays flag-only and points at close-out\'s update path', () => {
  const start = SCAN.indexOf('11. **Stale pending-review PR**');
  const end = SCAN.indexOf('Findings and recommendations', start);
  assert.ok(start >= 0 && end > start, 'item 11 locatable');
  const item11 = SCAN.slice(start, end);
  assert.ok(item11.includes('**Flag-only, never auto-rebase.**'), 'still flag-only');
  assert.ok(item11.includes('close-out-update.md'), 'names close-out\'s update path');
  assert.ok(!item11.includes('gh pr update-branch'), 'the sweep itself never updates');
  assert.ok(!SCAN.includes('rebase and re-verify'), 'the [pr-stale] recommendation no longer says rebase');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: FAIL with "names close-out's update path"

- [ ] **Step 3: Edit `_shared/github-pr-scan.md`** — lines 358 and 479: `rebase and re-verify (…)` → `update from the integration branch and re-verify (…)` (keep the parenthesised check list). Line 364: keep the bold `**Flag-only, never auto-rebase.**` lead and its rationale; reword the closing sentence so the human-present close-out may offer a re-verified update (`dispatch/close-out-update.md`), which this sweep never performs. Line 383: `Rebase and re-verify` → `Update from the integration branch and re-verify`; "a human or #2364's close-out process acts on it" → name close-out's offered update. Keep the net byte delta under +300 B.

- [ ] **Step 4: Edit the mirrors** — `dispatch/SKILL.md` line 55, `docs/plugin-structure.md` line 116, `docs/skill-graph.md` dispatch table, the 3783 journey line 36, exactly as the Files block says.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan.md plugin/skills/dispatch/SKILL.md docs/plugin-structure.md docs/skill-graph.md docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md tests/close-out-pr-state-contract-conformance.test.js
git commit -m "Point item 11 at close-out's update path and sync dispatch docs — refs #4273"
```

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 `assertUpdateRouting` (DIRTY/CONFLICTING/BEHIND → close-out-update.md) |
| AC1.2 | Task 1 `assertUpdateRouting` (declining → exactly as it was) + Review Focus test |
| AC2.1 | Task 1 `assertUpdateRouting` (verify.js, --stamp-status, verifiedHead + scope full, headRefOid, gh pr checks --watch, step 1 re-run) |
| AC3.1 | Task 2 test |
| AC4.1 | Task 1 `assertUpdateRouting` (no rebase / force-push command spans, update-branch without --rebase) |
| AC5.1 | Task 3 test (item 11 flag-only) + Task 1 (anti-pattern row rescoped; tests pin the new branch) |

## As-built deviations (Common Step 4.5, all Beneficial)

1. The update procedure is a lazy-loaded sub-file, `plugin/skills/dispatch/close-out-update.md`, not inline prose in `close-out.md` step 2. Step 2 routes to it, the same split `close-out-confirmation.md` uses, so a clean candidate never loads it.
2. To make AC2 hold at merge time, `_shared/pr-first-merge.md` Step 3 gained one additive sentence: a caller-supplied expected head appends `--match-head-commit` to every `gh pr merge`. Only close-out passes it, and only after an update; every other caller is unchanged.
3. The spec says nothing about recovery, so the update worktree `{main-checkout}/.worktrees/close-out-{number}` doubles as the resume marker. A later run resumes verification from it, and any `BEHIND` stop before verification keeps it. `UNKNOWN` mergeability gets a bounded re-read.
4. Item 11's `[pr-stale]` recommendation now says "update from the integration branch and re-verify", not "rebase and re-verify". This matches the no-rebase rule, and item 11 stays flag-only.
