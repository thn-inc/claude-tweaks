# Replay Task and Whole-Branch Reviewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `extract-reviews` gains `--role task`, `--role whole-branch` and `--role task-vs-branch`, and `score-reviews` gains `task`, `wholeBranch` and `taskVsBranch` sections, so the replay measures how much of what task reviews catch the whole-branch review would catch on its own.

**Architecture:** The lens role keeps its code path unchanged. The three new roles ("branch roles") share one selection module, `tools/review-replay/reviews-branch.js`, that reads each run's `task review` and whole-branch dispatches, resolves pointer prompts, reads the sha pair, and builds slots. `reviews-extract.js` routes on the role and writes the same artifacts (repositories, prompts, manifest, fixture, archived reports). `reviews-score.js` shares its cost and effort prelude and adds one scorer per branch role. Per-item parsing of `Critical`/`Important`/`Minor` replies lives in `reviews-score.js` on top of `guards.js`'s own regexes, so it cannot drift from `parseReviewCounts`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI (fixtures and `git ls-tree`).

**Spec:** `.claude-tweaks/pipelines/2026-11-23T065810-spec-5992/work/5992-spec.md` (record #5992)

Scope keywords: isWholeBranch, LOCATION_RE, REVIEW_EXCLUSION_REASONS, extractReviews, scoreReviews

## Global Constraints

- Maintainer tooling only: nothing under `plugin/` changes; every change is under `tools/`, `tests/`, `docs/`.
- `isWholeBranch`, `LOCATION_RE` (and the three `guards.js` regexes `SEVERITY_RE`, `HEADING_RE`, `ITEM_RE`) are exported in place, with no copy and no behaviour change in the cost report. `tests/pipeline-cost-report/` must still pass unchanged.
- Matching is by location only: `near` is `counterfactual.js`'s rule (same repository-relative path, lines within `NEAR_LINES`, 5); a path mismatch is not near. No model judge.
- Archived items with no location are counted as `unlocated`, outside every share. A share's denominator is located items; the unit of a slot is one task review.
- The `[Effort: …]` line is removed by `stripEffortLines` (the lens role's canonical match). The whole-branch prompt's "What Was Implemented" text is never edited.
- No task reviewer prompt or reply text reaches a `task-vs-branch` prompt (AC2).
- Exclusion reasons added: `prompt-file-gone`, `no-whole-branch-prompt`, `no-merge-base`, `items-unparsed`. Every exclusion row goes through `extractReviews`' `exclude`, which throws on an unlisted reason.
- Lens role behaviour, output and tests stay byte-identical; `--lens`/`--max-per-lens` with a branch role exits 2 (`--lens applies to --role lens only`).
- Governing skill `regex-scan-linearity` (scoped to `plugin/bin/`, so it does not bind `tools/`; its probe rule is followed for the two new regexes anyway): "Feed the function a long run of characters its pattern accepts, without the terminator that ends a match, and time it." and fix shape 3 "A `\s` that crosses newlines under `/m`… Fix: `[ \t]`". The new regexes use `[ \t]` and find the head with a second regex started at the base match's end, never a lazy `[\s\S]*?` between the two.
- Governing skill `git-ground-truth-test-env`: fixture git runs with `cleanEnv()` (no inherited `GIT_*`), as `reviews-fixture.js` already does; `makeWriteRepo` is reused unchanged.
- Waived `tests/fixtures/review-replay/reviews/`: archived prompts carry absolute machine paths, so the branch fixture is built at test time by `buildBranchFixture` in `tests/review-replay/reviews-fixture.js`, as the lens fixture is (that file's header states why).
- Commit subjects: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_019fFofVKiWyBx1uCZztAiu1`.

### Decisions this plan takes beyond the spec text (logged as premise lines)

Decisions 1, 3 and 4 were put to the user at plan review and decided as written below; the spec's `## Plan Review Clarifications` section records them.

1. **Range base for a `task-vs-branch` slot.** The spec says base = the whole-branch prompt's base. On real runs that base can be origin/main merged in by the pre-review catch-up, which the task-reviewed head predates (run `2026-11-19T154019-spec-5957`: whole-branch base `d5346c1c99` is neither ancestor nor descendant of task head `b90d38882a`; the whole-branch head `6a7e879f6f` merges both). Diffing that base against the task head would show main's newer commits as reverted. Rule: base = the whole-branch base when it is an ancestor of the task-reviewed head, else `git merge-base {wbBase} {taskHead}`; no merge base → exclusion `no-merge-base`. The slot records `baseFrom: 'whole-branch' | 'merge-base'`. The prompt still names the whole-branch shas, mapped to the replay shas.
2. **Severity grammar.** The per-item parser keeps `parseReviewCounts`' heading grammar (`#… Critical|Important|Minor`). Probe over this repository's archive (2026-11-23): of 270 `Needs fixes` task replies with a verdict, 257 use headings and 13 use bold labels (`**Important**`); of 273 whole-branch replies with a transcript, 251 use headings, 9 bold labels, 11 neither. A bold-label `Needs fixes` task reply has no parsed items (`parseReviewItems` null): `--role task` keeps its slot (the verdict still scores) and marks it `itemsUnparsed: true`, which the `task` section counts outside every denominator; `--role task-vs-branch` excludes it as `items-unparsed`. A bold-label replayed whole-branch reply is `could-not-parse`. The journey says so.
3. **AC1 vs AC7.** AC1's "exactly one slot" is the one slot at the task-reviewed head (`at: 'task-head'`); AC7's control adds the `at: 'final-head'` sibling, so the role writes two slots per qualifying review.
4. **Final head of the control** = the whole-branch prompt's own head (the prompt replayed exactly as archived).
5. **"A task-review prompt range ends after the fix"** (Gotchas): the fixture holds a `re-review` dispatch whose range ends at the fix commit; the test asserts it yields no slot and the `task-vs-branch` slot's head is the pre-fix commit.
6. **Archived item text** is stored in `archived-reports.json` for branch roles (the `taskVsBranch` not-raised list needs it). It never reaches a prompt or a repository.

## Review Focus

1. A whole-branch prompt whose text says `base` before the real `Base {sha}` line (e.g. "the review base after a clean catch-up merge") — `shaPairOf` must skip a `base` not followed by a sha and still pair `Base d5346c1c99… Head 6a7e879f6f`. Test in Task 1.
2. A pointer prompt whose path contains a space (`/Users/x/Code Workspaces/…`) and sits on the line after the `(it is your prompt…):` marker — the whole path must be read. Test in Task 1.
3. An archived item line citing an absolute worktree path (`/…/.claude/worktrees/flow-spec-7/src/x.js:10`) — stored repo-relative (`src/x.js`), or it can never be `near` a replay item. Test in Task 2.
4. An item citing two locations (`src/a.js:3 and src/b.js:9`) — caught when either is near a replay item. Test in Task 4.
5. A run whose first whole-branch dispatch is unusable but a later one (a fix-wave re-review mislabelled as final) is usable — every task review of that run is `no-whole-branch-prompt`; the later dispatch never supplies the prompt. Test in Task 3.

---

### Task 1: Exports, per-item parser, sha pair and pointer readers

**Role:** integration

**Files:**
- Modify: `tools/pipeline-cost-report/reviews.js` (export `LOCATION_RE`)
- Modify: `tools/pipeline-cost-report/guards.js` (export `isWholeBranch`, `SEVERITY_RE`, `HEADING_RE`, `ITEM_RE`)
- Modify: `tools/review-replay/reviews-score.js` (add `parseReviewItems`, `parseBranchReply`)
- Modify: `tools/review-replay/reviews-rewrite.js` (add `shaPairOf`, `pointerPathOf`)
- Test: `tests/review-replay/reviews-score.test.js`, `tests/review-replay/reviews-rewrite.test.js`

**Interfaces:**
- Produces: `parseReviewItems(text: string) -> { items: Item[] } | null` where `Item = { sev: 'critical'|'important'|'minor', text: string, path: string|null, line: number|null, locations: {path: string, line: number}[] }`; `null` exactly when `parseReviewCounts(text)` is `null`. `path`/`line` are `locations[0]` or `null`.
- Produces: `parseBranchReply(text: string) -> { items: Item[] } | null` — `parseReviewItems` when non-null, else `{ items: [] }` when a line matches `/no issues/i`, else `null`.
- Produces: `shaPairOf(text: string) -> { base: string, head: string } | null`.
- Produces: `pointerPathOf(text: string) -> string | null`.

- [ ] **Step 1: Write the failing tests**

In `reviews-score.test.js`:

```js
test('parseReviewItems: one item per counted line, located by its first path:line', () => {
  const text = ['### Issues', '#### Important (Should Fix)', '- src/x.js:10: null deref when y is unset', '- `/abs/src/a.js:3` and src/b.js:9 drift', '#### Minor', '1. naming could be clearer', '2. None.', '### Strengths', '- src/z.js:1 is tidy'].join('\n');
  const { items } = parseReviewItems(text);
  assert.deepEqual(items.map((i) => [i.sev, i.path, i.line]), [['important', 'src/x.js', 10], ['important', '/abs/src/a.js', 3], ['minor', null, null]]);
  assert.deepEqual(items[1].locations, [{ path: '/abs/src/a.js', line: 3 }, { path: 'src/b.js', line: 9 }]);
  assert.equal(items[0].text, 'src/x.js:10: null deref when y is unset');
  const c = parseReviewCounts(text);
  assert.deepEqual({ critical: 0, important: 2, minor: 1 }, c);
});
test('parseReviewItems agrees with parseReviewCounts', () => { /* for each of 4 texts (above, headings with no items, bold-label only, empty): null-ness equal, and per-severity item counts equal parseReviewCounts */ });
test('parseBranchReply: headings, "No issues", neither', () => {
  assert.deepEqual(parseBranchReply('#### Critical (Must Fix)\nNone.\n').items, []);
  assert.deepEqual(parseBranchReply('Reviewed it all. No issues found.').items, []);
  assert.equal(parseBranchReply('**Important**\n- src/x.js:1 bad'), null);
});
```

In `reviews-rewrite.test.js`:

```js
test('shaPairOf: Base/Head lines, a sha-less "base" first, and the two-dot fallback', () => {
  assert.deepEqual(shaPairOf('## Diff Under Review\nBase 44200e4559, Head b90d38882a. Diff file: x'), { base: '44200e4559', head: 'b90d38882a' });
  assert.deepEqual(shaPairOf('the review base after a catch-up.\nBase d5346c1c99056b72f56bd2172d720bd6a609fa5b (the merge commit). Head 6a7e879f6f.'), { base: 'd5346c1c99056b72f56bd2172d720bd6a609fa5b', head: '6a7e879f6f' });
  assert.deepEqual(shaPairOf('Fix diff (b90d38882a..c7e979dbd4), read once'), { base: 'b90d38882a', head: 'c7e979dbd4' });
  assert.equal(shaPairOf('SCOPE: origin/main...HEAD'), null);
  assert.equal(shaPairOf('Base 44200e4559 only'), null);
});
test('pointerPathOf: path on the next line, with spaces', () => {
  const p = 'Read your full review instructions from this file and follow them exactly (it is your prompt; nothing else is):\n/Users/x/Code Workspaces/r/.superpowers/sdd/t/task-3-review-prompt.md\n\n[Effort: high — x.]';
  assert.equal(pointerPathOf(p), '/Users/x/Code Workspaces/r/.superpowers/sdd/t/task-3-review-prompt.md');
  assert.equal(pointerPathOf('(it is your prompt): /tmp/p.txt  '), '/tmp/p.txt');
  assert.equal(pointerPathOf('You are reviewing one task.'), null);
});
test('shaPairOf and pointerPathOf stay linear on long runs', () => { /* 'base '.repeat(50000), ' '.repeat(200000), 'a'.repeat(200000) after the marker: each call < 500 ms */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-replay/reviews-score.test.js tests/review-replay/reviews-rewrite.test.js`
Expected: FAIL after Step 1 — `parseReviewItems is not a function` / `shaPairOf is not a function`.

- [ ] **Step 3: Implement**

- `guards.js`, `reviews.js`: add the names to `module.exports` only.
- `parseReviewItems`: walk lines exactly as `parseReviewCounts` does (same three regexes, same `none`/`n/a` skip, same heading reset); for each counted item, `locations` = every `LOCATION_RE` match in the bare item text (`new RegExp(LOCATION_RE.source, 'g')`).
- `shaPairOf`: `/\bbase[ \t]+([0-9a-f]{7,40})\b/i` for the first base followed by a sha; then a global `/\bhead[ \t]+([0-9a-f]{7,40})\b/ig` with `lastIndex` at that match's end. No base+head pair → `/(?<![0-9A-Za-z])([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})(?![0-9A-Za-z])/`. Otherwise `null`.
- `pointerPathOf`: `/\(it is your prompt\b[^)\n]*\):[ \t]*(?:\r?\n[ \t]*)?(\S[^\r\n]*)/`, trailing whitespace trimmed in code.

- [ ] **Step 4: Run to verify they pass, and the cost report is unchanged**

Run: `node --test tests/review-replay/reviews-score.test.js tests/review-replay/reviews-rewrite.test.js tests/pipeline-cost-report/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

`git add` the six files; `git commit -m "Add per-item review parser and sha-pair reader — replay prep for task reviewers (#5992)"`.

---

### Task 2: Branch fixture, `--role task` and `--role whole-branch` extraction

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tools/review-replay/reviews-branch.js`
- Modify: `tools/review-replay/reviews-extract.js` (role rows, routing, `writeOutputs` generalised)
- Modify: `tools/review-replay/schema.js` (four reasons)
- Modify: `tools/review-replay.js` (`USAGE` roles, header comment for extract-reviews)
- Modify: `tests/review-replay/reviews-fixture.js` (add `buildBranchFixture`)
- Test: `tests/review-replay/reviews-extract.test.js`
- Test: `tests/review-replay/reviews-schema.test.js`

**Interfaces:**
- Consumes: Task 1's `parseReviewItems`, `parseBranchReply`, `shaPairOf`, `pointerPathOf`; `parseTaskVerdict`, `LOCATION_RE`, `isWholeBranch`.
- Produces: `ROLES` in `reviews-extract.js` with keys `lens`, `task`, `whole-branch`, `task-vs-branch`; each branch row is `{ kind: 'branch', key }`, the lens row gains `kind: 'lens'`.
- Produces: `reviews-branch.js` exports `selectBranchSlots(r: {run, dir}, dispatches: {item, member}[], c, deps, exclude) -> Slot[]` and `promptFor(item, c, fs) -> { prompt, transcript, file } | { reason }`.
- Produces: a branch `Slot` = `{ role, name, run, agentId, prompt, inputs, archivedBase, archivedHead, promptBase, promptHead, archivedTier, archivedEffort, originRefs, lens: null, side: null, verdict, items, taskTier, at, baseFrom, taskAgentId }` (the last four `null` outside `task-vs-branch`). `archivedBase/Head` are the repository's two trees; `promptBase/Head` are the full shas the prompt names, mapped to the replay shas.
- Produces: `buildBranchFixture(root, { pointer: null|'present'|'gone', catchUp: false, noWholeBranch: false, wbUnusableFirst: false, boldLabel: false }) -> { mainRoot, runsRoot, transcripts, runName, worktree, B, T1, T2, F, M, W }`.
- Produces in `reviews-fixture.json`: `role`; slots carry `role, verdict, taskTier, at, baseFrom, taskAgentId, archivedTier, archivedEffort, controlArm, repoKey`; exclusion rows carry `tier` when known. Totals for branch roles: `{ reviews, byArchivedTier }`.
- Produces in `archived-reports.json`: `reports[name] = { role, run, verdict, items, itemsUnparsed, unlocated, taskTier, at }` (`itemsUnparsed: true` for a `Needs fixes` task reply whose `parseReviewItems` is null, Decision 2) for branch roles (no `confirmed`, no `runRows`).

- [ ] **Step 1: Write `buildBranchFixture` and the failing tests**

Fixture — history under `{root}/main checkout/repo` with `cleanEnv()`: `B` (src/x.js 20 lines, src/y.js), `T1` (edit src/y.js), `T2` (src/x.js line 10 becomes null-unsafe), `F` (fixes line 10). With `catchUp`: a side commit `M` off `B` (adds src/z.js), and `W` = merge of `M` into the branch at `F`. Run `2026-11-03T000000-spec-7` with `work/7-spec.md` and `timing.json` items, transcripts under `{root}/projects/slug/sess/subagents/`:
- `t1` `task review` tier `standard`, prompt task-style ("…a broad whole-branch review happens separately… Task brief: {worktree}/.superpowers/sdd/x/task-1-brief.md … Base {B}, Head {T1}. …" plus an `[Effort: medium — …]` line), reply ending `Task quality: Approved`.
- `t2` `task review` tier `capable`, prompt `Base {T1}, Head {T2}`, reply `### Issues\n#### Important\n- {worktree}/src/x.js:10: null deref when y is unset\n#### Minor\n- naming could be clearer\n\nTask quality: Needs fixes`.
- `rr2` `re-review`, prompt `Fix diff ({T2}..{F})`, reply `ADDRESSED src/x.js:10`.
- `wb` `whole-branch review` tier `capable`, prompt opening "You are a Senior Code Reviewer…", `[Effort: high — apply high-level reasoning depth to this task.]`, "## What Was Implemented…", `Spec: {worktree}/.claude-tweaks/pipelines/{run}/work/7-spec.md`, "Base {B} (the review base). Head {F}." (`catchUp`: Base `M`, Head `W`), reply `#### Critical (Must Fix)\nNone.\n#### Important (Should Fix)\nNone.\n#### Minor (Nice to Have)\n1. src/y.js:2 could be const`.
- `pointer`: item `tp` `task review` whose prompt is the pointer text naming `{worktree}/.superpowers/sdd/x/task-2-review-prompt.md`; `'present'` writes that file with `t2`'s prompt text, `'gone'` does not.
- `noWholeBranch`: `wb` has no transcript. `wbUnusableFirst`: an extra first whole-branch item `wb0` with no transcript, before `wb`.

Tests in `reviews-extract.test.js`, a new `describe('branch roles')`:

```js
test('--role task: one slot per task review, verdict and located items archived', async () => {
  // extract --role task --arm name=a,profile=fast on buildBranchFixture
  assert.equal(code, 0);
  assert.deepEqual(fixture.slots.map((s) => [s.name.split('/').pop(), s.verdict, s.archivedTier]), [['task', 'approved', 'standard'], ['task.2', 'needs-fixes', 'capable']]);
  const r = reports.reports[`${RUN}/task.2`];
  assert.deepEqual(r.items.map((i) => [i.sev, i.path, i.line]), [['important', 'src/x.js', 10], ['minor', null, null]]);
  assert.equal(r.unlocated, 1);
  // the task.2 repository is (T1, T2); its prompt names neither archived sha, no Effort line, and no {mainRoot} path
});
test('--role task: re-review dispatches are never slots', …); // no slot or exclusion row carries agentId 'rr2'
test('AC6.1: a pointer prompt whose file is gone is excluded as prompt-file-gone and writes no prompt', async () => {
  // pointer: 'gone' → excluded has { agentId: 'tp', reason: 'prompt-file-gone', tier: 'standard' }; no file under prompts/ contains 'tp' or names task-2-review-prompt
});
test('--role task: a pointer prompt whose file exists replays that file', …); // pointer: 'present' → slot for tp whose prompt is t2's text, rewritten
test('--role whole-branch: one slot, items archived, prompt rewritten', …); // slot 'whole-branch', items [['minor','src/y.js',2]], repo (B, F), prompt has the replay shas and keeps "What Was Implemented"
test('--lens with a branch role exits 2', …); // err includes '--lens applies to --role lens only'
```

In `reviews-schema.test.js`: the four new reasons are listed. Add a `--role task` test on `buildBranchFixture(root, { boldLabel: true })`: a `Needs fixes` reply with bold-label severities only (extra item `t3`, present only under `boldLabel`, tier `standard`, prompt `Base {T1}, Head {T2}`, reply `**Important**\n- src/x.js:4 off by one\n\nTask quality: Needs fixes`) keeps its slot with `itemsUnparsed: true` and `items: []`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-replay/reviews-extract.test.js tests/review-replay/reviews-schema.test.js`
Expected: FAIL after Step 1 — `--role must be one of lens: "task"`.

- [ ] **Step 3: Implement**

- `parseReviewsOptions`: accept the four roles; reject `--lens`/`--max-per-lens` for `kind: 'branch'`.
- `extractReviews`: a branch role skips `readRun` (`r = { run: basename(dir), dir }`; decisions.md is a lens input), takes `dispatchesOf` as today (its problems still exclude), then `selectBranchSlots`.
- `selectBranchSlots` for `task`: items with `role === 'task review'`; for `whole-branch`: `isWholeBranch(item)`. Per dispatch, checks in this order, each failing one an exclusion row `{ run, agentId, tier?, reason }`: tier in `PROFILES` (`no-archived-tier`); transcript prompt (`no-transcript`); pointer resolution — when `pointerPathOf(prompt)` names a path, the prompt becomes that file's text, any read failure is `prompt-file-gone`; reply parses — `parseTaskVerdict` for task, `parseBranchReply` for whole-branch (`report-unparsed`); `shaPairOf(prompt)` (`no-sha-range`); both shas `rev-parse --verify {sha}^{commit}` (`commit-not-in-clone`); `runInputsOf` unknowns (`unknown-run-input`) and input reads (`run-input-gone`); the rendered-text barrier (`unrewritten-path`), reusing `renderSlot` and `unrewrittenPaths` as the lens loop does. Items: `parseReviewItems(reply)` (or `parseBranchReply` for whole-branch) with every worktree path of the prompt and `mainRoot` stripped from each location path first, as `archivedRows` does (`scanView` then `stripTree`). Names per run: `task`, `task.2`, …; `whole-branch`, `whole-branch.2`, ….
- `writeOutputs`: shaMap = `{ [s.promptBase]: replayBase, [s.promptHead]: replayHead }` (lens: `promptBase/Head` = `archivedBase/Head`); reports and fixture fields per role; `confirmed`/`runRows` only for lens; totals per role. Control arms group by the dispatch's own archived (tier, effort), as today.
- `tools/review-replay.js`: `USAGE` line `--role lens|task|whole-branch|task-vs-branch`; `[--lens <id,...>] [--max-per-lens <n>]` marked lens only; the header's extract-reviews paragraph names the three roles in one sentence each.

- [ ] **Step 4: Run to verify they pass, lens tests unchanged**

Run: `node --test tests/review-replay/`
Expected: PASS, 0 fail (every pre-existing lens test included).

- [ ] **Step 5: Real-input probe (record the output in the task report)**

Run from the worktree:
`node tools/review-replay.js extract-reviews --role task --runs "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines" --transcripts ~/.claude/projects --select 2026-11-17T060227-record-5580 --arm name=a,profile=fast --out {scratchpad}/probe-task`
and the same with `--role whole-branch`. Independent count: `node -e` over that run's `archive/…/timing.json` counting `role === 'task review'` and whole-branch items (`isWholeBranch`). Reconcile: `totals.reviews + excluded rows for that role` equals the independent count; quote both JSON outputs.

- [ ] **Step 6: Commit**

`git commit -m "Add task and whole-branch roles to extract-reviews — replay archived task reviewers (#5992)"`.

---

### Task 3: `--role task-vs-branch` extraction with its final-head control

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tools/review-replay/reviews-branch.js`
- Test: `tests/review-replay/reviews-extract.test.js`

**Interfaces:**
- Consumes: Task 2's `selectBranchSlots`, `promptFor`, slot shape, fixture options.
- Produces: per qualifying task review two slots, `task-vs-branch[.k]` (`at: 'task-head'`) and `task-vs-branch[.k]--final` (`at: 'final-head'`), sharing `items` (the task review's `critical` and `important` items only), `taskTier`, `taskAgentId`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC1.1 AC1.2 AC1.3: one task-head slot, its repository head tree is T2, not F (git ls-tree -r)', async () => {
  const head = fixture.slots.filter((s) => s.at === 'task-head');
  assert.equal(head.length, 1);
  assert.equal(head[0].taskAgentId, 't2');
  const repo = fixture.repos.find((r) => r.key === head[0].repoKey).path;
  assert.equal(lsTree(repo, 'HEAD'), lsTree(fx.mainRoot, fx.T2));
  assert.notEqual(lsTree(repo, 'HEAD'), lsTree(fx.mainRoot, fx.F));
});
test('AC2.1: the slot prompt is the whole-branch prompt with replay shas, no task prompt or reply text', async () => {
  // prompt contains 'You are a Senior Code Reviewer' and 'What Was Implemented', the replay base and head prefixes,
  // and neither 'a broad whole-branch review happens separately', 'null deref when y is unset', nor 'Task quality'
});
test('AC7.1 (extract half): two slots for the Needs fixes review, task head and final head', async () => {
  // slots for taskAgentId 't2': at ['task-head','final-head']; the final-head repository head tree equals F
});
test('the re-review range ending after the fix is not read as the pre-fix head', …); // no slot from 'rr2'; task-head tree is T2 (Decision 5)
test('catch-up base: whole-branch base not an ancestor of the task head → merge-base', …); // catchUp: task-head slot baseFrom 'merge-base', repo base tree = B; final-head baseFrom 'whole-branch', repo (M, W)
test('no usable whole-branch prompt excludes the task reviews', …); // noWholeBranch and wbUnusableFirst: t2 excluded { reason: 'no-whole-branch-prompt', tier: 'capable' }; exit 3 (no slot)
test('an Approved review and a Minor-only Needs fixes review yield no slot and no exclusion, and count in totals.notQualifying', …);
test('a bold-label Needs fixes review (boldLabel fixture, t3) is excluded as items-unparsed', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-replay/reviews-extract.test.js`
Expected: FAIL after Step 1 — `--role task-vs-branch` selects no slot.

- [ ] **Step 3: Implement in `reviews-branch.js`**

Per run: the whole-branch prompt comes from the first `isWholeBranch` dispatch only; it is usable when it passes Task 2's checks (tier, transcript, pointer, sha pair, both shas in the clone, run inputs, barrier). Per `task review` dispatch: tier, prompt, pointer, verdict `needs-fixes` (`report-unparsed` when `parseTaskVerdict` is null), items parsed (`items-unparsed` when `parseReviewItems` is null), at least one `critical`/`important` item (else not qualifying: no row, counted in `totals.notQualifying`), `shaPairOf(prompt).head` (`no-sha-range` when null), head in clone (`commit-not-in-clone`), whole-branch usable (`no-whole-branch-prompt`). Base: `git merge-base --is-ancestor {wbBase} {taskHead}` exit 0 → `wbBase`, `baseFrom: 'whole-branch'`; exit 1 → `git merge-base {wbBase} {taskHead}` (`no-merge-base` when it fails), `baseFrom: 'merge-base'`; the final-head sibling applies the same rule to `wbHead`. Both slots: `prompt` = the whole-branch prompt, `promptBase/Head` = the whole-branch full shas, `archivedTier/Effort` = the whole-branch dispatch's, `taskTier` = the task review's tier. Repositories are shared per (run, base, head) as today.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/review-replay/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Real-input probe**

Run the Task 2 Step 5 probe command with `--role task-vs-branch` on `2026-11-17T060227-record-5580`. Independent count (scratch probe 2026-11-23): that run has 4 task reviews with `Needs fixes`, at least one Critical/Important heading item and a sha pair, and its first whole-branch prompt pairs `f88beb9ecb..483397098f`. Reconcile against every `task review` dispatch of the run (independent count over its `timing.json`): task-head slots + task-review exclusion rows + `totals.notQualifying` = that count, final-head slots = task-head slots, and task-head slots + rows for reasons after the verdict check (`no-sha-range`, `commit-not-in-clone`, `no-whole-branch-prompt`, `no-merge-base`, `unrewritten-path`) = 4; report each slot's `baseFrom`. Then run once over the whole archive (no `--select`) and record `totals` and `excluded` by reason; the scratch probe found 159 qualifying task reviews with a sha pair in 73 runs whose first whole-branch prompt has one, an upper bound for task-head slots.

- [ ] **Step 6: Commit**

`git commit -m "Add task-vs-branch role with final-head control — counterfactual replay slots (#5992)"`.

---

### Task 4: `score-reviews` `task` and `wholeBranch` sections

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/review-replay/reviews-score.js`
- Test: `tests/review-replay/reviews-score.test.js`

**Interfaces:**
- Consumes: fixture `role`, slot `verdict`/`taskTier`/`at`, reports `items`/`unlocated`; Task 1 parsers; `near`.
- Produces: `scoreReviews` routes on `fixture.role`: `lens` → today's scorer unchanged; branch roles → one scorer each, sharing the manifest/`replaySlots`/cost/effort prelude. Output top level for branch roles: `{ notes, role, fixture: { selected: { total, byArchivedTier }, excludedByReason, excludedByTier }, unidentifiedAgents, unidentifiedCost, arms }`; each arm `{ scored, notJudged, notJudgedByReason, cost, minutes, recordedEffort, effortFieldsDiffer, task | wholeBranch | taskVsBranch }`.
- `task` = `{ reviews, verdict: { agree, disagree, share, byArchivedTier: { [tier]: { agree, disagree, share } } }, recall: { caught, of, share, unlocated, itemsUnparsed }, itemsBySeverity: { critical, important, minor }, itemsPerReview: { critical, important, minor } }` — recall over archived `critical`+`important` items with a location; `unlocated` counts every archived item of any severity with none; `itemsUnparsed` counts reviews whose archived report has `itemsUnparsed: true`, which add nothing to `of`.
- `wholeBranch` = `{ reviews, recall: { caught, of, share, unlocated }, itemsBySeverity, itemsPerReview, withCriticalOrImportant: { n, share } }` — recall over every located archived item.
- An item is caught when any of its `locations` is `near` any location of any replay item. Replay reply parsing: task → `parseTaskVerdict` (null → `could-not-parse`) and `parseReviewItems` for items (null → no items); whole-branch → `parseBranchReply` (null → `could-not-parse`). Exit 3 when any arm has `notJudged > 0`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC5.1: the Approved review replayed as Needs fixes is one verdict disagreement', async () => {
  // --role task extraction; replies: task → 'Task quality: Needs fixes', task.2 → '#### Important\n- src/x.js:12 null\n\nTask quality: Needs fixes'
  assert.deepEqual(pick(out.arms.a.task.verdict, ['agree', 'disagree']), { agree: 1, disagree: 1 });
  assert.deepEqual(out.arms.a.task.verdict.byArchivedTier, { standard: { agree: 0, disagree: 1, share: 0 }, capable: { agree: 1, disagree: 0, share: 1 } });
});
test('AC4.1: the unlocated Minor counts as unlocated 1 and is in no denominator', async () => {
  assert.deepEqual(out.arms.a.task.recall, { caught: 1, of: 1, share: 1, unlocated: 1 });
});
test('task: a reply with no verdict line is notJudged could-not-parse, exit 3', …);
test('wholeBranch: recall of located items, the Critical-or-Important share, "No issues" scores zero items', …);
test('wholeBranch: a bold-label-only reply is could-not-parse', …);
test('an item citing two locations is caught by a replay item near its second', …); // Review Focus 4
test('fixture summary: selected and excluded per reason and per archived tier', …);
test('task: an itemsUnparsed review scores its verdict and counts in recall.itemsUnparsed, not in of', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-replay/reviews-score.test.js`
Expected: FAIL after Step 1 — no `task` key on the arm.

- [ ] **Step 3: Implement** as the Interfaces block states; the lens path's code and output stay byte-identical.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/review-replay/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

`git commit -m "Score task and whole-branch replays — verdict agreement and located recall (#5992)"`.

---

### Task 5: `score-reviews` `taskVsBranch` section, CLI header and journey

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/review-replay/reviews-score.js`
- Modify: `tools/review-replay.js` (header's score-reviews paragraph)
- Modify: `docs/journeys/replay-archived-lens-reviews-across-tiers-5991.md` (new section)
- Test: `tests/review-replay/reviews-score.test.js`

**Interfaces:**
- Consumes: Task 3's `at`, `taskTier`, `items`; Task 4's prelude and caught rule.
- Produces: `taskVsBranch` = `{ reviews: { taskHead, finalHead }, caught: { caught, of, share, unlocated, bySeverity: { critical: {caught, of, share}, important: {…} }, byTaskTier: { [tier]: {caught, of, share} } }, baselineRecall: { caught, of, share, bySeverity }, notRaised: [{ run, taskReview, repeat, path, line, severity, text }] }` — `caught` from `at: 'task-head'` slots, `baselineRecall` from `at: 'final-head'` slots, `notRaised` lists each located item a task-head repeat did not raise (`taskReview` = the task-head slot's run-less name `s.name`, e.g. `task-vs-branch`, beside `run`).

- [ ] **Step 1: Write the failing tests**

```js
test('AC3.1: a replay Important item 2 lines from the task item is caught 1 of 1, nothing not raised', async () => {
  // replies: every slot → '#### Important (Should Fix)\n- src/x.js:12: may be null\n'
  assert.deepEqual(pick(tvb.caught, ['caught', 'of', 'unlocated']), { caught: 1, of: 1, unlocated: 0 });
  assert.deepEqual(tvb.notRaised, []);
});
test('AC3.2: a reply raising nothing near it is 0 of 1 and lists the item', async () => {
  // task-head reply 'No issues found.'
  assert.deepEqual(pick(tvb.caught, ['caught', 'of']), { caught: 0, of: 1 });
  assert.deepEqual(tvb.notRaised, [{ run: RUN, taskReview: 'task-vs-branch', repeat: 1, path: 'src/x.js', line: 10, severity: 'important', text: 'src/x.js:10: null deref when y is unset' }]);
});
test('AC7.1 (score half): caught and baselineRecall are both reported for the review', async () => {
  // task-head reply raises nothing near, final-head reply raises src/x.js:9 → caught 0/1, baselineRecall 1/1
  assert.equal(tvb.caught.bySeverity.important.of, 1);
  assert.deepEqual(pick(tvb.baselineRecall, ['caught', 'of']), { caught: 1, of: 1 });
  assert.deepEqual(tvb.caught.byTaskTier, { capable: { caught: 0, of: 1, share: 0 } });
});
test('taskVsBranch: a reply with no heading and no "no issues" line is could-not-parse, exit 3', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-replay/reviews-score.test.js`
Expected: FAIL after Step 1 — no `taskVsBranch` key.

- [ ] **Step 3: Implement** the section; update the header's score-reviews paragraph (one sentence per section); add the journey section "Task and whole-branch reviewers (#5992)" stating: the three roles and their slots; the pointer-prompt rule and `prompt-file-gone`; the range rule and Decision 1's merge-base fallback; that matching is by location, an item citing several locations is caught when any one is `near` a replay item, and only the item's own line is read; that bold-label severity replies (Decision 2) yield no items; that SDD files a prompt names under `.superpowers/` are absent from the clean repository; that the sample keeps only runs with a task-review range and a usable whole-branch prompt, so shares are not archive-wide figures; and the exclusion reasons.

- [ ] **Step 4: Run to verify they pass, then the full suites the change touches**

Run: `node --test tests/review-replay/ tests/pipeline-cost-report/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

`git commit -m "Score task-vs-branch replays against the final-head control — journey section (#5992)"`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`--role task`/`whole-branch`, pointer, `prompt-file-gone`, range, `commit-not-in-clone`, rewrite, per-item parser) | 1, 2 |
| Deliverable 2 (`task-vs-branch` slots, `no-whole-branch-prompt`, `no-sha-range`, first whole-branch dispatch) | 3 |
| Deliverable 3 (`task`, `wholeBranch`, `taskVsBranch` sections, `unlocated`, `near`) | 4, 5 |
| Deliverable 4 (final-head control, `baselineRecall`) | 3, 5 |
| Deliverable 5 (`notJudged` `could-not-parse`, exit 3) | 4, 5 |
| Deliverable 6 (journey section, `USAGE` roles) | 2, 5 |
| Deliverable 7 (fixtures: two task reviews, one whole-branch, separate fix commit) | 2 |
| AC1.1-AC1.3, AC2.1, AC7.1 (extract) | 3 |
| AC3.1, AC3.2, AC7.1 (score) | 5 |
| AC4.1, AC5.1 | 4 |
| AC6.1 | 2 |
