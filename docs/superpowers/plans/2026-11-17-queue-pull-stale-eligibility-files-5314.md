# Queue pull never reuses an earlier pull's eligibility files (#5314) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the queue-order cache-miss path, remove the four per-session eligibility files before this pull computes them, in the module and the retained fence, so a failed or empty fetch can never hand an earlier pull's eligible set to grouping or to the queue-order write-back; and never use the cache when the auto:build queue is empty, so a `[]` queue cannot hit on an earlier pull's groups.

**Architecture:** One `rm` step at the start of the miss path's eligibility computation, in `runBlocked` (module) and right before the eligible-pre-dep node block (fence). A pull whose eligibility step then fails reads no file and stops at the existing group-building check, as a fresh session already does, so the write-back (which runs after grouping) never persists groups this pull did not compute. The D1 parity row flips from "reproduces the stale reuse" to that stop, and gains a third pull proving the cache does not hit on the earlier groups.

**Tech Stack:** Node 18+ CommonJS, `node --test`, bash parity oracle (bash 4+).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5314/work/5314-spec.md`

Scope keywords: dispatch-eligible-pre-dep.json, dispatch-eligible.json, D1Second

## Premise re-derivation (record text predates this branch)

- The record's "a later queue fetch returns empty" is, in its own D1 fixture (`queue-pull-fixtures.js` `D1Second`), the **open-numbers** fetch failing (exit 1, no stdout) while the queue fetch succeeds. At HEAD: `runBlocked`'s `eligible-pre-dep` step throws on the empty open-numbers file and writes nothing; `blocked-body` and the grouping block then read the first pull's `dispatch-eligible-pre-dep.json` / `dispatch-eligible.json`, the pull exits 0, and `runWriteBack` persists those groups under the second pull's freshness signal. The fence does the same (its node blocks throw, the shell continues). No earlier record on this branch changed this: the D1 test (`queue-pull.test.js`, `#5227 D1: ...reuses the first pull's eligible files`) still asserts the reuse.
- Corrected outcome for D1 (a **failed** fetch): the same stop a fresh session already takes — `dispatch: queue-pull stopped -- group-building exclusion pass failed (exit 1); see error above.`, fence exit 1, CLI exit 4 (R4 mapping), no eligibility file from the earlier pull, no write-back. This matches the established posture recorded in the test header ("A failed queue or open-numbers fetch stops the pull at the group-building check"). AC1's "empty eligible set and exit 0" is read as a genuinely empty queue (`[]`). On a cache miss that already yields an empty eligible set and exit 0 (eligibility files are rewritten as `[]`). **Plan-review settlement (converged round, Reading A):** after a non-empty pull that persisted a blob, a `[]` queue re-fetches every persisted signal issue as dependency-only (queue-pull.js `dep-numbers`, fence 79-96), so `buildFreshnessSignal` rebuilds the persisted signal and `cacheUsable` hits on the earlier pull's groups — AC1 fails on the hit path. Fix: an empty auto:build queue never uses the cache (module `runFetch`'s cache check, fence line 109's `cacheUsable` condition). Turning a failed open-numbers fetch into exit 0 would be a fail-open change no record asks for.
- **Decision (plan review, 2026-11-17, user):** Reading B — a failed open-numbers fetch stops the pull at the group-building check (fence exit 1, CLI exit 4), with no eligibility file from the earlier pull and no cache write-back; it is never read as "no open issues". AC1 is read as a well-formed empty (`[]`) queue fetch after a non-empty pull yielding an empty eligible set and exit 0 with no earlier `dispatch-eligible*.json` content. Recorded in the record body and the re-materialized spec (d2fb985461). This plan already implemented Reading B; no task changes beyond the plan-review low row below.
- Scope boundary with #5409 (later in this run): #5409 covers every other step whose output a later pass reads. This plan touches only the four eligibility outputs the miss path computes (`dispatch-eligible-pre-dep.json`, `dispatch-unresolved-deps.json`, `dispatch-eligible.json`, `dispatch-blocked-excluded-body.json`). `dispatch-groups.json` is already truncated by the grouping block before it reads (fence `>` redirect, module `fs.writeFileSync(..., '')`), and `dispatch-native-deps.json` is already reset to `{}` every pull.

## Global Constraints

- Module first, fence mirrored (queue-pull.js header): "Fix a defect here and mirror the change into the fence, never the other way round." Stop and Warning texts match the fence byte for byte.
- R6: "A throw inside a step is caught and printed to stderr as `queue-pull: <step>: <message>`, and the run then continues or stops exactly where the fence has an RC check". The new removal is a `step(...)` in the module; in the fence it is a plain `rm -f` (cannot fail the run).
- Fence size rail: `plugin/skills/dispatch/queue-pull-script.md` is 52,451 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). The additions (the two-line rm block, about +124 bytes with the short comment below, and the 21-byte `!autoBuild.length || ` guard) are paid for by condensing the three-line `#2066` comment inside the CACHE_HIT node block (file lines 121-123, 213 bytes → one line of about 67), which restates line 91's placeholder comment; keep its one instruction-bearing fact (a blob from before the field has no `bundles` key, so `[]`). Expected result about 52,490. If `wc -c` still comes out over 52,500, the one further sanctioned source is line 111's comment (`persisted.excluded keeps the disk cache's {number, blockedBy}[] shape; convert to reason:'blocked' entries here.`), condensed keeping both facts (the disk shape, the conversion to `reason: 'blocked'`). Never cut a clause that tells the reader what to do. Final `wc -c` must be ≤ 52,500 and is quoted in the commit body.
- Fence line citations: queue-pull.js cites fence file lines as `fence NNN` / `Fence NNN-MMM`. The layout below keeps every line from 147 on at its current number (−2 lines at 121-123, +2 lines before 147). Re-anchor every citation that names a line in 124-146, and set `runBlocked`'s header citation to start at the new rm line (`Fence 145-207`). At HEAD the one citation in that range is `runFetch`'s header (queue-pull.js line 479, `Fence 68-139, then line 143 and the policy reads of 144-146`), which becomes `Fence 68-137, then line 141 and the policy reads of 142-144`. Grep `fence [0-9]` / `Fence [0-9]` in queue-pull.js after the edit and check each cited line still holds what the comment says.
- Whole-fence parity oracle (`.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 8): "Compare the exit status, the files each side writes, and the reported line kinds the criterion names... Add a guard that fails when the port prints a step diagnostic where the reference's stderr shows no error". The D1 row keeps `assertClean` and compares both sides.
- `failGh` is bound in `queue-pull.test.js` only at line 4205 (`const { failGh } = require('./queue-pull-fixtures');`, HEAD 31afe52ab); a new test using it goes after that line. (`D1Second` is imported at the top and may be used anywhere.)
- Shell constraint for every agent: one plain command per Bash call — no `&&`/`;` chains, no `cd ... &&`, no heredoc, no loop, no `$(...)`, no shell variable that must survive to the next call. Use `git -C "<worktree>"` and absolute paths.
- Test runs: targeted files in the foreground with an explicit timeout (a backgrounded run can wait ~45 minutes behind another worktree's suite slot). Quote raw command output for every pass/fail claim.
- Commit messages: `{Verb} {what} — {detail} (refs #5314)`, then a blank line and `Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb`.
- Scope and edit discipline (CLAUDE.md Working Approach, verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

Proof(risk-medium): the D1 parity row runs fence and module over the same three-pull session and fails at HEAD (reverted fix); an in-process module test fails the same way without bash.

## Review Focus

1. Cache-hit path: a hit never reads eligibility files, so the removal belongs on the miss path only; a hit must keep its current output byte for byte (existing AC1/cache-hit parity rows stay green).
2. `files` transport: the four removed paths are session files on both transports (the agent's inputs are `--open-numbers`, `--verified-open-deps` etc., never these four) — the existing files-transport parity rows stay green.
3. `omit: ['blocked']`: `blocked-body`'s skip branch still reads `dispatch-eligible-pre-dep.json` this pull wrote; the removal runs before `eligible-pre-dep`, so omit runs are unchanged (existing omit tests stay green).
4. Genuinely empty queue (`[]`) after a non-empty pull: eligibility files become `[]`, exit 0 — covered by Task 1's in-process test's control assertion.
5. A failed removal (permission): `step()` prints `queue-pull: rm-eligibility: <msg>` and the run continues; the later reads then see whatever is there — the same R6 posture as every other write step. No test (the fence's `rm -f` has no failure branch either).

---

### Task 1: Remove the eligibility files at the start of the miss path, module and fence; flip D1

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`runBlocked`, its header comment at ~562-563; fence citations in 124-146 if any)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (lines 121-123 condensed; two lines inserted before the eligible-pre-dep `node ... <<NODE_EVAL_EOF` block at line 147)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (header bullet lines 28-30; the fixtures import at line 74 gains `D1Third` beside `D1Second` (plan-review low row); `runD1` ~3682; D1 test ~3948; the `fault pool` diagnostic's "D1 (4 runs)" text ~3734; one new in-process test after line 4205)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (comment at 764-765; new `D1Third` export)
- Modify: `tests/bin-lib/dispatch/queue-pull-shims.test.js` (import `D1Third` at line 17 and add `D1Third()` beside `D1Second()` in the scenario list at line 485, so the new oracle scenario's shim table is round-tripped like every other)
- Scope-keyword hits, no change (Check B): `docs/plans/2026-11-15-spec-...-ledger.md` and `docs/superpowers/plans/2026-11-16-queue-pull-native-blockers-fail-closed-5309.md` are earlier records' historical artifacts that name these files; they describe past state and are not edited.

**Interfaces:**
- Produces: `D1Third()` in `queue-pull-fixtures.js` — S1 with #9003 retitled exactly as `D1Second` does (title `'Retitled after the first pull'`, updatedAt `'2026-11-12T11:00:00Z'`) and every fetch healthy. Factor the retitle into one local helper both use; export `D1Third` beside `D1Second`.
- Produces: `runD1()` returns `{ first, second, third }`, each `{ oracle, module }`.
- Produces: `EmptyAfterS1()` in `queue-pull-fixtures.js` (exported beside `D1Third`), and `runEmptyAfterS1()` returning `{ first, second }`, registered in the fault pool as job `EmptyAfterS1`.
- Review Focus 1 still holds for a non-empty queue: a hit keeps its output byte for byte; only an empty queue skips the cache.

- [ ] **Step 1: Write the failing tests**

(a) Replace the D1 test (`#5227 D1: a second pull ... reuses the first pull's eligible files, both sides`) with:

```js
test('#5314 D1 (AC1.1, AC2.1): a second pull whose open-numbers fetch fails reads no earlier pull\'s eligibility file and stops at group-building; a third pull does not hit the cache on the first pull\'s groups', () => {
  const { first, second, third } = R.D1;
  for (const [label, pair] of [['D1 first', first], ['D1 second', second], ['D1 third', third]]) assertClean(pair, label);
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  const mapped = stopMapped(second.oracle, second.module); // fence exit 1, CLI exit 4
  assertParity(second.oracle, mapped, { files: AC1_FILES });
  for (const [side] of sides(second)) {
    const one = first[side]; const two = second[side]; const three = third[side];
    assert.equal(one.status, 0, side);
    assert.ok(reported(two.stderr).includes(`${head}1${tail}`), `${side}: the group-building stop`);
    assert.equal(two.files['dispatch-open-numbers.json'], '', `${side}: the second open-numbers fetch returned nothing`);
    for (const name of ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json']) {
      assert.notEqual(one.files[name], null, `${side} first: ${name} written`);
      assert.equal(two.files[name], null, `${side}: no ${name} from the first pull`);
    }
    assert.equal(two.files['dispatch-groups.json'], '', `${side}: groups truncated, never the first pull's`);
    assert.deepEqual(two.orderBlob, one.orderBlob, `${side}: no write-back after the stop`);
    // AC2: a third, healthy pull over the second pull's queue misses the cache and groups the new record.
    assert.equal(three.status, 0, `${side} third: ${three.stderr.slice(-2000)}`);
    assert.ok(!three.stderr.includes(HIT_MESSAGE), `${side} third: no cache hit on the first pull's groups`);
    const title9003 = (groups) => groups.flat().find((c) => c.number === 9003).title;
    assert.equal(title9003(JSON.parse(three.files['dispatch-groups.json'])), 'Retitled after the first pull', `${side} third: this pull's record`);
    assert.equal(title9003(three.orderBlob.groups), 'Retitled after the first pull', `${side} third: the blob holds this pull's groups`);
  }
  assertParity(third.oracle, third.module, { files: AC1_FILES });
});
```

Use the names already in scope (`AC1_FILES`, `reported`, `HIT_MESSAGE`, `GROUPING_STOP_RE`, `stopMapped`, `assertParity`); if `assertParity` on the second pair rejects a difference that is a documented normalization (TAIL_LINES), drop to the `assertFaultFiles` form the old D1 test used and say so in the report — never loosen `assertParity` itself.

(b) `runD1`: after the second pull, `for (const sb of made) sb.setScenario(D1Third());` and a third `both()`; return `{ first, second, third }`. Update the pool diagnostic text `D1 (4 runs)` to `D1 (6 runs)`.

(c) New in-process test after the `failGh` binding (line 4205), so it runs without bash:

```js
test('#5314 (AC1.1): a module pull whose open-numbers read fails removes an earlier pull\'s eligibility files and stops at group-building with no write-back; a [] queue still exits clean', () => {
  const STALE = JSON.stringify([{ number: 1, title: 'stale', labels: [], body: '' }]);
  const names = ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json'];
  const seed = (ctx) => { for (const n of names) fs.writeFileSync(ctx.paths[n], STALE); };
  const r = pull(failGh(S1(), OPEN_NUMBERS_ARGV), { allowThrow: true, before: seed });
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  assert.equal(r.thrown.line, `${head}1${tail}`);
  for (const n of names) assert.equal(r.text[n], undefined, `${n} removed`);
  assert.equal(r.store.written.length, 0, 'no write-back');
  // Control: a well-formed empty queue after the same seed is an empty eligible set and no stop.
  const empty = pull(SEmpty(), { before: seed });
  assert.equal(empty.thrown, null, String(empty.thrown));
  assert.equal(empty.text['dispatch-eligible.json'], '[]');
});
```

(d) Plan-review settlement (Reading A), the hit path of AC1. Add a fixture `EmptyAfterS1()` in `queue-pull-fixtures.js` (exported, imported into both test files, added to `queue-pull-shims.test.js`'s scenario list like `D1Third`): SEmpty's queue and open-numbers answers, plus an answer to the dependency-freshness search the second pull makes over the first pull's persisted signal issues (`gh issue list --search "#… #…" --state all --json number,updatedAt,state --limit 500`), returning every one of them with S1's own `number`/`updatedAt`/`state` unchanged — derive the search argv from what the first pull actually persisted (S1's signal issues), not by hand-guessing. At HEAD this second pull must be a cache hit (its stderr carries `HIT_MESSAGE`), which is what makes the row discriminating; if it is not a hit at HEAD, the fixture is wrong — fix the fixture, never the assertion. Add a job beside D1 in the fault pool (`runEmptyAfterS1`, same shape as `runD1`: two sandboxes, `tmp: 'one-session'`, S1 then `EmptyAfterS1()`; clean both up in the same `after`, and count its runs in the pool diagnostic), and one test:

```js
test('#5314 (AC1.1, cache hit path): a [] queue after a non-empty pull that persisted a blob never reuses its groups — empty eligible set, exit 0, both sides', () => {
  const { first, second } = R.EmptyAfterS1;
  for (const [label, pair] of [['first', first], ['second', second]]) assertClean(pair, label);
  assertParity(second.oracle, second.module, { files: AC1_FILES });
  for (const [side] of sides(second)) {
    assert.equal(first[side].status, 0, side);
    assert.ok(first[side].orderBlob && first[side].orderBlob.groups.flat().length > 0, `${side}: the first pull persisted non-empty groups`);
    const two = second[side];
    assert.equal(two.status, 0, `${side}: ${two.stderr.slice(-2000)}`);
    assert.ok(!two.stderr.includes(HIT_MESSAGE), `${side}: no cache hit on the earlier pull's groups`);
    assert.deepEqual(JSON.parse(two.files['dispatch-groups.json']), [], `${side}: empty groups`);
    assert.equal(two.files['dispatch-eligible.json'], '[]', `${side}: empty eligible set, nothing from the earlier pull`);
  }
});
```

Adapt helper names to what is in scope (as for (a)); keep every assertion. Also extend test (c) with a module-only in-process twin: seed the fake queue-order store with a blob holding S1's groups and a freshness signal the `[]` pull's dependency-freshness answer reproduces, run `pull(SEmpty-with-that-search-answer)`, and assert `thrown === null`, `dispatch-eligible.json` is `'[]'` and `dispatch-groups.json` is `'[]'` (red at HEAD: the groups come back from the blob).

Check `pull`'s real option and result names (`allowThrow`, `before`, `text`, `store.written`, `thrown`) against the tests at ~1468-1500 and `SEmpty`'s shape before relying on them; adapt names, not assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="5314" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 900000)
Expected: FAIL after Step 1 — (c) sees `r.thrown` undefined (exit-0 reuse); (a) sees status 0 on the second pull and the first pull's files. If the bash oracle is skipped on this host, (a) is skipped: say so and rely on the controller's oracle re-run.

- [ ] **Step 3: Implement**

Module, `runBlocked`, miss path, immediately before `step(ctx, 'eligible-pre-dep', ...)`:

```js
// #5314 (fence 145-146): this pull's eligibility files are computed below; an earlier pull's
// never stand in for them when a read below fails, so a failed step stops at group-building.
step(ctx, 'rm-eligibility', () => {
  for (const name of ELIGIBILITY_FILES) fs.rmSync(paths[name], { force: true });
});
```

with `const ELIGIBILITY_FILES = ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json'];` next to `NATIVE_UNREADABLE`. Update `runBlocked`'s header comment to `Fence 145-207 on a miss (the removal of an earlier pull's eligibility files, the eligible list, ...)`.

Fence: replace lines 121-123 with one line `  // #2066: a blob from before the field has no 'bundles' key: [].` (or shorter, same fact), and insert before the `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_ELIGIBLE_PRE_DEP" ...` line:

```bash
# #5314: no earlier pull's eligibility files.
rm -f "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS" "$DISPATCH_ELIGIBLE" "$DISPATCH_BLOCKED_EXCLUDED_BODY"
```

Empty-queue cache guard (plan-review settlement, Reading A). Fence line 109: `if (!autoBuild.length || !cacheUsable(persisted, current, ...)) { console.log('0'); process.exit(0); }` — in place, no line added. Module `runFetch`, the cache check at ~523: use the persisted blob only when the queue file holds at least one record (`if (persisted && readArray(queueFile).length > 0)`, or the equivalent with the module's own helpers), with a one-line `// #5314 (fence 109): an empty queue never reuses the earlier pull's groups.` comment. The dependency-freshness search before it is unchanged (a wasted call on an empty queue, kept so the fence and the module make the same calls).

Then: `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52,500; confirm the inserted `rm` sits on file lines 145-146 and the eligible-pre-dep `node` line is still line 147; re-anchor queue-pull.js citations per Global Constraints.

Test header (queue-pull.test.js 28-30): replace the D1 bullet with "D1 (a second pull in one session whose open-numbers fetch fails) reused the first pull's eligibility files and wrote its groups back under the new freshness signal; fixed by #5314: the miss path removes them first, so the pull stops at group-building as a fresh session does." Fixtures comment 764-765: describe D1 as three pulls (healthy, failed open-numbers, healthy retitled).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 1200000)
Expected: PASS, 0 failures (whole file: the cache-hit, files-transport and omit rows are the Review Focus 1-3 controls). Then `node --test tests/skill-size-single-source.test.js tests/bin-lib/dispatch/queue-pull-shims.test.js` (foreground, timeout 600000), PASS.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull-shims.test.js
git -C "<worktree>" commit -m "Remove an earlier pull's eligibility files before the miss path computes them — failed fetch stops, no stale write-back (refs #5314)" -m "queue-pull-script.md: {wc -c} bytes" -m "Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb"
```

(One `git` command per Bash call.)

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 (empty fetch clears the earlier eligibility/group files) | Task 1 Step 3 (rm step; groups already truncated) |
| Deliverable 2 (write-back never records groups this pull did not compute) | Task 1 (stop precedes write-back; test (a) `orderBlob` unchanged, test (c) `store.written` empty) |
| Deliverable 3 (D1 expectation flips) | Task 1 Step 1 (a) |
| AC1.1 | Tests (a) and (c), incl. the `[]` queue control; test (d) and (c)'s in-process twin for the cache-hit path (plan-review settlement) |
| AC2.1 | Test (a) third pull |
