# Queue pull: a failed dep-freshness search fails open with no Warning (#5310) Implementation Plan

> Rewritten 2026-11-16 against HEAD 1434c5d3f7 (after #5311 landed on this branch and the user answered the plan-review question: Reading A, one Warning per failed search). Every line reference below is from that HEAD.

**Goal:** A failed dependency-freshness search (`gh issue list --search "#a #b" --state all ...`) prints one `Warning:` line naming that search and its consequence — one line per failed search, so two when both the cache-check and the write-back search fail — the pull never takes a queue-order cache hit on it, and a pull whose write-back search failed persists no queue-order blob. Module and fence, parity kept.

**Architecture:** The search runs at two sites, in both the module and the fence:
- the cache check — module `runFetch` (`plugin/bin/lib/dispatch/queue-pull.js:510-513`), fence `plugin/skills/dispatch/queue-pull-script.md:93-95` — over the persisted signal's dependency-only numbers;
- the write-back — module `runWriteBack` (`queue-pull.js:757-760`), fence `queue-pull-script.md:268-270` — over every eligible record's dependencies.

Both write `[]` on failure with stderr dropped and nothing printed (module `fetchDepFreshness`, `queue-pull.js:267-273`: `put(ctx, file, r.ok ? r.stdout : '[]')`; fence: `2>/dev/null || echo '[]' > "$DISPATCH_DEP_FRESHNESS"`).

At the cache check the `[]` already forces a miss: the numbers searched are exactly the persisted signal's issues that are not in the current auto:build queue, so with none of them answered the current signal has fewer issues than the persisted one and `signalsMatch` (`plugin/bin/lib/dispatch/queue-order.js:95`) returns false on the length. The fix there is the Warning alone.

At the write-back the `[]` is persisted as a freshness signal with the dependencies missing; the next pull then searches nothing and hits the cache with no dependency re-checked. So the write-back is skipped after a failed search, beside #5309's and #5311's skips (module `queue-pull.js:764-765`; fence guard `queue-pull-script.md:272`, `if [ -z "$NATIVE_UNREADABLE$DEP_UNREADABLE" ]; then`).

The fence change is inline at the two `gh issue list --search` lines (no new shell function), so the MCP-path sentence at `queue-pull-script.md:661` stays as it is.

**Tech Stack:** Node 18+ module, bash fence, `node --test` with the bash parity oracle (`tests/bin-lib/dispatch/queue-pull-oracle.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5310/work/5310-spec.md` (materialized from GitHub issue #5310; the Decision paragraph records Reading A)

Scope keywords: fetchDepFreshness, DEP_FRESH_FAIL

## Global Constraints

- Fix both module and fence, and keep the parity row: #5230 is CLOSED but #5231 (remove the fence) is OPEN, so the spec's rule applies ("if the fence … has not been removed by #5231 when this lands, fix both and keep the parity row").
- `plugin/skills/dispatch/queue-pull-script.md` is 52,495 bytes at HEAD; the rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`) is 52,500. The finished file must be `wc -c` ≤ 52,500. The fence change adds about 290 bytes, so it trims the two four-line `excluded`-shape comments named in Step 4 to one line each (about 380 bytes saved). Trim restatement only; never a clause that tells the reader what to do. Quote `wc -c` before and after.
- The Warning text, both sides, byte for byte (the dash is U+2014, as in every other queue-pull Warning):
  - cache check: `Warning: dependency-freshness search failed — queue-order cache not used this run`
  - write-back: `Warning: dependency-freshness search failed — queue-order cache not written this run`
- `--transport files` is unchanged: the agent's file stands where the search stands, and a missing or non-array file already prints its own diagnostic (#5307). No files-transport row changes. (Plan review, settled after the answered round — the spec's `## Plan Review Clarifications`: this record covers the gh search only; the MCP path's silent drop of an unreadable dependency is a separate ledger follow-up, not part of this task.)
- Project skill `skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 8: compare the exit status, the files each side writes, and the reported line kinds the criterion names (`Warning:`).
- `failGh` is bound in `tests/bin-lib/dispatch/queue-pull.test.js` only at line 4143 (`const { failGh } = require('./queue-pull-fixtures');`). The new in-process tests go at the end of the file, below that line. Do not add a second binding.
- Every commit message ends, after a blank line, with `Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb`.
- Worktree shell constraint for any dispatched agent: one plain command per Bash call, no `&&` / `;` / `$(...)` / heredoc / loop; literal absolute paths, double-quoted.

## Review Focus

1. Cache-check search fails, write-back search succeeds: the `used` Warning prints and the blob IS written. Pinned by the oracle row `F-depfresh` (warm, P1): its cache-check argv is `DEP_SEARCH_PIPELINE_HIT` (`#8000 #8001`) and its write-back argv is `DEP_SEARCH_PIPELINE` (`#8000 #8001 #0`).
2. Write-back skip state is reset per pull: the fence sets `DEP_FRESH_FAIL=` immediately before the write-back search, the module initializes `depFreshFailed: false` in its state object. A shell that inherited `DEP_FRESH_FAIL` from its environment must not skip the write-back.
3. A failed search that printed partial stdout: the session file is `[]`, never the partial text (fence: the `{ echo '[]' > …; … }` branch; module: `r.ok ? r.stdout : '[]'`, unchanged).
4. The files oracle rewrite: each site's substituted line is anchored on that site's exact new line text (the two lines now differ), and both still become the agent's write — pinned by the existing files rows staying green and the `dispatch-dep-freshness.json` agent-write count (test line 3118) staying 2.
5. One Warning per failed search, never a `queue-pull: …` step diagnostic beside it: `ghRun(…, { quiet: true })` already suppresses it; the in-process tests pin the exact Warning list.

---

### Task 1: Warn on a failed dep-freshness search and skip the write-back after one, in module and fence

**Review risk:** high — it gates the queue-order cache write-back and edits a fence at five bytes of headroom.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`fetchDepFreshness` and its comment, 267-273; state object, after line 354; `runFetch` 511; `runWriteBack` 758 and the guard block 764-765)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (line 94; comment 111-114; comment 259; lines 267-269; guard 272; comment 283-286)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`filesOracleScript`'s dependency-freshness loop, 132-137)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`FAULTS`: add `F-depfresh-writeback` after `F-depfresh`, line 639)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new in-process tests at end of file; `FAULT_EXPECT` 3501 and a new row; header comment 49)

**Interfaces:**
- Produces: `fetchDepFreshness(ctx, numbersCsv, file, consequence) -> boolean` (`true` when the search succeeded; `consequence` is `'used'` or `'written'`); `ctx.state.depFreshFailed` (boolean, set only by `runWriteBack`); fence shell variable `DEP_FRESH_FAIL` (set to `1` only by a failed write-back search, reset immediately before it).

- [ ] **Step 1: Write the failing tests.** Append to the end of `tests/bin-lib/dispatch/queue-pull.test.js` (below line 4143, so `failGh` is bound; `pull`, `S1`, `DEP_SEARCH_8000` and `HIT_MESSAGE` (line 768) are file-level):

```js
// ---- #5310: a failed dependency-freshness search warns, once per failed search -------------------
const depWarnings = (r) => r.stderr.split('\n').filter((l) => l.startsWith('Warning: dependency-freshness'));

test('AC1.1 (#5310): a failed dep-freshness search on a warm cache prints the line naming it and recomputes rather than cache-hitting', () => {
  const miss = pull(S1());
  const blob = miss.store.written[0].blob;
  const r = pull(failGh(S1(), DEP_SEARCH_8000), { persisted: blob });
  assert.equal(r.state.cacheHit, false);
  assert.ok(!r.stderr.includes(HIT_MESSAGE));
  assert.deepEqual(r.json('dispatch-groups.json'), miss.json('dispatch-groups.json'), 'the recompute reaches the miss\'s groups');
  // S1's write-back searches the same #8000, so it fails too: one line per failed search, in order.
  assert.deepEqual(depWarnings(r), [DEP_FRESH_USED, DEP_FRESH_WRITTEN]);
  assert.equal(r.store.written.length, 0, 'no blob persisted over the incomplete signal');
  assert.ok(!/queue-pull: /.test(r.stderr), 'no step diagnostic beside the Warnings');
});

test('#5310: a failed write-back dep-freshness search warns once and persists no queue-order blob', () => {
  const r = pull(failGh(S1(), DEP_SEARCH_8000));
  assert.deepEqual(depWarnings(r), [DEP_FRESH_WRITTEN]);
  assert.equal(r.store.written.length, 0);
  assert.ok(!/queue-pull: /.test(r.stderr), 'no step diagnostic beside the Warning');
});

test('#5310 control: the same pulls with the search answered print no dep-freshness Warning and persist the blob', () => {
  const r = pull(S1());
  assert.deepEqual(depWarnings(r), []);
  assert.equal(r.store.written.length, 1);
});
```

Then the parity rows:
  - Declare the two Warning constants once, after `NEAR_DUP` (line 3480), above `FAULT_EXPECT`, so both the rows and the appended tests read them:
    `const DEP_FRESH_USED = 'Warning: dependency-freshness search failed — queue-order cache not used this run';`
    `const DEP_FRESH_WRITTEN = 'Warning: dependency-freshness search failed — queue-order cache not written this run';`
  - `FAULT_EXPECT['F-depfresh']` (line 3501) becomes `{ status: 0, stderr: [DEP_FRESH_USED], drops: [] }`.
  - Add after it `'F-depfresh-writeback': { status: 0, stderr: [DEP_FRESH_WRITTEN], drops: [], blob: null },` with a one-line comment: `// #5310: the cold write-back search fails; no blob on either side.`
  - In `tests/bin-lib/dispatch/queue-pull-fixtures.js` `FAULTS`, after the `F-depfresh` row (line 639): `{ id: 'F-depfresh-writeback', pass: 'write-back', scenario: () => failGh(P1(), DEP_SEARCH_PIPELINE) },` (cold; base `S1-gh-miss`; `pass: 'write-back'` matches `F-writeback`'s at line 699). `DEP_SEARCH_PIPELINE` is already defined at line 330.
  - Header comment line 49: `//   - The silent fail-opens (ledger row 6) are F-prview and F-openprs. F-depfresh and F-depfresh-writeback print one Warning per failed search since #5310.`

- [ ] **Step 2: Run the new in-process tests to verify they fail**

Run: `node --test --test-name-pattern "5310" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL — `depWarnings(r)` is `[]` and `store.written.length` is 1.

- [ ] **Step 3: Implement the module side** in `plugin/bin/lib/dispatch/queue-pull.js`:
  - `fetchDepFreshness(ctx, numbersCsv, file, consequence)`: unchanged search and `put`; on `!r.ok` also `ctx.deps.stderr(\`Warning: dependency-freshness search failed — queue-order cache not ${consequence} this run\n\`)`; `return r.ok;`. Replace its two-line comment (267-268) with: `// The \`gh issue list --search "#a #b" --state all ...\` dependency-freshness fetch (fence: the cache check and the write-back): a failure writes [] and prints one Warning naming the consequence (#5310).` (wrapped to the file's width).
  - State object, after line 354: `depFreshFailed: false, // #5310: the write-back's dependency-freshness search failed; nothing is written back`.
  - `runFetch` line 511: `if (onGh) fetchDepFreshness(ctx, depNumbers, depFile, 'used'); // its [] is always a miss: the numbers are the persisted signal's extra issues`.
  - `runWriteBack` line 758: `if (onGh) state.depFreshFailed = !fetchDepFreshness(ctx, allDeps, depFile, 'written');` (the `files` branch unchanged), and after line 765 add `if (state.depFreshFailed) return; // #5310: nor a freshness signal missing its dependencies`.

- [ ] **Step 4: Implement the fence side** in `plugin/skills/dispatch/queue-pull-script.md`. Run `wc -c` first (expect 52495).
  - Line 94 becomes (two-space indent kept):
    `  gh issue list --search "$(echo "$DISPATCH_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS"; echo "Warning: dependency-freshness search failed — queue-order cache not used this run" >&2; }`
  - Lines 111-114 (the four-line `persisted.excluded` comment) become one line: `  // persisted.excluded keeps the disk cache's {number, blockedBy}[] shape; convert to reason:'blocked' entries here.`
  - Line 259 becomes: `# #1571: write-back, cache-miss path only; best-effort (AC5). #5309-#5311: skipped after a fail-closed verdict or a failed dependency search.`
  - Insert `DEP_FRESH_FAIL=` as its own line immediately before line 267 (`echo '[]' > "$DISPATCH_DEP_FRESHNESS"`).
  - Line 269 becomes:
    `  gh issue list --search "$(echo "$DISPATCH_ALL_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS"; DEP_FRESH_FAIL=1; echo "Warning: dependency-freshness search failed — queue-order cache not written this run" >&2; }`
  - Line 272 becomes `if [ -z "$NATIVE_UNREADABLE$DEP_UNREADABLE$DEP_FRESH_FAIL" ]; then`.
  - Lines 283-286 (the four-line `excluded` comment) become one line: `  // The disk cache keeps its pre-#1752 {number, blockedBy}[] 'excluded' shape: reshape the 'blocked' entries here.`
  - Neither trimmed comment is pinned by a test: `grep -rn -F "at the one place the two" tests` and `grep -rn -F "session-scoped file, rather than" tests` both return nothing at HEAD.
  - Run `wc -c plugin/skills/dispatch/queue-pull-script.md` and quote it; it must be ≤ 52500.

- [ ] **Step 5: Update the files oracle** in `tests/bin-lib/dispatch/queue-pull-oracle.js` `filesOracleScript` (132-137): the two sites' lines now differ, so iterate over `[['DISPATCH_DEP_NUMBERS', 'used', ''], ['DISPATCH_ALL_DEP_NUMBERS', 'written', ' DEP_FRESH_FAIL=1;']]` and anchor each `first` on that site's exact new line from Step 4 (template: `` `  gh issue list --search "$(echo "$${v}" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS";${flag} echo "Warning: dependency-freshness search failed — queue-order cache not ${consequence} this run" >&2; }` ``), `holds: 'gh issue list --search'`, replacement unchanged. The test at `queue-pull.test.js:3118` (`'both dependency-freshness searches'`, count 2) stays as it is and must still pass.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (runs the bash oracle — slow; large timeout), then every other test file that reads the fence (`grep -rl -F queue-pull-script tests`), each with `node --test {file}`, and the rail test (`grep -rl RAIL_BYTES tests`).
Expected: PASS, every file. Quote the raw `# pass` / `# fail` summary lines. `F-depfresh-writeback` must appear among the `AC4.1 [...]` test names.

Proof(medium-risk): the warm `AC1.1 (#5310)` test and the `F-depfresh` / `F-depfresh-writeback` oracle rows pin the Warning per failed search, the recompute and the absent blob on both sides; reverting Step 3's `depFreshFailed` return turns `#5310: a failed write-back …` red (`store.written.length` 1), and reverting the fence guard to `"$NATIVE_UNREADABLE$DEP_UNREADABLE"` turns `AC4.1 [F-depfresh-writeback]` red (the oracle writes a blob).

- [ ] **Step 7: Prove discrimination by reverting.** Temporarily remove Step 3's `if (state.depFreshFailed) return;` and run `node --test --test-name-pattern "5310" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Temporarily change the fence guard back to `"$NATIVE_UNREADABLE$DEP_UNREADABLE"` and run `node --test --test-name-pattern "F-depfresh-writeback" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Quote both red lines. Confirm `git diff` shows both restored.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Warn once per failed dep-freshness search and skip the queue-order write-back after one (refs #5310)"
```
