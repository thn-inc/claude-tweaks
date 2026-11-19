# Pipeline Cost Report Quality Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `guards` section to `tools/pipeline-cost-report.js` that prints the three quality guards (whole-branch review issue share, task first-pass share, post-merge bug records) for the runs before and after a split date.

**Architecture:** A new reader module `tools/pipeline-cost-report/guards.js` beside #5914's `spend.js`/`funnel.js`/`records.js`. It takes the run listing the CLI already builds once (`ctx.runs`, from `runs.js`'s `listRuns`), the transcript roots (`ctx.roots`) and the `gh(args) -> stdout` seam, and returns one object per column. Guard 2 reads `timing.json` alone; guards 1 and 3 parse text and forge data and count what they cannot parse.

**Tech Stack:** Node 18+ built-ins, `node --test`, the `gh` CLI through the injected `deps.gh`.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T055619-spec-5914-5916-5925/spec-5916/work/5916-spec.md`

## Global Constraints

- No change under `plugin/` (Non-Goals). `guards.js` may `require` `plugin/bin/lib/markdown-blocks.js` read-only.
- `--split <YYYY-MM-DD>` is required for the section; `--runs <n>` defaults to 20.
- Shares are fractions from 0 to 1 in `--json`; the markdown prints them as whole percents with the existing `share()` rounding (`Math.round`).
- `--json` shape: `guards: { split, runs, before: { wholeBranch, firstPass, postMergeBugs }, after: { ... } }`; `wholeBranch: { share, meanCritical, meanImportant, n, unparsed }`; `firstPass: { share, byTier, n, unparsed }`; `postMergeBugs: { count, perPr, mergedPrs, unparsed }`. Each column also carries `runCount`, `from`, `to` (the actual run count and first/last run date).
- A run's date is the leading `YYYY-MM-DD` of its directory name (already `run.date` from `listRuns`).
- Every guard prints its unparsed count beside its figure.
- Read-only tool; tests use temp dirs and a fake `gh`, never the real forge.

## Decisions the spec leaves open (made here)

The run-eligibility, task-key, guard-1-input and `--section all` rules below were decided by the user at plan review (the spec's `## Plan Review Clarifications`).

- **Run eligibility** (user decision): only pipeline runs count toward `--runs n`. A run is eligible when its name matches `/(^|-)(spec|record)-/` or its directory holds a `timing.json`. Ineligible runs are dropped before the columns are cut, are in neither column and are not unparsed.
- **Guard 1 input** (user decision): the dispatches with `role === 'whole-branch review'`, plus those with `role === 'unlabelled'` whose description matches `/^final review\b/i` (`Final review for #5865`).
- **Task key** (user decision) = run name + `parentAgentId` (or `''`) + record number + task number. The record number is the first `#(\d+)` in the description. A dispatch whose description names no record inherits the record of the one `implementer` dispatch with that task number under the same parent; with zero or several such implementers it stays `''`. Real multi-spec runs (`2026-11-18T072534-spec-5879-5863-5865-5830`) name the record (`Implement #5830 Task 1`, `Implement #5863 Task 1`, both `parentAgentId: null`), and without it the two would merge. Task number regex: `/\bTask\s+(\d+)\b/i`.
- **Task dispatches** are the roles `implementer`, `task review`, `re-review`. A `re-review` or `task review` with no task number reviews a fix wave (`Re-review the final-review fix wave`), not a task, and is ignored. An `implementer` with no task number counts 1 unparsed.
- **Transcript lookup**: session ids are the basenames (no `.jsonl`) of `timing.json`'s `transcripts[].path`. The report file is `{root}/{any slug}/{session}/subagents/agent-{agentId}.jsonl` for any root in `ctx.roots`. The slug is not taken from `transcripts[].path`, because real runs differ: 5846's main transcript is under the worktree slug and its subagents are under the main-checkout slug.
- **`timing.json`**: a run with no `timing.json` contributes nothing and is not unparsed (release and adhoc runs have none). One that exists but does not parse counts 1 unparsed in guard 1 and 1 in guard 2. Only the run's top-level `timing.json` is read; it already lists every member's dispatches.
- **`--section all` without `--split`**: the guards section is `{ skipped: '--split not given' }` and renders `Guards: not run — --split <YYYY-MM-DD> not given.`. `--section guards` without `--split` is exit 2.
- **Guard 3 forge failure** stays inside guards: that column's `postMergeBugs` is `{ error: firstLine }`, guards 1 and 2 still print, and the CLI exits 1 (the `failed(d)` hook).
- **Guard 3 window**: a bug record qualifies for a PR when `mergedAt < createdAt <= mergedAt + 14 days` and its Key Files share a path with that PR's files. PRs scanned: `merged:{from}..{to}`. Bug records fetched: `created:{from}..{to + 14 days}`. A bug record with no `### Key Files` section counts 1 unparsed, whatever its date.

## Review Focus

1. A run with no `timing.json` (release or adhoc) must not inflate any unparsed count. Test: `guard 1 and 2 ignore a run with no timing.json` (Task 2).
2. A `timing.json` that does not parse must be counted, not silently dropped. Test: `corrupt timing.json counts one unparsed in guards 1 and 2` (Task 2).
3. Indented sub-bullets under a severity heading, and top-level bullets in a later `###` section (`### Ledger triage`), are not issues. Test: `parseReviewCounts counts only top-level items up to the next heading` (Task 1).
4. Two records' task 1 in one multi-spec run, both with `parentAgentId: null`, are two tasks. Test: `first pass keys tasks by record number within a run` (Task 2).
5. A guard 3 forge failure must not blank guards 1 and 2. Test: `guard 3 gh failure keeps guards 1 and 2 and exits 1` (Task 4).

---

### Task 1: Columns, report parsing and guard 1

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/pipeline-cost-report/guards.js`
- Test: `tests/pipeline-cost-report/guards.test.js`

**Interfaces:**
- Consumes: run objects from `tools/pipeline-cost-report/runs.js` `listRuns`: `{ name, date, dir, archived, members }`.
- Produces:
  - `selectColumns(runs, { split, n, fsImpl }) -> { before: Run[], after: Run[] }`. Both are in ascending `name` order. It first drops the runs the Run eligibility rule excludes; then `before` holds the last `n` eligible runs with `date < split`, `after` the first `n` with `date >= split`.
  - `parseReviewCounts(text) -> { critical, important, minor } | null`.
  - `readTiming(runDir, fsImpl) -> { items: Dispatch[], sessions: string[] } | null`. It returns null when `timing.json` is absent (ENOENT) and throws when the file exists but does not parse. `Dispatch` is a `dispatches.items[]` entry (`agentId, description, role, tier, parentAgentId, startTs`).
  - `readReport({ roots, sessions, agentId }, fsImpl) -> string | null`: the last assistant `text` block of the first `{root}/{slug}/{session}/subagents/agent-{agentId}.jsonl` that exists, or null when there is no file or no text block.
  - `collectWholeBranch(runs, { roots, fsImpl }) -> { share, meanCritical, meanImportant, n, unparsed }`. `share`, `meanCritical` and `meanImportant` are `null` when `n === 0`.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline-cost-report/guards.test.js`. Use the same header style as `cli.test.js`: a `mkdtempSync` DIR removed in `after`, and a `fresh(label)` helper. Add fixture helpers:
  - `writeRun(pipelines, name, { items, sessions })` writes `{pipelines}/{name}/timing.json`. Each entry of `transcripts` is `{ path: <projects>/slug-main/{session}.jsonl }`.
  - `writeReport(projects, session, agentId, text)` writes `{projects}/slug-sub/{session}/subagents/agent-{agentId}.jsonl`. The file holds one user line, then one assistant line `{type:'assistant',message:{content:[{type:'text',text}]}}`. Use `slug-sub`, not `slug-main`, so the test pins the any-slug lookup.

  Tests:
  - `parseReviewCounts counts only top-level items up to the next heading`. Input: `### Issues`, `#### Critical (Must Fix)`, `None.`, `#### Important (Should Fix)`, `1. **a**`, `   - sub`, `2. **b**`, `#### Minor (Nice to Have)`, `1. m`, `### Ledger triage`, `- t1`, `- t2`. Expect `{ critical: 0, important: 2, minor: 1 }`.
  - `parseReviewCounts: a None or N/A item counts zero`. `#### Important` followed by `- None` and `- N/A.` gives `important: 0`.
  - `parseReviewCounts: one heading is enough`. Only `#### Minor` with `- x` gives `{ critical: 0, important: 0, minor: 1 }`.
  - `AC2.1: a report with none of the three headings is unparsed`. `parseReviewCounts('API Error 403 forbidden') === null`. One run with three whole-branch reviews: one with Important items, one with only Minor items, one with no heading. Expect `n === 2`, `unparsed === 1`, `share === 0.5`.
  - `AC1.1: two Important and two Minor-only reports give 50%`. One run with four `whole-branch review` dispatches. Two reports have one item under `#### Important`; two have only `#### Minor` items (2 each). Expect `share === 0.5`, `meanImportant === 0.5`, `meanCritical === 0`, `n === 4`, `unparsed === 0`.
  - `guard 1: a missing transcript and an error reply are unparsed`. One dispatch has no report file. One report's text is `API Error 403`. One parsed report has 1 Critical item. Expect `n === 1`, `unparsed === 2`, `share === 1`, `meanCritical === 1`.
  - `AC6.1: --split 2026-11-19 --runs 2 picks the two latest before and two earliest on or after`. Runs: `2026-11-16T1-a`, `2026-11-17T1-a`, `2026-11-18T1-a`, `2026-11-19T1-a`, `2026-11-20T1-a`, passed in shuffled order. Expect before names `['2026-11-17T1-a','2026-11-18T1-a']` and after names `['2026-11-19T1-a','2026-11-20T1-a']`.
  - `selectColumns orders one date by full name and keeps a short column`. Runs: `2026-11-18T2-b`, `2026-11-18T1-a`, `2026-11-20T1-a`. With `split '2026-11-19', n 5`, before is `['2026-11-18T1-a','2026-11-18T2-b']` (length 2) and after is `['2026-11-20T1-a']`.
  - `--runs counts only pipeline runs`. Runs: `2026-11-17T1-spec-1`, `2026-11-18T1-adhoc-standalone` (no `timing.json`), `2026-11-18T2-release-standalone` (no `timing.json`), `2026-11-18T3-x` (has a `timing.json`), `2026-11-18T4-record-2`. With `split '2026-11-19', n 3`, before is `['2026-11-17T1-spec-1','2026-11-18T3-x','2026-11-18T4-record-2']`.
  - `guard 1 also reads an unlabelled final review`. One run: a `whole-branch review` dispatch with one Important item, an `unlabelled` dispatch `Final review for #5865` with one Critical item, and an `unlabelled` dispatch `Implement Task 1` with a report holding a `#### Critical` item. Expect `n === 2`, `meanCritical === 0.5`, `unparsed === 0`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: FAIL with `Cannot find module` for `tools/pipeline-cost-report/guards.js`.

- [ ] **Step 3: Implement the five functions in `tools/pipeline-cost-report/guards.js`.** Start with a header comment in `runs.js`'s style. Severity heading: `/^#{1,6}\s+(Critical|Important|Minor)\b/i`. Any other `^#{1,6}\s` line ends the current severity. Item: `/^(\d+[.)]|[-*+])\s+(.*)$/` at column 0. An item whose text, with `*`, `` ` `` and trailing `.` removed, is `None` or `N/A` (case-insensitive) is not counted. A report "with at least one of the three headings" is parsed. `readReport` lists each root's slug directories once per call; an unreadable root or slug is skipped. A line that does not parse as JSON is skipped. A review is "with an issue" when `critical + important > 0`.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/guards.test.js
git commit -m "Add the whole-branch review guard to the cost report — refs #5916"
```

### Task 2: Guard 2, task first pass

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/guards.js`
- Test: `tests/pipeline-cost-report/guards.test.js`

**Interfaces:**
- Consumes: `readTiming` (Task 1).
- Produces: `collectFirstPass(runs, { fsImpl }) -> { share, byTier: { [tier]: { share, n } }, n, unparsed }`. `share` is null when `n === 0`.

- [ ] **Step 1: Write the failing tests**
  - `AC3.1: three tasks, one re-reviewed, give 67% and the first implementer's tier`. One run, `parentAgentId: null`:
    - Task 1: `Implement Task 1: a` (standard, startTs T1) and `Review Task 1` (capable).
    - Task 2: `Implement Task 2: b` (capable, T3) and a redispatch `Implement Task 2: b again` (standard, T5). Then `Review Task 2`, then `Re-review Task 2 fix round 1`.
    - Task 3: `Implement Task 3: c` (standard, T6) and `Review Task 3`.
    - Expect `n === 3`, `Math.round(share * 100) === 67`, `byTier.standard` `{ share: 1, n: 2 }` and `byTier.capable` `{ share: 0, n: 1 }`. Task 2's tier is capable because its earliest implementer by `startTs` is capable, though its later one is standard.
  - `AC4.1: task 1 of two runs counts twice`. Two runs, each with `Implement Task 1` and `Review Task 1`. Expect `n === 2`.
  - `first pass keys tasks by record number within a run`. One run holds `Implement #5830 Task 1`, `Implement #5863 Task 1` and `Re-review Task 1 for #5863`, all with `parentAgentId: null`. Expect `n === 2` and `share === 0.5`.
  - `a dispatch naming no record inherits its task's one implementer's record`. One run, `parentAgentId: null`: `Implement #5830 Task 1`, `Review Task 1` and `Re-review Task 1 fix round 1`. Expect `n === 1`, `unparsed === 0` and `share === 0`: the re-review joins #5830's task 1.
  - `first pass keys tasks by parent agent`. One run holds `Implement Task 1` twice, under `parentAgentId` `p1` and `p2`. Expect `n === 2`.
  - `a review group with no implementer is unparsed; an untasked fix-wave re-review is ignored`. The dispatches are `Review Task 4` (no implementer for task 4), `Re-review the final-review fix wave`, `Implement Task 1` and `Implement the fix wave` (an implementer with no task number). Expect `n === 1` and `unparsed === 2`.
  - `guard 1 and 2 ignore a run with no timing.json`. One run directory has no `timing.json`. Expect `collectWholeBranch` and `collectFirstPass` to give `n === 0`, `unparsed === 0` and `share === null`.
  - `corrupt timing.json counts one unparsed in guards 1 and 2`. `timing.json` holds `{`. Each collector gives `unparsed === 1`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: FAIL. `collectFirstPass is not a function`, and the corrupt-file test for `collectWholeBranch` fails if Task 1 did not catch the throw.

- [ ] **Step 3: Implement `collectFirstPass`** under the Task key and Task dispatches rules in "Decisions the spec leaves open". If `collectWholeBranch` does not already catch a `readTiming` throw, make it do so and count 1 unparsed. A task passes when its group holds no `re-review` dispatch. Its tier is the `tier` of the implementer with the smallest `startTs`; a missing `startTs` sorts last.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/guards.test.js
git commit -m "Add the task first-pass guard to the cost report — refs #5916"
```

### Task 3: Guard 3, post-merge bug records

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/guards.js`
- Test: `tests/pipeline-cost-report/guards.test.js`

**Interfaces:**
- Consumes: `findSection(body, heading)` from `plugin/bin/lib/markdown-blocks.js`. It returns null when the heading is absent.
- Produces:
  - `keyFilesOf(body) -> string[] | null`. It returns null when there is no `### Key Files` section.
  - `collectPostMergeBugs(column, { repo, gh }) -> { count, perPr, mergedPrs, unparsed }`. An empty column gives `{ count: 0, perPr: null, mergedPrs: 0, unparsed: 0 }` with no `gh` call. `perPr` is `count / mergedPrs`, or null when `mergedPrs === 0`. A `gh` throw propagates.

- [ ] **Step 1: Write the failing tests.** Use a fake `gh(args)` that records its calls and answers three shapes:
  - `pr list`: a JSON array of `{ number, mergedAt }`.
  - `pr view <n>`: `{ files: [{ path }] }`.
  - `issue list` with `--label type:bug`: a JSON array of `{ number, createdAt, body }`.

  Tests:
  - `keyFilesOf strips backticks, a trailing :line and a trailing note`. The body is `### Key Files` followed by `` - `tools/a.js` — adds x ``, `- tools/b.js:42`, `` - `tools/c.js:10-20` — note `` and a trailing `## Gotchas` section that holds `` - `tools/z.js` ``. Expect `['tools/a.js','tools/b.js','tools/c.js']`. A body with no Key Files heading gives null.
  - `AC5.1: a bug 10 days after a merge counts; one 20 days after does not`. Column runs are dated `2026-11-01` and `2026-11-05`. PR 7 merged `2026-11-03T12:00:00Z` and changed `tools/a.js`. Bug 100 was created `2026-11-13T12:00:00Z` with Key Files `` `tools/a.js` ``. Bug 101 was created `2026-11-23T12:00:00Z` with the same Key Files. Expect `count === 1`, `mergedPrs === 1`, `perPr === 1` and `unparsed === 0`.
  - `guard 3 matches exactly and counts a bug once`. Two PRs both changed `tools/a.js`, and one bug matches both, so `count === 1` and `perPr === 0.5`. A bug listing `tools/a.jsx` does not match, and neither does a bug created before the merge.
  - `guard 3: a bug with no Key Files section is unparsed`. Expect `unparsed === 1`.
  - `guard 3 queries the column's merge window and 14 days past it`. The `pr list` call's `--search` value is `merged:2026-11-01..2026-11-05`. The `issue list` call holds `--label`, `type:bug` and `--search` `created:2026-11-01..2026-11-19`. Every call passes `--repo o/r`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: FAIL with `keyFilesOf is not a function`.

- [ ] **Step 3: Implement `keyFilesOf` and `collectPostMergeBugs`.** Each list item's text is cut at the first ` — `, backticks are removed, the text is trimmed and `/:\d+(-\d+)?$/` is removed. Empty results are dropped. `gh` argv:
  - `['pr','list','--repo',repo,'--state','merged','--search',`merged:${from}..${to}`,'--limit','1000','--json','number,mergedAt']`
  - `['pr','view',String(n),'--repo',repo,'--json','files']`
  - `['issue','list','--repo',repo,'--state','all','--label','type:bug','--search',`created:${from}..${toPlus14}`,'--limit','1000','--json','number,createdAt,body']`

  The day arithmetic is in UTC.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/guards.test.js
git commit -m "Add the post-merge bug guard to the cost report — refs #5916"
```

### Task 4: The `guards` section in the CLI

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report.js` (header comment, `SECTIONS`, `USAGE`, `parseArgs`)
- Modify: `tools/pipeline-cost-report/guards.js` (add `collectGuards`)
- Modify: `docs/plugin-structure.md` (the two `pipeline-cost-report.js` entries, lines ~165 and ~283: add `guards`, `--split`, `--runs` and `guards.js`)
- Test: `tests/pipeline-cost-report/guards.test.js`

**Interfaces:**
- Consumes: Tasks 1-3, plus `ctx.runs` (`{ runs, unparsed, unreadable, missing } | { error }`), `ctx.roots`, `ctx.repo()` and `ctx.deps.gh`/`ctx.deps.fs`.
- Produces:
  - `collectGuards({ runs, split, n, roots, repo }, { fsImpl, gh }) -> { split, runs: n, before: Column, after: Column }`. A `Column` is `{ runCount, from, to, wholeBranch, firstPass, postMergeBugs }`. `from` and `to` are null for an empty column. `postMergeBugs` is `{ error }` on a `gh` throw.
  - The `guards` entry in `SECTIONS`: `failed(d)` is true when either column's `postMergeBugs.error` is set, and `unreadable()` returns 0.

- [ ] **Step 1: Write the failing tests.** Drive them through `run({ argv, deps })` with a `harness`, as `cli.test.js` does. Use `--pipelines` pointing at a temp pipelines dir built with Task 1's `writeRun`, `--projects` pointing at a temp projects root, a fake `gh` and `--repo o/r`.
  - `AC7.1: --json prints the figures under a guards key`. With `--section guards --split 2026-11-19 --runs 2 --json`, `report.guards.split === '2026-11-19'`, `report.guards.runs === 2`, and `before.wholeBranch`, `before.firstPass` and `before.postMergeBugs` all have the keys the Global Constraints name. `before.runCount` is 2.
  - `AC1.1/AC3.1: markdown prints 50% and 67%`. Use the Task 1 AC1.1 and Task 2 AC3.1 fixtures in the before column. The markdown contains `## Guards`, a row containing `50%` and a row containing `67%`, and each guard row shows its `unparsed` count.
  - `--section guards without --split exits 2`, and also when `--split 2026-13-01` or `--runs 0`.
  - `--section all without --split marks guards not run`. The markdown holds `Guards: not run — --split <YYYY-MM-DD> not given.` and the exit is 0, with the other sections' fakes as in `cli.test.js`.
  - `guard 3 gh failure keeps guards 1 and 2 and exits 1`. `gh` throws on `pr list`. The exit is 1, the guard 1 and 2 rows still print, and the guard 3 cell reads `unavailable — {first line}`.
  - `a pipelines listing error makes the section unavailable`. With no `--pipelines` and `deps.git` throwing, `ctx.runs` is `{ error }`, so the output holds `guards: unavailable —` and the exit is 1.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js`
Expected: FAIL with `--section must be one of spend|funnel|records|all`.

- [ ] **Step 3: Implement.**
  - `parseArgs`: `--split` is validated with `isDate` and `--runs` as a positive integer (`/^[1-9]\d*$/`). `--section guards` without `--split` is an error.
  - `SECTIONS`: add the `guards` entry. `collect` returns `{ skipped: '--split not given' }` when `opts.split` is unset and throws `ctx.runs.error` when it is set. A missing pipelines directory gives empty columns.
  - Markdown render: `## Guards`, then `Split {split}; up to {runs} runs per column.`. Then a table `| Guard | Before ({runCount} runs, {from} to {to}) | After (...) |` with three rows:
    - `Whole-branch reviews with a Critical or Important issue`: `{share%} of {n}; mean {c} critical, {i} important; {u} unparsed`
    - `Tasks with no re-review`: `{share%} of {n}; {u} unparsed`
    - `Bug records within 14 days of a merge touching its Key Files`: `{count} over {mergedPrs} merged PRs ({perPr} per PR); {u} unparsed`

    A null share prints `none`. Then a `| First implementer tier | Before | After |` table from `byTier`. The skipped form prints only the not-run line.
  - Update `USAGE`, the header comment's usage line and Sections list, and the two `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run the focused suites**

Run: `node tools/run-tests.js tests/pipeline-cost-report/guards.test.js tests/pipeline-cost-report/cli.test.js`
Expected: PASS. `cli.test.js` is unchanged and still green.

- [ ] **Step 5: Real-input probe.** Run against the real run archive:

Run: `node tools/pipeline-cost-report.js --section guards --split 2026-11-18 --runs 5 --json`
Expected: exit 0 or 1 (1 only when `gh` is unreachable). Before the whole-branch review, quote in your report the printed `before` and `after` `runCount`, `from`, `to` and the `n` and `unparsed` figures for guards 1 and 2. If guard 1 or guard 2 counts every item as unparsed, the transcript lookup or the task grouping is wrong: fix it before committing. Also pin one known run. Call `collectWholeBranch([run], { roots })` from a scratch `node -e` against the archived run `2026-11-17T172201-spec-5846` (its `listRuns` entry, with `ctx.roots` defaults). It has one whole-branch review (agent `ab98a21ae8d5a0766`), with 0 Critical and 1 Important item, so expect `n: 1, unparsed: 0, share: 1, meanImportant: 1`. Quote the output.

- [ ] **Step 6: Commit**

```bash
git add tools/pipeline-cost-report.js tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/guards.test.js docs/plugin-structure.md
git commit -m "Add the guards section to the pipeline cost report — refs #5916"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`guards`, `--split`, `--runs`, columns, short column, unparsed dirs, top-level over archive) | 1 (`selectColumns`), 4 (CLI). `listRuns` already applies the undated-unparsed and top-level-over-archive rules (#5914) |
| Deliverable 2 / guard 1 | 1 |
| Deliverable 3 / guard 2 | 2 |
| Deliverable 4 / guard 3 | 3 |
| Deliverable 5 (unparsed beside each figure) | 4 (render), 1-3 (counts) |
| Deliverable 6 (tests) | 1-4 |
| AC1.1, AC2.1, AC6.1 | 1 (and AC1.1 again in 4) |
| AC3.1, AC4.1 | 2 (and AC3.1 again in 4) |
| AC5.1 | 3 |
| AC7.1 | 4 |
