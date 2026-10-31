# Settle 5 below-floor `issues` digest findings (#4645) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five `issues`-area digest findings #4645 promoted: one shared aliased-query wrapper, a dedupe test, a capped MCP stale-claim listing, a neutral home for the markdown fence/section primitives, and an accurate `scanFences` comment.

**Architecture:** Four tasks, one per independently reviewable change. Task 1 is a pure in-file refactor of `record-dependencies.js`. Task 2 is test-only. Task 3 is skill prose plus its conformance pins. Task 4 moves the fence/section helpers out of `issues/record-payload.js` into a new builtins-only leaf, `plugin/bin/lib/markdown-blocks.js`, migrates every importer (no re-export left at the old path), and rewrites the `scanFences` comment while moving it (finding 5 sits on the moved block, so it rides in the same task).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T134635-record-4645/work/4645-spec.md`

## Global Constraints

- "Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body." (AC1)
- "Every promoted digest line in #1426 carries `→ #{this record}`." (AC2) — verified already satisfied at plan time, see "AC2" below; no task.
- Release Note: "No user-visible change."
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit messages: `{Verb} {what} — {detail}`, with `refs #4645` — never `closes`/`fixes`.
- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4645`. Use `git -C "<worktree>"` or check `pwd` + `git rev-parse --show-toplevel` before every commit. Never `git stash`.
- `lib-module-split` project skill (governs Task 4), quoted: "Prove it with three checks run together. Each catches a defect the other two pass, so skipping one leaves a hole"; "Repointing every hit to a sub-module is the opposite error. It churns correct import advice and tells readers to bypass the facade."; journey `files:` entries: "keep the old path and add the new file, because edits now land there."

## AC2 (already satisfied — evidence)

Read live at plan time with `gh api repos/thn-inc/claude-tweaks/issues/comments/{id} --jq .body`:
- `5443626563`: the four-builders line ends `→ #4645`.
- `6383162471`: `materiality-60c398ca` (grouping.js:281) ends `→ #4645`.
- `6525082273`: `materiality-5267d483`, `materiality-5741dadb`, `materiality-801923a8` each end `→ #4645`.
Five of five. Logged as an `AC evidence` decision; no task.

## Review Focus

1. Task 1's helper must emit byte-identical query text for every builder (including the `\n      ` join and the `null` on empty/non-array input) — a whitespace drift is invisible to the existing `includes`-style tests. Pinned by Task 1 Step 3's scratch byte-identity check.
2. Task 4 must not leave any importer on `issues/record-payload` for a moved name — a stale `require` returns `undefined` and only fails when called. Pinned by Task 4 Step 5's grep.
3. Task 4's move must be pure: `pure-move.js` checks 1–3 (export surface of `record.js`, verbatim declarations, no require cycle). Pinned by Task 4 Step 6.
4. Task 3's cap must match what the matcher treats as the limit (`OPEN_PR_LIST_LIMIT` = 1000 = 10 pages × `perPage: 100`), or the MCP path could stop short of the limit and report a clean no-match. Pinned by the code-twin assertion in Task 3.
5. A duplicated in-flight id must yield one edge with one copy of each shared file. Pinned by Task 2.

---

### Task 1: One aliased-issue-query wrapper for the four builders

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (lines 59-101 and 206-212)
- Test (existing, unchanged): `tests/bin-lib/issues/record.test.js:612-681`

**Interfaces:**
- Produces (module-private, not exported): `buildAliasedIssueQuery(numbers, fieldExpr)` — `numbers: number[]`, `fieldExpr: (n: number) => string` returning the text after the `i{n}: ` alias; returns the query string, or `null` when `numbers` is not a non-empty array.
- The four exported builders keep their names, signatures and output.

- [ ] **Step 1: Capture base output for byte comparison**

Write a scratch script (Write tool, scratchpad dir) that requires `plugin/bin/lib/issues/record-dependencies.js` from a path given as argv[2] and prints `JSON.stringify` of each builder over `[42]`, `[42, 731]`, `[]`, `undefined`, `'42'`. Extract the base tree with `git archive` (as `lib-module-split` shows) and run it on base, saving the output to a scratch file.

- [ ] **Step 2: Implement `buildAliasedIssueQuery` and route the four builders through it**

Each builder becomes a one-line call passing its existing per-alias expression, e.g. `(n) => \`issue(number:${n}){ number parent{ number title state } }\``. The helper owns the array guard, the `i${n}: ` prefix, the `\n      ` join and the `query($owner:String!,$repo:String!){…}` wrapper. Keep every existing comment above each builder; add one comment above the helper. No behaviour change.

- [ ] **Step 3: Verify byte identity and the existing suite**

Run the Step 1 script on the worktree tree and `diff` against the base output. Expected: no diff.
Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: PASS, zero failures.
Write the diff command and its (empty) result as AC evidence: `mkdir -p "$RUN/evidence"`, redirect the diff output to `"$RUN/evidence/task1-builder-byte-identity.txt"` (`$RUN` = `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T134635-record-4645`, literal path).

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js
git commit -m "Collapse the four aliased issue-query builders — one buildAliasedIssueQuery wrapper, refs #4645"
```

### Task 2: Pin findInFlightNeighbours' duplicate in-flight id dedupe

**Role:** transcription

**Files:**
- Test: `tests/bin-lib/issues/grouping.test.js` (append after the test at line 1217-1223)

Waived plugin/bin/lib/issues/grouping.js: read only — Step 2's scratch mutation probe deletes and restores its line 286; the task commits no change to it.

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

- [ ] **Step 2: Run and prove it discriminates**

Run: `node --test tests/bin-lib/issues/grouping.test.js`
Expected: PASS.
Then on a scratch edit, delete `|| liveIds.has(item.id)` from `plugin/bin/lib/issues/grouping.js:286`, re-run, and confirm the new test FAILS (`files: ['a.js', 'a.js']`); restore the line (`git -C <worktree> diff -- plugin/bin/lib/issues/grouping.js` must print nothing).

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/issues/grouping.test.js
git commit -m "Pin the in-flight id dedupe in findInFlightNeighbours — a twice-listed id yields one edge, refs #4645"
```

### Task 3: Cap the MCP stale-claim open-PR listing at the gh path's limit

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md:184-185` (47,323 B; rail 52,500 B — already past the 90% `nearCeiling` mark, soft flag only; this edit adds < 200 B)
- Modify: `plugin/skills/tidy/scan-procedures.md:246-247` (51,207 B; `nearCeiling`, soft; this edit adds < 120 B)
- Test: `tests/issue-claims-stale-open-pr-conformance.test.js`, `tests/tidy-stale-claim-open-pr-conformance.test.js`

Fact behind the wording (behavioral-claim check): `claim-store.js:565` — `matchStaleClaimPr` throws `open-PR listing hit its 1000-entry limit` when a no-match listing has `>= OPEN_PR_LIST_LIMIT` entries, and `bin/stale-claim-pr.js` turns that throw into a non-null `failure`. So a listing capped at exactly 1,000 entries degrades to "could not tell", never to a clean no-match. tidy's MCP listing feeds the same CLI and the same limit, so it is the same finding's twin site.

**Interfaces:**
- Consumes: `OPEN_PR_LIST_LIMIT` from `plugin/bin/lib/issues/claim-store.js` (1000).

- [ ] **Step 1: Write the failing tests**

In `tests/issue-claims-stale-open-pr-conformance.test.js` (require `OPEN_PR_LIST_LIMIT` beside `RUN_ID_SHAPE`):

```js
test('AC1.1: the MCP stale-claim listing stops at the gh path\'s OPEN_PR_LIST_LIMIT (#4645)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  assert.ok(!step4.includes('until exhausted'), 'the MCP listing is capped, not paged until exhausted');
  assert.ok(step4.includes('`perPage: 100`'), 'names the page size the cap is counted in');
  assert.ok(step4.includes('10 pages'), 'names the page cap');
  assert.ok(step4.includes('`OPEN_PR_LIST_LIMIT`'), 'ties the cap to the gh twin\'s limit');
  assert.equal(10 * 100, OPEN_PR_LIST_LIMIT, 'the prose cap (10 pages × perPage 100) must equal OPEN_PR_LIST_LIMIT');
});
```

In `tests/tidy-stale-claim-open-pr-conformance.test.js` (add `const { OPEN_PR_LIST_LIMIT } = require('../plugin/bin/lib/issues/claim-store');`):

```js
test('AC1.1: the tidy MCP stale-claim listing stops at the gh path\'s OPEN_PR_LIST_LIMIT (#4645)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' ');
  assert.ok(flat.includes('`perPage: 100`'), 'names the page size the cap is counted in');
  assert.ok(flat.includes('10 pages'), 'names the page cap');
  assert.ok(flat.includes('`OPEN_PR_LIST_LIMIT`'), 'ties the cap to the gh twin\'s limit');
  assert.equal(10 * 100, OPEN_PR_LIST_LIMIT, 'the prose cap (10 pages × perPage 100) must equal OPEN_PR_LIST_LIMIT');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: FAIL — the two new tests (the base text says `until exhausted` / `paged`, and names neither `10 pages` nor `OPEN_PR_LIST_LIMIT`).

- [ ] **Step 3: Edit the prose**

`issue-claims.md` step 4: replace `(\`state: open\`, \`perPage: 100\`, paging until exhausted)` with `(\`state: open\`, \`perPage: 100\`, paging until a page comes back short or 10 pages are read — 1,000 entries, the \`gh\` path's \`OPEN_PR_LIST_LIMIT\`, past which the CLI reports a no-match as a failure)`. Keep the surrounding sentence and the line wrap style (~98 columns, 5-space continuation indent).

`tidy/scan-procedures.md` Step 4.7: replace `(\`state: open\`, paged)` with `(\`state: open\`, \`perPage: 100\`, at most 10 pages — the \`gh\` path's \`OPEN_PR_LIST_LIMIT\`)`. Re-wrap only the lines touched.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: PASS, all tests. Also `wc -c` both skill files — each must stay under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js
git commit -m "Cap the MCP stale-claim open-PR listing — 10 pages, the gh path's OPEN_PR_LIST_LIMIT, refs #4645"
```

### Task 4: Move the markdown fence/section primitives to `plugin/bin/lib/markdown-blocks.js`

**Role:** judgment

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/markdown-blocks.js`
- Modify: `plugin/bin/lib/issues/record-payload.js:1-10` (header), `:79-166` (remove moved block), `:310-354` (remove moved block, incl. dead `ANY_HEADING_RE`), `:496-500` (exports)
- Modify: `plugin/bin/lib/issues/record.js:7-28` (import fenceFor/fencedBlock/extractSection from `../markdown-blocks`; header list)
- Modify: `plugin/bin/lib/preflight-records/merge-gate.js:14`
- Modify: `plugin/bin/lib/issues/near-duplicate.js:22`
- Modify: `plugin/bin/lib/issues/materialize-format.js` (lines 10 and 71)
- Modify: `plugin/bin/lib/issues/autonomy.js:17-21` (requires-claim comment)
- Modify: `tests/bin-lib/issues/record.test.js` (lines 1447, 1456, 1463)
- Modify: `tests/bin-lib/issues/materialize-format.test.js:10`
- Modify: `docs/plugin-structure.md:19` (flat-helper list) and `:28` (record-payload clause); add a `plugin/bin/lib/markdown-blocks.js` row beside the `strip-comments.js` row (`:77`)
- Modify: `docs/journeys/run-a-batch-whose-record-needs-a-merged-prerequisite-2733.md`
- Modify: `docs/journeys/dispatch-a-near-duplicate-pair-by-name-3520.md`
- Modify: `docs/journeys/harness-health-premise-check.md`
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md`
- Modify: `docs/journeys/give-an-agent-filed-record-a-key-files-list-2975.md`
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md`

Journey edits: in each journey's frontmatter file list, add `plugin/bin/lib/markdown-blocks.js` and keep the existing `record-payload.js` entry — first confirm with a grep that a module its steps exercise calls a moved function; drop any journey that does not. The 2733 journey's line 52 history note ("Updated during #4369's build") records what was true then and stays unchanged.

**Interfaces:**
- Produces `plugin/bin/lib/markdown-blocks.js` exports: `fenceFor(text) -> string`, `fencedBlock(text) -> string`, `fencedLineRanges(lines) -> Array<[number, number]>`, `fencedLineMask(lines, { unclosedAsText? }) -> boolean[]`, `unfencedText(body) -> string`, `findSection(body, heading, opts) -> string | null`, `extractSection(body, heading, opts) -> string`. `scanFences` stays module-private. The module requires nothing (no `require(` at all).
- `record-payload.js` keeps exporting `DEFER_REASONS, recordPayload, specShapedBody, isRepoRelativeKeyFilePath, extractVerifiedAsOf, extractPremiseCheck, extractTemplateStamp`; it requires `{ unfencedText }` from `../markdown-blocks`. It no longer exports `fenceFor, fencedBlock, fencedLineRanges, fencedLineMask, findSection, extractSection` — every importer is migrated in this task, no re-export shim.
- `record.js`'s export surface is unchanged (same keys, same function source).

- [ ] **Step 1: Capture the base tree for the pure-move proof**

`git archive` `plugin/bin/lib` at `HEAD` (before any Task 4 edit) into `{scratch}/base`, per `lib-module-split`'s "Extract base and head".

- [ ] **Step 2: Create `markdown-blocks.js` and remove the block from `record-payload.js`**

Move, byte-for-byte, these declarations with their comments: `fenceFor`, `fencedBlock`, `scanFences`, `fencedLineRanges`, `fencedLineMask`, `unfencedText`, `findSection`, `extractSection`. Delete `ANY_HEADING_RE` (`record-payload.js:310`, unused anywhere in that file — `near-duplicate.js:89` keeps its own). Header comment for the new file: one-paragraph purpose (the one CommonMark fence rule and heading-section finder, shared across `issues/`, `preflight-records/`, `console/`, `compose-subject.js`), builtins-only, no I/O.

- [ ] **Step 3: Rewrite the `scanFences` comment (finding 5)**

Replace the "lines -> [start, end] inclusive line-index ranges, one per fenced block…" lead with a contract that states the real return: `lines -> { ranges, unclosed }`: `ranges` holds one `[start, end]` inclusive line-index pair per fenced block (opening fence line through its closing fence line, or `lines.length - 1` when unclosed); `unclosed` is `true` when the last block found has no closer and so runs to the end of the input — only the last block can, since an unclosed block consumes every line after it. Say that `fencedLineRanges` returns `ranges` alone and `fencedLineMask` reads `unclosed` for `unclosedAsText`. Keep the rest of the comment (consumer list, opener/closer rules), updating the consumer list's file names only where they moved.

- [ ] **Step 4: Migrate every importer and the stale-location prose**

Repoint the `require`s listed in Files (code and tests) to the new module (`'../markdown-blocks'` from `issues/` and `preflight-records/`; `'../../../plugin/bin/lib/markdown-blocks'` from `tests/bin-lib/issues/`). `record.js` keeps re-exporting `fenceFor, fencedBlock, extractSection` (its facade surface), now sourced from `../markdown-blocks`; add the module to its header's sub-module list. Rewrite `record-payload.js`'s header lines 8-10, `materialize-format.js:71`'s `(fencedLineRanges, record-payload.js)`, and `autonomy.js:17-21`'s requires claim (record.js now also requires `../markdown-blocks`; record-payload.js requires `node:path`, `./record-vocabulary` and `../markdown-blocks`; `markdown-blocks.js` requires nothing). Then run the `lib-module-split` sweep shapes 1–4 with `record-payload.js` substituted for `record.js`, and for each hit apply that skill's import-path vs definition-location test. Update `docs/plugin-structure.md` and the journeys as listed in Files.

- [ ] **Step 5: Verify no importer is left on the old path for a moved name**

Run: `git grep -n -E "fencedLine(Ranges|Mask)|findSection|scanFences|unfencedText" -- plugin tests docs/plugin-structure.md`
Expected: every hit is in `plugin/bin/lib/markdown-blocks.js`, a consumer requiring `markdown-blocks`, a test, or prose naming `markdown-blocks.js` — none names `record-payload.js` as their home.
Run: `git grep -n "record-payload')" -- plugin tests` and confirm no destructuring line names a moved function.

- [ ] **Step 6: Pure-move proof**

Run `lib-module-split`'s `pure-move.js` (Write it to the scratchpad) with base `{scratch}/base`, head = the worktree, facade `plugin/bin/lib/issues/record.js`, new modules `plugin/bin/lib/issues/record-payload.js plugin/bin/lib/markdown-blocks.js` (archive both trees at the `plugin/bin/lib` level so `../markdown-blocks` resolves). Point check 2 at the base `record-payload.js` (not the facade) by passing it through a copy of the script whose `lines` read `plugin/bin/lib/issues/record-payload.js`.
Expected: check 1 — same keys, same source; check 2 — all base `record-payload.js` top-level declarations verbatim except exactly one `MISSING: const ANY_HEADING_RE` (the deliberate dead-code drop); check 3 — 0 cycles, 0 sub-modules requiring the facade. Save the output to `"$RUN/evidence/task4-pure-move.txt"` (`mkdir -p` first, plain Bash redirect, literal `$RUN` path from Task 1).
Then pin the leaf property by inspection: `grep -c "require(" plugin/bin/lib/markdown-blocks.js` prints `0`.

- [ ] **Step 7: Run the affected suites**

Run: `node --test tests/bin-lib/issues/ tests/bin-lib/preflight-records/ tests/bin-lib/console/ tests/bin-lib/compose-subject.test.js tests/health-filing-parity.test.js`
Expected: PASS, zero failures.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/markdown-blocks.js plugin/bin/lib/issues/record-payload.js plugin/bin/lib/issues/record.js plugin/bin/lib/preflight-records/merge-gate.js plugin/bin/lib/issues/near-duplicate.js plugin/bin/lib/issues/materialize-format.js plugin/bin/lib/issues/autonomy.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js docs/plugin-structure.md docs/journeys/
git commit -m "Move the markdown fence and section primitives to lib/markdown-blocks.js — out of the record-payload builder, scanFences' return documented, refs #4645"
```

## Spec coverage map

| Deliverable / AC | Task |
|---|---|
| Four near-identical aliased builders | Task 1 (no behaviour change → byte-identity scratch check, no new test) |
| No test for duplicate in-flight id | Task 2 (AC1.1) |
| MCP stale-claim path uncapped | Task 3 (AC1.1) |
| Fence/section primitives in the record-payload builder, imported by merge-gate.js | Task 4 |
| `scanFences` comment omits `unclosed` | Task 4 Step 3 (comment only) |
| AC1.1 each bullet fixed or closed out in the PR body | Tasks 1–4; PR body lists each with its commit |
| AC2.1 digest lines carry `→ #4645` | Verified above; no task |
