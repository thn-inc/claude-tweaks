# Queue pull: a failed dep-freshness search fails open with no Warning (#5310) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed dependency-freshness search (`gh issue list --search "#a #b" --state all ...`) prints one `Warning:` line naming that search, the pull never takes a queue-order cache hit on it, and a pull whose write-back search failed persists no queue-order blob — in the module and in the fence, byte-identical.

**Architecture:** The search runs at two sites: the cache check (`runFetch`, fence lines 94-100, over the persisted signal's dependency-only numbers) and the write-back (`runWriteBack`, fence lines 270-274, over every eligible record's dependencies). Both write `[]` on failure with stderr dropped and nothing printed. At the cache check that `[]` already forces a miss (`signalsMatch` compares issue counts, and the numbers searched are exactly the persisted signal's dependency-only issues), so the fix there is the Warning. At the write-back the `[]` is persisted as a freshness signal with the dependencies missing, and the next pull then searches nothing and hits the cache with no dependency ever re-checked — so the write-back is skipped after a failed search, like #5309's skip after a failed native read.

**Tech Stack:** Node 18+ (`plugin/bin/lib/dispatch/queue-pull.js`), bash fence (`plugin/skills/dispatch/queue-pull-script.md`), `node --test` with the bash parity oracle (`tests/bin-lib/dispatch/queue-pull-oracle.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5310/work/5310-spec.md` (materialized from GitHub issue #5310)

Scope keywords: fetchDepFreshness

## Global Constraints

- Fix both module and fence and keep the parity row: #5230 is CLOSED (dispatch runs the CLI) but #5231 (remove the fence) is OPEN, so the spec's rule applies — "if the fence (`plugin/skills/dispatch/queue-pull-script.md`) has not been removed by #5231 when this lands, fix both and keep the parity row."
- `plugin/skills/dispatch/queue-pull-script.md` is exactly 52,500 bytes and `RAIL_BYTES` is 52,500: zero headroom. The finished file must be `wc -c` ≤ 52,500. Quote the `wc -c` output before and after in the report.
- The Warning text, both sides, byte for byte: `Warning: dependency-freshness search failed — queue-order cache not used this run` at the cache check, `Warning: dependency-freshness search failed — queue-order cache not written this run` at the write-back (the em dash is U+2014, as in every other queue-pull Warning).
- `--transport files` is unchanged: there the agent's file stands where the search stands, and a missing or non-array file already prints its own diagnostic (#5307). No files-transport fault row changes.
- Project skill `skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 8, verbatim: "**Compare what the acceptance criterion names, and guard the rest.** Compare the exit status, the files each side writes, and the reported line kinds the criterion names (`AUTO`, `Warning:`). A comparison built only from what the reference prints hides everything extra the port prints."
- Every commit message ends, after a blank line, with `Claude-Session: https://claude.ai/code/session_01X7gPF9Z767qUj2FDCYWeFV`.
- Worktree shell constraint for any dispatched agent: one plain command per Bash call, no `&&`/`;`/`$(...)`/heredoc/loop; literal absolute paths.

## Review Focus

1. A pull whose cache-check search fails and whose write-back search succeeds: the cache-check Warning prints, and the blob IS written (the write-back's own search is complete). Pinned by the gh fault row `F-depfresh` (warm), whose write-back search argv differs from its cache-check one.
2. A pull with no dependencies at the write-back after a failed cache-check search: the write-back must not inherit the earlier failure. The fence's `DEP_FAIL` is reset on every `dep_freshness` call, and the call runs even when the number list is empty.
3. A failed search that printed partial stdout before failing: the session file is `[]`, never the partial text (fence: the `|| { echo '[]' ... }` branch; module: `r.ok ? r.stdout : '[]'`, unchanged).
4. The `files` oracle rewrite: the substituted agent-write line now lives once, inside `dep_freshness`, and must still run at both call sites — pinned by the existing files matrix rows staying green.
5. A Warning printed twice on one site, or `step()`'s `queue-pull: …` diagnostic printed beside it — the parity guard (`assertParity`'s `queue-pull:` check) catches the second; the in-process test pins the exact list of Warning lines.

---

### Task 1: Warn on a failed dep-freshness search and skip the write-back after one, in module and fence

**Review risk:** high — it gates the queue-order cache write-back and edits the fence at zero byte headroom.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`fetchDepFreshness` ~266-272 and its comment; `runFetch` ~508-511; `runWriteBack` ~719-738)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (fence lines 57-70 region: add `dep_freshness()` after `alias_mcp_timestamps()`; lines 94-100 and 262-275: call it; line 667's MCP-path sentence; comment trims for bytes)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`filesOracleScript`'s dependency-freshness substitution, ~132-137)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`FAULTS`: add `F-depfresh-writeback` after `F-depfresh`)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new in-process tests; `FAULT_EXPECT` rows; the `both dependency-freshness searches` count at ~3049; header comment ~50)

**Interfaces:**
- Produces: `fetchDepFreshness(ctx, numbersCsv, file, consequence) -> boolean` (`true` when the search succeeded; `consequence` is `'used'` or `'written'`); `ctx.state.depFreshnessFailed` (boolean, set by `runWriteBack` only); fence function `dep_freshness NUMBERS_CSV CONSEQUENCE`, which sets `DEP_FAIL=1` on a failed search and `DEP_FAIL=` otherwise.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/queue-pull.test.js` (in-process, beside the other `#5227 cache hit:` tests; `failGh` and `DEP_SEARCH_8000` come from `./queue-pull-fixtures`):

```js
const DEP_FRESH_USED = 'Warning: dependency-freshness search failed — queue-order cache not used this run';
const DEP_FRESH_WRITTEN = 'Warning: dependency-freshness search failed — queue-order cache not written this run';
const depWarnings = (r) => r.stderr.split('\n').filter((l) => l.startsWith('Warning: dependency-freshness'));

test('AC1.1 (#5310): a failed dep-freshness search on a warm cache prints the line naming it and recomputes rather than cache-hitting', () => {
  const miss = pull(S1());
  const blob = miss.store.written[0].blob;
  const r = pull(failGh(S1(), DEP_SEARCH_8000), { persisted: blob });
  assert.equal(r.state.cacheHit, false);
  assert.ok(!r.stderr.includes(HIT_MESSAGE));
  assert.deepEqual(r.json('dispatch-groups.json'), miss.json('dispatch-groups.json'), 'the recompute reaches the miss\'s groups');
  // S1's write-back searches the same #8000, so it fails too: both sites, in order.
  assert.deepEqual(depWarnings(r), [DEP_FRESH_USED, DEP_FRESH_WRITTEN]);
  assert.equal(r.store.written.length, 0, 'no blob persisted over the incomplete signal');
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

Use whatever name the file already gives the cache-hit message constant (`HIT_MESSAGE` is used at ~3614; if it is not in scope at the insertion point, compare against the module's `CACHE_HIT_MESSAGE` text). Then the parity rows:
  - `FAULT_EXPECT['F-depfresh']` becomes `{ status: 0, stderr: [DEP_FRESH_USED], drops: [] }` (warm; its write-back searches `#8000 #8001 #0`, which still answers, so the blob is written).
  - Add `FAULT_EXPECT['F-depfresh-writeback'] = { status: 0, stderr: [DEP_FRESH_WRITTEN], drops: [], blob: null }`.
  - In `queue-pull-fixtures.js` `FAULTS`, after `F-depfresh`: `{ id: 'F-depfresh-writeback', pass: 'write-back', scenario: () => failGh(P1(), DEP_SEARCH_PIPELINE) }` (cold; base `S1-gh-miss`). Confirm `F-writeback`'s own `pass` value is `'write-back'` and match it.
  - Header comment ~line 50: F-depfresh is no longer a silent fail-open — reword to name F-depview, F-prview and F-openprs as the silent ones and say F-depfresh / F-depfresh-writeback print one Warning since #5310.

- [ ] **Step 2: Run the new in-process tests to verify they fail**

Run: `node --test --test-name-pattern "5310" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL — `depWarnings(r)` is `[]` and `store.written.length` is 1.

- [ ] **Step 3: Implement the module side** in `plugin/bin/lib/dispatch/queue-pull.js`:
  - `fetchDepFreshness(ctx, numbersCsv, file, consequence) -> boolean`: unchanged search and `put`; on `!r.ok` also `ctx.deps.stderr(...)` the Warning above with `consequence` interpolated, then return `r.ok`. Rewrite its comment (`stderr dropped, any failure writes []`) to say a failure writes `[]` and prints the Warning (#5310).
  - `runFetch`: `fetchDepFreshness(ctx, depNumbers, depFile, 'used')` (return ignored: the `[]` it leaves is always a miss, because the numbers searched are the persisted signal's dependency-only issues and `signalsMatch` compares counts — say so in a one-line comment).
  - `runWriteBack`: `state.depFreshnessFailed = onGh && allDeps ? !fetchDepFreshness(ctx, allDeps, depFile, 'written') : false` (keep the `files` branch calling `agentDepFreshness` as now), and after the existing `nativeUnreadable` return add `if (state.depFreshnessFailed) return; // #5310: a signal missing its dependencies is never persisted`.

- [ ] **Step 4: Implement the fence side** in `plugin/skills/dispatch/queue-pull-script.md` (measure `wc -c` first; it must end ≤ 52,500):
  - After `alias_mcp_timestamps() { … }` (line 70) add, as written (one comment line only):

```bash
# #5310: a failed dependency-freshness search warns; DEP_FAIL skips the write-back ([] already misses the cache check).
dep_freshness() {
DEP_FAIL=
echo '[]' > "$DISPATCH_DEP_FRESHNESS"
if [ -n "$1" ]; then
  gh issue list --search "$(echo "$1" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS"; DEP_FAIL=1; echo "Warning: dependency-freshness search failed — queue-order cache not $2 this run" >&2; }
fi
alias_mcp_timestamps "$DISPATCH_DEP_FRESHNESS"
}
```
  - Lines 94-100 become the two `DISPATCH_FASTLANE_BUNDLES` lines (95-96, unchanged) followed by `dep_freshness "$DISPATCH_DEP_NUMBERS" used`.
  - Lines 270-274 become `dep_freshness "$DISPATCH_ALL_DEP_NUMBERS" written`; line 275 becomes `if [ -z "$NATIVE_UNREADABLE$DEP_FAIL" ]; then`; line 262's comment ends `#5309/#5310: skipped after a failed native read or dependency search.`
  - Line 667's last sentence: `re-run the \`alias_mcp_timestamps() { … }\` and \`dep_freshness() { … }\` definitions at the top of any Bash call that calls either.`
  - If `wc -c` is still over 52,500, cut comment bytes (no test pins them — `git grep -n -F "rather than changing the disk cache" -- tests` and `git grep -n -F "at the one place the two" -- tests` both return nothing): shorten the cache-hit block's four-line `persisted.excluded` comment (lines 115-118) and the write-back block's four-line `excluded` comment (lines 286-289) to one line each, keeping their meaning (the disk cache keeps its pre-#1752 `{number, blockedBy}[]` shape; convert at this boundary).
  - Run `wc -c plugin/skills/dispatch/queue-pull-script.md` and quote it.

- [ ] **Step 5: Update the files oracle** in `tests/bin-lib/dispatch/queue-pull-oracle.js` `filesOracleScript`: replace the two-iteration `for (const v of ['DISPATCH_DEP_NUMBERS', 'DISPATCH_ALL_DEP_NUMBERS'])` loop with one `replaceSpan` whose `first` is the function's `gh issue list --search "$(echo "$1" …` line copied exactly from the fence (two-space indent), `holds: 'gh issue list --search'`, replaced by `` [`  ${agentWrite('dispatch-dep-freshness.json', 'DISPATCH_DEP_FRESHNESS')}`] ``; update the function's header comment ("(b) the dependency-freshness search inside `dep_freshness`"). In `queue-pull.test.js` ~3049 the `both dependency-freshness searches` count becomes `1`, message `the one dependency-freshness search, inside dep_freshness (both call sites)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (runs the bash oracle — slow; large timeout), then every other test file that reads the fence: `git grep -l -F queue-pull-script -- tests`, each with `node --test {file}`, plus the rail test (`git grep -l RAIL_BYTES -- tests`).
Expected: PASS, every file. Quote the raw `# pass` / `# fail` summary lines. The fault pool must show `F-depfresh-writeback` run on both sides with `blob: null`.

Proof(medium-risk): the warm `AC1.1 (#5310)` test and the `F-depfresh` / `F-depfresh-writeback` oracle rows pin the Warning, the recompute and the absent blob on both sides; reverting Step 3's write-back return turns `#5310: a failed write-back …` red (`store.written.length` 1), and reverting the fence's `$DEP_FAIL` guard turns `F-depfresh-writeback` red (`blob: null` on the oracle side).

- [ ] **Step 7: Prove discrimination by reverting.** Temporarily revert Step 3's `if (state.depFreshnessFailed) return;` and run `node --test --test-name-pattern "5310" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Temporarily change the fence's `"$NATIVE_UNREADABLE$DEP_FAIL"` back to `"$NATIVE_UNREADABLE"` and run the fault-pool tests (`--test-name-pattern "AC4"`) — FAIL on `F-depfresh-writeback`; restore. Quote both red lines.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Warn on a failed dep-freshness search and skip the queue-order write-back after one (refs #5310)"
```
