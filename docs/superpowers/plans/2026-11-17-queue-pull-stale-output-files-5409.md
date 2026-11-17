# Queue-pull stale output files (#5409) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No pass of dispatch's queue pull, and no reader after it, reads an earlier pull's copy of a session file because a step of this pull threw before writing its own copy.

**Architecture:** #5314 already removes the four eligibility files before the miss path computes them (module step `rm-eligibility`, `ELIGIBILITY_FILES` in `plugin/bin/lib/dispatch/queue-pull.js`; fence `rm -f` at `plugin/skills/dispatch/queue-pull-script.md` lines 145-146). Every other session file is truncated by its writer before anything can throw (a `>` redirect, `echo '[]' >`, `: >`, or the module's `put` of a placeholder), except five that a node block or module step writes only at its very end. This plan removes those five at the start of every pull — the module's `truncate` pass and the fence line before the exclusions truncation — so a throwing step leaves the file absent rather than stale. The per-file evidence is the `Spec Step 2 already-shipped assessment` line in `spec-5409/decisions.md`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, bash (the retained fence and its bash parity oracle).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5409/work/5409-spec.md`

## Global Constraints

- The five files, by their `session-tmp-resolve.js --value` names: `dispatch-named-targets.json`, `dispatch-shipped-probe-prs.json`, `dispatch-shipped-releases.json`, `dispatch-crosspr-overlap.json`, `dispatch-near-dup-pairs.json`. No other file joins the set: the agent-written inputs of the `files` transport (`dispatch-queue-raw.json`, `dispatch-dep-freshness.json`, `dispatch-open-numbers.json`, `dispatch-verified-open-deps.txt`, `dispatch-in-flight-raw.json`, `dispatch-in-flight-claims.json`) default to their session paths and must survive pull start, and `dispatch-exclusions.json` carries the `firing` entries across pulls by design.
- Module first, fence mirrored (queue-pull.js header: "Fix a defect here and mirror the change into the fence, never the other way round").
- `plugin/skills/dispatch/queue-pull-script.md` is 52,463 bytes against the 52,500 rail (37 bytes headroom). It must stay at or under 52,500 bytes (`wc -c`), and its line count must stay 656 so the ~25 `fence NNN` / `Fence NNN-MMM` anchors in queue-pull.js stay true. Bytes beyond the headroom are paid for only by cutting restatement — never a clause that tells the reader what to do or gives a reason stated nowhere else.
- Run several test files only through `node tools/run-tests.js <files>`, foreground, with an explicit timeout (a bare multi-file `node --test` is refused by the repo guard).
- Commit subjects `{Verb} {what} — {detail} (refs #5409)`; every message ends with a blank line then `Claude-Session: https://claude.ai/code/session_017vXcAca6S95v2DPFXT9xCt`.

## Review Focus

1. A pull with a pass omitted (`omit`, test-only): the omitted pass's file is now absent rather than an earlier pull's — the existing `#5230 near-dup` control (queue-pull.test.js ~line 3110) asserted the earlier copy survives and must be updated, not deleted (Task 1 Step 4).
2. A session path that is a directory (`queue-pull.test.js` ~line 1900 makes `dispatch-named-targets.json` one): `rmSync({ force: true })` throws on a directory, so its removal prints one `queue-pull: rm-end-written: ...` line and the pull goes on to the target-missing stop exactly as before (`errs.some(...)` still holds). Each file is removed in its own `step` call, like `rm -f`, which goes on to its next operand after one fails: one loop inside a single step would stop at the directory (the first name) and leave the other four files stale. Task 1's fixture pins this (its directory case), and Task 1 Step 4 re-runs the `#5227` test.
3. A pull whose target-missing probe now finds no named-targets file (named-targets threw): the probe's `readJson` fails (ENOENT) and the pull stops with the existing target-missing stop line (exit 4 through the CLI) — never a probe over an earlier pull's records. No new code; it falls out of the removal. Not separately pinned: the read-failure stop itself is pinned by `#5227 target-missing and shipped stops` (an unreadable file, the directory case), and the absent file reaches the same `readJson` throw and the same `if (!probe.ok)` stop; no test makes the named-targets compute itself throw, since it reads only `dispatch-groups.json`, which every earlier pass needs too.
4. The `files` transport: none of the five is an agent input, so the removal never deletes an agent-written file. The conformance test of Task 2 pins the exact set, and the parity files run both transports.
5. The fence and the module removing different sets (drift). Task 2's conformance test derives the fence's set from its own `rm -f` line and `--value` assignments and compares it with the module's exported constant.
6. The readers after the pull: an absent file now means "no data from this pull". `cross-pr-overlap-report.md` renders nothing, `near-duplicate-pairs.md` and `drain-pr-overlap.md` find no pairs, and `driver-route.md` already passes `--near-dup-pairs` only when the pull wrote the file (`plugin/bin/lib/driver/merge.js` holds on an unreadable one, so the route must not pass an absent path). Task 3 states this in the three reader files.

---

### Task 1: Remove the five end-written files at pull start (module) and the fixture

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (constant beside `ELIGIBILITY_FILES` ~line 550 or beside `SESSION_FILES`; `runTruncate` ~lines 175-185; `module.exports` ~line 1443)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new test after the `#5314 (AC1.1)` test ~line 3224; update the `#5230 near-dup` control ~line 3110)

**Interfaces:**
- Produces: `END_WRITTEN_FILES` — a frozen array of the five `--value` names above, exported from `queue-pull.js` beside `SESSION_FILES`. Task 2 reads it.

- [ ] **Step 1: Write the failing test** `#5409 (AC1, AC2): a pull whose cross-pr-overlap step throws leaves no earlier pull's dispatch-crosspr-overlap.json; the five end-written files are this pull's or absent`

```js
test('#5409 (AC1, AC2): a pull whose cross-pr-overlap step throws leaves no earlier pull\'s dispatch-crosspr-overlap.json; the five end-written files are this pull\'s or absent', () => {
  const STALE = '"an earlier pull\'s copy"';
  const seed = (ctx) => { for (const n of END_WRITTEN_FILES) fs.writeFileSync(ctx.paths[n], STALE); };
  // `{}` is valid JSON but no PR list: the compute's `.map` throws before its write.
  const r = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: '{}\n' }), { before: seed });
  assert.equal(r.thrown, null, String(r.thrown)); // the pull completes (exit 0): the reader after it is cross-pr-overlap-report.md
  assert.ok(r.errs.some((e) => e.startsWith('queue-pull: cross-pr-overlap: ')), r.stderr);
  assert.equal(r.text['dispatch-crosspr-overlap.json'], undefined, 'no earlier pull\'s overlap report');
  for (const n of END_WRITTEN_FILES) assert.notEqual(r.text[n], STALE, `${n}: this pull's or absent`);
  // Control: the same seed and a healthy pull — every file the pull writes is rewritten by this pull.
  const healthy = pull5(PIPE(), { before: seed });
  assert.equal(healthy.thrown, null, String(healthy.thrown));
  assert.ok(Array.isArray(JSON.parse(healthy.text['dispatch-crosspr-overlap.json'])), 'a list this pull computed');
  // One removal failing (a directory at the first name) does not stop the other four (rm -f's per-operand behaviour).
  const dirFirst = pull5(PIPE(), {
    allowThrow: true,
    before: (ctx) => { seed(ctx); fs.rmSync(ctx.paths['dispatch-named-targets.json']); fs.mkdirSync(ctx.paths['dispatch-named-targets.json']); },
  });
  assert.ok(dirFirst.errs.some((e) => e.startsWith('queue-pull: rm-end-written: ')), dirFirst.stderr);
  for (const n of END_WRITTEN_FILES.filter((x) => x !== 'dispatch-named-targets.json')) assert.notEqual(dirFirst.text[n], STALE, `${n}: removed although an earlier removal failed`);
});
```

Import `END_WRITTEN_FILES` from the module in the file's existing `require('../../../plugin/bin/lib/dispatch/queue-pull')` destructuring. If `PIPE()` has no `OPEN_PRS_ARGV` entry (withGh is then a no-op and the `errs` assertion fails), use the scenario the `#5312` open-PR tests (~line 2291-2302) use.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "#5409" tests/bin-lib/dispatch/queue-pull.test.js` (timeout 600000)
Expected: FAIL after Step 1 — first on the `END_WRITTEN_FILES` import (undefined → TypeError in `seed`). After adding only the constant and its export (no removal step), re-run: FAIL on `'no earlier pull\'s overlap report'` (the seeded copy survives). Quote that second failure.

- [ ] **Step 3: Implement the removal in `runTruncate(ctx)`**

Before the exclusions truncation, one `step` per file: `for (const name of END_WRITTEN_FILES) step(ctx, 'rm-end-written', () => fs.rmSync(ctx.paths[name], { force: true }));` — never one loop inside a single step, which would stop at its first failure where `rm -f` goes on to its next operand (Review Focus 2). Comment it as `// #5409 (fence 44): ...` with the reason in one sentence: each of these files is written only at the end of its step, so a step that throws first would leave an earlier pull's copy for the pass or reader after it; the agent inputs and the exclusions file are not in the set. Update `runTruncate`'s header comment from `Fence lines 46-51.` to cover line 44 too.

- [ ] **Step 4: Update the near-dup control and run the module suite**

In `#5230 near-dup` (~line 3105-3111): the omitted run's assertion becomes `assert.equal(pull5(S1(), { before: seed, omit: ['near-dup-pairs'] }).text['dispatch-near-dup-pairs.json'], undefined)` with its comment saying the pull removes the earlier copy at its start (#5409) and an omitted pass writes nothing, so the `'[]'` above is the pass's. Keep the test's name.

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (timeout 900000)
Expected: PASS, 0 failures (the `#5227 target-missing and shipped stops` test ~line 1897 included).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -F <message-file>   # "Remove the queue pull's five end-written session files at pull start — a step that throws before its write no longer leaves an earlier pull's copy (refs #5409)"
```

### Task 2: Mirror into the fence within the byte rail, and pin the two sets equal

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — line 44 (today blank), line 8 (prose), line 242 (a node comment inside the grouping block)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new conformance test beside the Task 1 test)

**Interfaces:**
- Consumes: `END_WRITTEN_FILES` (Task 1), the test file's `FENCE` (the extracted fence text).

- [ ] **Step 1: Write the failing test** `#5409: the fence's pull-start rm -f removes exactly the module's END_WRITTEN_FILES, before the exclusions truncation`

Assertions: find the fence line that starts `rm -f ` and ends `# #5409: no earlier pull's copy`; map each `"$DISPATCH_X"` on it to its file through the fence's own `DISPATCH_X="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value NAME)"` assignment lines; `assert.deepEqual(names.sort(), [...END_WRITTEN_FILES].sort())`. Ordering, numerically, over `const lines = FENCE.split('\n')`: `rmIdx` = the rm line's index, `lastAssign` = the greatest index of a `session-tmp-resolve.js --value` assignment line, `truncIdx` = the index of the `# #1752: truncate dispatch-exclusions.json` line; each `findIndex` result is asserted `>= 0` first, then `assert.ok(lastAssign < rmIdx && rmIdx < truncIdx, \`last assignment ${lastAssign} < rm ${rmIdx} < truncation ${truncIdx}\`)` (every variable it names is assigned before it, and it runs before any pass).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "#5409" tests/bin-lib/dispatch/queue-pull.test.js` (timeout 600000)
Expected: FAIL after Step 1 — no such line in the fence.

- [ ] **Step 3: Edit the fence**

Replace blank line 44 (so the line count stays 656) with exactly:

```bash
rm -f "$DISPATCH_NAMED_TARGETS" "$DISPATCH_SHIPPED_PROBE_PRS" "$DISPATCH_SHIPPED_RELEASES" "$DISPATCH_CROSSPR_OVERLAP" "$DISPATCH_NEAR_DUP_PAIRS" # #5409: no earlier pull's copy
```

Pay for the bytes beyond the 37 of headroom with two restatement cuts, both within their own line:
- Line 8: replace ` — no bypass: a spec-shape failure is not a risk anyone can accept, since \`/flow\`'s own Materialization gate would stop the named record anyway, after a claim and a spent retry attempt.` with `, with no \`#N\` bypass (\`not-spec-shaped-exclusion-report.md\` says why).` — the instruction ("no bypass") stays on the line; the reason the cut drops is stated in full in `not-spec-shaped-exclusion-report.md` lines 25-29 ("There is no bypass: naming the record directly does not restore it, because `/flow`'s own Materialization gate would stop it anyway, after a claim and a spent retry attempt … not a risk anyone can accept"), and again in `queue-pull-notes.md` line 33 (the retry-ceiling and `auto:merge` consequence, "with no `#N`/`#N,#M,...` bypass") and `SKILL.md` line 148 ("no bypass, unlike Oversized").
- Line 242: `  // Size guard (#1228): flagged, never removed from DISPATCH_GROUPS; only the ranking script excludes it.` becomes `  // Size guard (#1228): flagged, never removed from DISPATCH_GROUPS.` — line 6 of the same file states that only bare drain's auto-selection (the ranking script) excludes an oversized group.

Run: `wc -c plugin/skills/dispatch/queue-pull-script.md` and `wc -l plugin/skills/dispatch/queue-pull-script.md`
Expected: bytes ≤ 52500; lines 656. If over, stop and report the number — do not cut any other sentence.

- [ ] **Step 4: Run the conformance test, the module suite, the parity files and the rail test**

Run: `node tools/run-tests.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js tests/bin-lib/dispatch/queue-pull-parity-d1.test.js tests/bin-lib/skill-audit/budgets.test.js tests/skill-size-single-source.test.js` (foreground, timeout 1200000)
Expected: every file passes, 0 failures; quote the runner's summary lines.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull.test.js
git commit -F <message-file>   # "Mirror the pull-start removal of the five end-written files into the retained fence — paid for by two restatement cuts, line count unchanged (refs #5409)"
```

### Task 3: Say in the three readers that an absent file means no data

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/cross-pr-overlap-report.md` (line 15-17, "Read `dispatch-crosspr-overlap.json` … Non-empty: render one line per entry")
- Modify: `plugin/skills/dispatch/near-duplicate-pairs.md` (lines 13-14, "rewritten by every queue pull")
- Modify: `plugin/skills/dispatch/drain-pr-overlap.md` (line 55, the `dispatch-near-dup-pairs.json` argument)

- [ ] **Step 1: Edit the three files**

Edit each in place, rewrapping only the lines touched:
- `cross-pr-overlap-report.md`: between the closing `detectCrossPRFileOverlap\`).` of the Read sentence and `Non-empty:` insert the sentence `Absent (the pull removes it at its start and a failed overlap step writes none, #5409) or empty: render nothing.`
- `near-duplicate-pairs.md` step 1: the words `rewritten by every queue pull` become `removed at the start of every queue pull and rewritten by its near-dup-pairs pass, so it is absent when that pass failed or was omitted (#5409)`. Step 4 already omits the step on an absent file.
- `drain-pr-overlap.md`: the parenthetical `(\`queue-pull-script.md\`'s output, strong pairs only)` gains `; read an absent file as \`[]\`, no pairs from this pull (#5409)` before its closing parenthesis.

- [ ] **Step 2: Run the dispatch prose suites**

Run: `node tools/run-tests.js` over every `tests/**/*.test.js` file that reads any of the three files (find them with `git grep -l -F -e cross-pr-overlap-report.md -e near-duplicate-pairs.md -e drain-pr-overlap.md -- tests`), foreground, timeout 1200000.
Expected: 0 failures; quote the summary.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/cross-pr-overlap-report.md plugin/skills/dispatch/near-duplicate-pairs.md plugin/skills/dispatch/drain-pr-overlap.md
git commit -F <message-file>   # "State in dispatch's three session-file readers that an absent file is no data — the queue pull now removes it at its start (refs #5409)"
```

## Proofs

- AC1.1 (eligible-pre-dep throws on a second pull): already holds at HEAD by #5314 — the `#5314 (AC1.1)` module test (~line 3201) and the D1 parity test pin it; reverting #5409 cannot turn them red, so the AC2 fixture targets cross-pr-overlap, a step #5409 itself fixes.
- AC2.1: Task 1 Step 2's second failure, and a revert-to-red of Task 1's `runTruncate` step re-run by the dispatcher in a `git archive` extract.
- AC3.1: the run's `verify.js` / PR CI.
