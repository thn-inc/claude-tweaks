# Settle 5 below-floor `issues` digest findings (#4645) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four of the five `issues`-area digest findings #4645 promoted, and close out the fifth. The four fixes are one shared aliased-query wrapper, a dedupe test, a neutral home for the markdown fence/section primitives, and an accurate `scanFences` comment. Deliverable 3 (the uncapped MCP stale-claim listing) is closed out in the PR body under the maintainer's Reading B.

**Architecture:** Four tasks, each one independently reviewable change. Task 4 writes the per-Deliverable close-out into the draft PR body once Tasks 1–3 have commits to cite. Task 1 is a pure in-file refactor of `record-dependencies.js`. Task 2 is test-only. Task 3 moves the fence/section helpers out of `issues/record-payload.js` into a new builtins-only module, `plugin/bin/lib/markdown-blocks.js`, and migrates every direct importer, leaving no re-export at the old path. `record.js` still re-exports `fenceFor`/`fencedBlock`/`extractSection`, so its facade surface is unchanged. Task 3 also rewrites the `scanFences` comment as part of the move, because finding 5 sits on the moved block.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T221848-record-4645/work/4645-spec.md`

This plan is derived from the prior attempt's reviewed plan (closed PR #4726, run `2026-10-31T134635-record-4645`). That plan's Task 3 is dropped per the spec's Plan Review Clarifications Q1 (Reading B), and its Task 4 is renumbered Task 3.

## Global Constraints

- "Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body." (AC1)
- "Every promoted digest line in #1426 carries `→ #{this record}`." (AC2): already satisfied (see "AC2" below). No task.
- Deliverable 3 (Reading B, verbatim from the spec): "Leave the MCP path uncapped; close the Deliverable 3 bullet in the PR body. Rationale: uncapped is strictly more accurate, and the matcher already returns `failure` on a no-match listing of `>= OPEN_PR_LIST_LIMIT` entries, so uncapped never yields a false clean no-match — whereas a cap would turn a beyond-1,000 match into a fail-open claim write (the reclaim race the check exists to stop)." No task edits `plugin/skills/_shared/issue-claims.md` or `plugin/skills/tidy/scan-procedures.md`.

Waived plugin/skills/_shared/issue-claims.md: untouched under Reading B — Deliverable 3 is closed out in the PR body, not edited.
- Release Note: "No user-visible change."
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit messages follow `{Verb} {what} — {detail}` and end with `refs #4645`, never `closes` or `fixes`. Each ends with the trailer line `Claude-Session: https://claude.ai/code/session_01Ngy9oWy7YXGEHfPcd1vtBN`.
- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4645`. Use `git -C "<worktree>"`, or check `pwd` and `git rev-parse --show-toplevel` before every commit. Never run `git stash`. Run one plain command per Bash call: no heredoc `node -e`, no `git` inside `$(...)`. Write scratch scripts to a scratch file with the Write tool.
- Run dir (evidence): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T221848-record-4645` (literal path; referred to as `$RUN` below). Write evidence with a plain Bash redirect, never the Write/Edit tool.
- `lib-module-split` project skill (governs Task 3), quoted verbatim:
  - "Prove it with three checks run together. Each catches a defect the other two pass, so skipping one leaves a hole".
  - "Repointing every hit to a sub-module is the opposite error. It churns correct import advice and tells readers to bypass the facade."
  - Journey `files:` entries: "keep the old path and add the new file, because edits now land there."
  - "Run it against the base of the split commit, not against a base that already contains other edits to the file."

## AC2 (already satisfied: evidence)

Read live at plan time with `gh api repos/thn-inc/claude-tweaks/issues/comments/{id} --jq .body`:

- `5443626563`: the four-builders line ends `→ #4645`.
- `6383162471`: `materiality-60c398ca` (grouping.js:281) ends `→ #4645`.
- `6525082273`: `materiality-5267d483`, `materiality-5741dadb` and `materiality-801923a8` each end `→ #4645`.

That is five of five, so this AC gets no task.

## Review Focus

1. **Byte-identical query text (Task 1).** The helper must emit byte-identical query text for every builder, including the `\n      ` join and the `null` on empty or non-array input. The existing tests are `includes`-style and cannot see a whitespace drift. Pinned by Task 1 Step 3's scratch byte-identity diff.
2. **No importer left on the old path (Task 3).** No importer may stay on `issues/record-payload` for a moved name. A stale destructured `require` returns `undefined` and fails only when called. Pinned by Task 3 Step 5's grep.
3. **A pure move (Task 3).** `pure-move.js` checks 1–3 must pass: the export surface of `record.js`, verbatim declarations, and no require cycle. Pinned by Task 3 Step 6.
4. **One edge per duplicated in-flight id (Task 2).** A duplicated in-flight id must yield one edge carrying one copy of each shared file. Pinned by Task 2's test and its mutation probe.
5. **The pure-move base (Task 3).** The base must be captured after Task 1 commits. Task 1 changes the source of `record.js`'s re-exported builders, so a pre-Task-1 base would fail check 1 for reasons unrelated to the move. Pinned by Task 3 Step 1, which archives `HEAD` at Task 3 start.

---

### Task 1: One aliased-issue-query wrapper for the four builders

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (lines 59-101 and 206-212)
- Test (existing, unchanged): `tests/bin-lib/issues/record.test.js`

**Interfaces:**
- Produces, module-private and not exported: `buildAliasedIssueQuery(numbers, fieldExpr)`.
  - `numbers: number[]`.
  - `fieldExpr: (n: number) => string` returns the text after the `i{n}: ` alias.
  - Returns the query string, or `null` when `numbers` is not a non-empty array.
- The four exported builders (`buildNativeDependencyQuery`, `buildNativeSubIssuesQuery`, `buildNativeParentQuery`, `buildLinkedPRQuery`) keep their names, signatures and output.

- [ ] **Step 1: Capture base output for byte comparison**

Write a scratch script with the Write tool, in the scratchpad dir. It requires `plugin/bin/lib/issues/record-dependencies.js` from a root path given as argv[2], and prints `JSON.stringify` of each of the four builders over `[42]`, `[42, 731]`, `[]`, `undefined` and `'42'`. Extract the base `plugin/bin/lib` with `git archive -o {scratch}/t1-base.tar HEAD plugin/bin/lib`, then `mkdir -p {scratch}/t1-base` and `tar -xf … -C {scratch}/t1-base`, each its own Bash call. Run the script on the base and redirect its output to `{scratch}/t1-base.out`.

- [ ] **Step 2: Implement `buildAliasedIssueQuery` and route the four builders through it**

Each builder becomes a one-line call passing its existing per-alias expression, for example `(n) => \`issue(number:${n}){ number parent{ number title state } }\``. The helper owns:
- the array guard,
- the `i${n}: ` prefix,
- the `\n      ` join,
- the `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      …\n  }\n}` wrapper.

Keep every existing comment above each builder, and add one comment above the helper. No behaviour change.

- [ ] **Step 3: Verify byte identity and the existing suite**

Run the Step 1 script against the worktree root and redirect to `{scratch}/t1-head.out`, then `diff {scratch}/t1-base.out {scratch}/t1-head.out`.
Expected: no output, exit 0.
Run `mkdir -p "$RUN/evidence"`. Then redirect the diff output to `"$RUN/evidence/task1-builder-byte-identity.txt"` (use the literal `$RUN` path).
Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js tests/bin-lib/issues/linked-prs.test.js`. Include only the files that exist (`ls` first).
Expected: PASS, zero failures.

- [ ] **Step 4: Commit**

```bash
git -C "<worktree>" add plugin/bin/lib/issues/record-dependencies.js
git -C "<worktree>" commit -m "Collapse the four aliased issue-query builders — one buildAliasedIssueQuery wrapper, refs #4645" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWy7YXGEHfPcd1vtBN"
```

### Task 2: Pin findInFlightNeighbours' duplicate in-flight id dedupe

**Role:** transcription

**Files:**
- Test: `tests/bin-lib/issues/grouping.test.js` (append directly after the test at lines 1217-1223, `findInFlightNeighbours drops an in-flight duplicate of a candidate before judging hubs`)

Waived plugin/bin/lib/issues/grouping.js: read only — Step 2's scratch mutation probe deletes and restores part of line 286; the task commits no change to it.

`plugin/bin/lib/issues/grouping.js` is read-only for this task. Step 2's scratch mutation probe deletes and then restores part of line 286, and the task commits no change to it.

- [ ] **Step 1: Write the test**

```js
test('AC1.1: findInFlightNeighbours collapses an in-flight id listed twice into one edge (liveIds dedupe, #4645)', () => {
  const result = findInFlightNeighbours(
    [{ id: 1, keyFiles: ['a.js'] }],
    [{ id: 9, keyFiles: ['a.js'] }, { id: 9, keyFiles: ['a.js'] }],
    { hubPathMinCount: Infinity },
  );
  assert.deepStrictEqual(result.get(1), [{ number: 9, files: ['a.js'] }]);
});
```

The third argument `{ hubPathMinCount: Infinity }` is required (option name confirmed at `grouping.js:239`). Without it, the mutated run has three holders of `a.js`, `computeHubPaths`' threshold `max(3, ceil(3 × 0.1)) = 3` marks `a.js` a hub, and the mutation would fail on an empty result instead of on the duplicated `files`.

- [ ] **Step 2: Run and prove it discriminates**

Run: `node --test tests/bin-lib/issues/grouping.test.js`
Expected: PASS.
Then make a scratch edit that deletes ` || liveIds.has(item.id)` from `plugin/bin/lib/issues/grouping.js:286` and re-run. Confirm the new test FAILS: the edge carries duplicated files, or the result holds two edges. Restore the line with the Edit tool. `git -C <worktree> diff -- plugin/bin/lib/issues/grouping.js` must print nothing. Record the FAIL line and the empty diff in your report.

- [ ] **Step 3: Commit**

```bash
git -C "<worktree>" add tests/bin-lib/issues/grouping.test.js
git -C "<worktree>" commit -m "Pin the in-flight id dedupe in findInFlightNeighbours — a twice-listed id yields one edge, refs #4645" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWy7YXGEHfPcd1vtBN"
```

### Task 3: Move the markdown fence/section primitives to `plugin/bin/lib/markdown-blocks.js`

**Role:** judgment

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/markdown-blocks.js`
- Modify: `plugin/bin/lib/issues/record-payload.js`:
  - `:1-10`: the header.
  - `:79-166`: remove the moved block (`fenceFor` through `unfencedText`, with their comments).
  - `:310-354`: remove the moved block, including the dead `ANY_HEADING_RE` (`findSection`, `extractSection`).
  - `:496-500`: the exports.
- Modify: `plugin/bin/lib/issues/record.js`:
  - `:7-16`: add `../markdown-blocks.js` to the header's module list.
  - `:24-28`: import `fenceFor, fencedBlock, extractSection` from `../markdown-blocks`.
- Modify: `plugin/bin/lib/preflight-records/merge-gate.js:14`
- Modify: `plugin/bin/lib/issues/near-duplicate.js:22`
- Modify: `plugin/bin/lib/issues/materialize-format.js`, lines 10 (require) and 71 (comment `(fencedLineRanges, record-payload.js)`)
- Modify: `plugin/bin/lib/issues/autonomy.js:17-21` (the comment about what the sub-modules require)
- Modify: `tests/bin-lib/issues/record.test.js`, lines 1447, 1456 and 1463
- Modify: `tests/bin-lib/issues/materialize-format.test.js:10`
- Modify: `docs/plugin-structure.md`:
  - `:29`: the `record-payload.js [...]` clause. It keeps recordPayload/specShapedBody composition and the body-metadata extractors. findSection, extractSection and fencedLineRanges/fencedLineMask now live in `../markdown-blocks.js`.
  - Add a `plugin/bin/lib/markdown-blocks.js` row next to the `plugin/bin/lib/strip-comments.js` row (`:79`).
- Modify the journeys:
  - `docs/journeys/run-a-batch-whose-record-needs-a-merged-prerequisite-2733.md`
  - `docs/journeys/dispatch-a-near-duplicate-pair-by-name-3520.md`
  - `docs/journeys/harness-health-premise-check.md`
  - `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md`
  - `docs/journeys/give-an-agent-filed-record-a-key-files-list-2975.md`
  - `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md`

Journey edits: in each journey's frontmatter `files:` list, add `plugin/bin/lib/markdown-blocks.js` and keep the existing `record-payload.js` entry. First confirm with a grep that a module its steps exercise calls a moved function, and drop any journey that does not. Line 52 of the 2733 journey is a history note ("Updated during #4369's build"). It records what was true then and stays unchanged.

**Interfaces:**
- `plugin/bin/lib/markdown-blocks.js` exports:
  - `fenceFor(text) -> string`
  - `fencedBlock(text) -> string`
  - `fencedLineRanges(lines) -> Array<[number, number]>`
  - `fencedLineMask(lines, { unclosedAsText? }) -> boolean[]`
  - `unfencedText(body) -> string`
  - `findSection(body, heading, opts) -> string | null`
  - `extractSection(body, heading, opts) -> string`

  `scanFences` stays module-private. The module has no `require(` at all.
- `record-payload.js` keeps exporting `DEFER_REASONS, recordPayload, specShapedBody, isRepoRelativeKeyFilePath, extractVerifiedAsOf, extractPremiseCheck, extractTemplateStamp`. It requires whichever of `{ unfencedText, fencedLineMask, … }` its remaining code still calls from `../markdown-blocks`; grep the remaining body to decide. It no longer exports `fenceFor, fencedBlock, fencedLineRanges, fencedLineMask, findSection, extractSection`. Every direct importer is migrated in this task, with no re-export shim.
- `record.js`'s export surface is unchanged: same keys, same function source.

- [ ] **Step 1: Capture the base tree for the pure-move proof**

At Task 3 start, which is after Tasks 1 and 2 have committed and before any Task 3 edit, archive `plugin/bin/lib` at `HEAD` into `{scratch}/t3-base`. Use `mkdir -p`, `git archive -o {scratch}/t3-base.tar HEAD plugin/bin/lib` and `tar -xf`, each its own Bash call.

- [ ] **Step 2: Create `markdown-blocks.js` and remove the block from `record-payload.js`**

Move these declarations byte for byte, with their comments: `fenceFor`, `fencedBlock`, `scanFences`, `fencedLineRanges`, `fencedLineMask`, `unfencedText`, `findSection` and `extractSection`. Delete `ANY_HEADING_RE` (`record-payload.js:310`), which nothing in that file uses; `near-duplicate.js:89` keeps its own copy.

Give the new file a one-paragraph header comment covering three points:
- its purpose: the one CommonMark fence rule and the heading-section finder, shared across `issues/`, `preflight-records/`, and (through `record.js`) `console/` and `compose-subject.js`;
- builtins-only;
- no I/O.

- [ ] **Step 3: Rewrite the `scanFences` comment (finding 5)**

Replace the lead "lines -> [start, end] inclusive line-index ranges, one per fenced block…" with a contract that states the real return, `lines -> { ranges, unclosed }`:
- `ranges` holds one `[start, end]` inclusive line-index pair per fenced block, running from the opening fence line through its closing fence line, or to `lines.length - 1` when the block is unclosed.
- `unclosed` is `true` when the last block found has no closer and so runs to the end of the input. Only the last block can be unclosed, because an unclosed block consumes every line after it.

Also say that `fencedLineRanges` returns `ranges` alone and that `fencedLineMask` reads `unclosed` for `unclosedAsText`. Keep the rest of the comment, meaning the consumer list and the opener/closer rules.

- [ ] **Step 4: Migrate every importer and the stale-location prose**

Repoint the `require`s listed in Files, in code and tests, to the new module:
- `'../markdown-blocks'` from `issues/` and `preflight-records/`;
- `'../../../plugin/bin/lib/markdown-blocks'` from `tests/bin-lib/issues/`.

`record.js` keeps re-exporting `fenceFor, fencedBlock, extractSection` (its facade surface), now sourced from `../markdown-blocks`.

Rewrite three comments:
- `record-payload.js`'s header lines 6-10: drop the claims about the section extractor and the fence helpers.
- `materialize-format.js:71`'s `(fencedLineRanges, record-payload.js)`: make it name `markdown-blocks.js`.
- `autonomy.js:17-21`'s requires claim: record-payload.js now requires `node:path`, `./record-vocabulary` and `../markdown-blocks`, and `markdown-blocks.js` requires nothing.

Then run the `lib-module-split` sweep shapes 1–4 with `record-payload.js` (and `record-payload`) substituted for `record.js`. For each hit, apply that skill's import-path vs definition-location test: a hit naming `record.js` for an export it still re-exports is kept. Update `docs/plugin-structure.md` and the journeys as listed in Files.

- [ ] **Step 5: Verify no importer is left on the old path for a moved name**

Run: `git -C "<worktree>" grep -n -E "fencedLine(Ranges|Mask)|findSection|scanFences|unfencedText" -- plugin tests docs/plugin-structure.md`
Expected: every hit falls in one of four places:
- `plugin/bin/lib/markdown-blocks.js`;
- a consumer that requires `markdown-blocks`;
- a test;
- prose that names `markdown-blocks.js`.

No hit names `record-payload.js` as their home.
Run: `git -C "<worktree>" grep -n "record-payload')" -- plugin tests` and confirm that no destructuring line names a moved function.

- [ ] **Step 6: Pure-move proof**

Write `lib-module-split`'s `pure-move.js` to the scratchpad. Make one change to it: check 2's `lines` read `plugin/bin/lib/issues/record-payload.js` from the base root rather than the facade, because the split file here is record-payload.js and not the facade. Use the worktree root itself as `<headRoot>`. Task 3's edits are still uncommitted at this step, so a `git archive … HEAD` head would capture the pre-Task-3 tree with no `markdown-blocks.js`, and the script would throw ENOENT. The live worktree resolves `../markdown-blocks` against the edits. Then run:
`node {scratch}/pure-move.js {scratch}/t3-base "<worktree>" plugin/bin/lib/issues/record.js plugin/bin/lib/issues/record-payload.js plugin/bin/lib/markdown-blocks.js`

Expected:
- check 1 reports the same keys and the same source.
- check 2 shows every base `record-payload.js` top-level declaration verbatim, except exactly one `MISSING: const ANY_HEADING_RE`, the deliberate dead-code drop. A head-side `const { … } = require('../markdown-blocks')` line is a `require(` line and is skipped.
- check 3 shows 0 cycles and 0 sub-modules requiring the facade.

The script exits 1 because of the expected single MISSING line; that is accepted only for that line. Run `mkdir -p` first, then save the output with a plain Bash redirect to `"$RUN/evidence/task3-pure-move.txt"`.
Then pin the leaf property by inspection: `grep -c "require(" plugin/bin/lib/markdown-blocks.js` prints `0`.

- [ ] **Step 7: Run the affected suites**

Run: `node --test tests/bin-lib/issues/*.test.js tests/bin-lib/preflight-records/*.test.js tests/bin-lib/compose-subject.test.js`. Expand the globs with `ls` first and pass the literal file list, because the worktree guard refuses glob arguments. Also run any `tests/*.test.js` that greps `record-payload`, found with `git grep -l "record-payload" -- tests`.
Expected: PASS, zero failures.

- [ ] **Step 8: Commit**

```bash
git -C "<worktree>" add plugin/bin/lib/markdown-blocks.js plugin/bin/lib/issues/record-payload.js plugin/bin/lib/issues/record.js plugin/bin/lib/preflight-records/merge-gate.js plugin/bin/lib/issues/near-duplicate.js plugin/bin/lib/issues/materialize-format.js plugin/bin/lib/issues/autonomy.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js docs/plugin-structure.md {each edited journey path}
git -C "<worktree>" commit -m "Move the markdown fence and section primitives to lib/markdown-blocks.js — out of the record-payload builder, scanFences' return documented, refs #4645" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWy7YXGEHfPcd1vtBN"
```

### Task 4: Close out every Deliverable in the draft PR body

**Role:** transcription

**Files:**
- No repository file. The task edits the body of draft PR #4784 on GitHub.

The pipeline composes the PR body mechanically, through `composePrEarlyBody` (`plugin/bin/lib/flow/pr-body.js:104`): a run marker, then `### Spec summary`, `### Phases` and `### Resume`, then the fixes span. Neither `bin/pr-checklist.js` (it rewrites only the phases span) nor `repairPrBody` (it appends only missing spans and keeps freeform prose) nor `reviseSpecSummary` (it rewrites only the lines between `### Spec summary` and the next level 1-3 heading) touches a separate `###` section. So AC1's per-bullet close-out lives in its own `### Deliverables close-out` section, appended at the end of the body.

**Interfaces:**
- Consumes: the commit SHAs of Tasks 1–3 (`git -C "<worktree>" log --format='%h %s' origin/main..HEAD`).

- [ ] **Step 1: Read the live body**

Run `gh pr view 4784 --json body --jq .body` and redirect it to `{scratch}/pr-4784-body.md`.

- [ ] **Step 2: Append the close-out section**

Use the Write tool to write `{scratch}/pr-4784-body-new.md`: the Step 1 body unchanged, a blank line, then exactly this, with each `{sha}` replaced by that task's short commit SHA:

```markdown
### Deliverables close-out

- Four near-identical aliased-GraphQL builders: fixed in {task-1-sha}. One module-private `buildAliasedIssueQuery(numbers, fieldExpr)` in `record-dependencies.js`, with byte-identical query output (no behaviour change, so no new test).
- No test for a duplicate in-flight id: fixed in {task-2-sha}. New `grouping.test.js` case; deleting the `liveIds` dedupe turns it red.
- MCP stale-claim path pages until exhausted: closed out, not changed (Reading B). Uncapped is strictly more accurate, and the matcher already returns `failure` on a no-match listing of `>= OPEN_PR_LIST_LIMIT` entries, so uncapped never yields a false clean no-match. A cap would turn a beyond-1,000 match into a fail-open claim write.
- Fence/section primitives in the record-payload builder, imported across domains by `merge-gate.js`: fixed in {task-3-sha}. Moved to `plugin/bin/lib/markdown-blocks.js`, with every importer migrated (pure-move proof in the run's evidence).
- `scanFences` comment omits `unclosed`: fixed in {task-3-sha}. The comment now states the `{ ranges, unclosed }` return.
```

- [ ] **Step 3: Write and read back**

Run `gh pr edit 4784 --body-file {scratch}/pr-4784-body-new.md`. Then run `gh pr view 4784 --json body --jq .body` and confirm two things: the output contains `### Deliverables close-out` with all five bullets, and the run marker, `### Phases` span and fixes span from Step 1 are still present. When `gh` is absent, use MCP `update_pull_request` and `pull_request_read` instead.
Expected: both checks hold. Record the read-back's `### Deliverables close-out` section in your report.

## Spec coverage map

| Deliverable / AC | Task |
|---|---|
| Four near-identical aliased builders | Task 1 (no behaviour change, so a byte-identity scratch check and no new test) |
| No test for duplicate in-flight id | Task 2 (AC1.1) |
| MCP stale-claim path uncapped | Task 4 (closed out in the PR body's `### Deliverables close-out` with the Reading B rationale; AC1.1) |
| Fence/section primitives in the record-payload builder, imported by merge-gate.js | Task 3 |
| `scanFences` comment omits `unclosed` | Task 3 Step 3 (comment only) |
| AC1.1 each bullet fixed or closed out in the PR body | Tasks 1–3 fix four bullets; Task 4 Step 3 verifies all five close-out lines in the PR body |
| AC2.1 digest lines carry `→ #4645` | Verified above; no task |
