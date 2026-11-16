# Queue pull: a failed cross-PR open-PR list fails open with no Warning (#5312) Implementation Plan

> Written 2026-11-16 against HEAD ed8c9d7b0 (after #5304-#5311 landed on this branch and origin/main was merged in at dd3be7125e). Every line reference below is from that HEAD. The record's text predates all of them; its claims were re-derived: the fetch is still silent at both sites (module `queue-pull.js:1220-1221`, fence `queue-pull-script.md:625`), and the existing in-process test at `queue-pull.test.js:2427-2430` pins the silence.

**Goal:** A failed `gh pr list --state open --json number,files,closingIssuesReferences --limit 100` (the cross-PR overlap report's open-PR list) prints one `Warning:` line naming that fetch and its consequence, so an empty overlap report on that run no longer reads as a clean "no overlap". Module and fence, parity kept.

**Architecture:** The fetch runs once, in `runCrossPrOverlap` (module `plugin/bin/lib/dispatch/queue-pull.js:1211-1236`: `ghRun(ctx, OPEN_PRS_ARGV, { quiet: true })` then `put(ctx, prsFile, r.ok ? r.stdout : '[]\n')`) and at fence `plugin/skills/dispatch/queue-pull-script.md:625` (`... > "$DISPATCH_OPEN_PRS" 2>/dev/null || echo '[]' > "$DISPATCH_OPEN_PRS"`). Both keep the `[]` fallback (the report stays informational and never blocks) and add the Warning on the failure branch. The fence change follows #5310's inline shape (`2>/dev/null || { echo '[]' > FILE; echo "Warning: ..." >&2; }`, fence line 94), so no new session file or err file is needed. `--transport files` is unchanged: it makes no gh call and writes `[]` (mcp-transport.md's documented gap).

**Tech Stack:** Node 18+ module, bash fence, `node --test` with the bash parity oracle (`tests/bin-lib/dispatch/queue-pull-oracle.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5312/work/5312-spec.md` (materialized from GitHub issue #5312)

Scope keywords: OPEN_PRS_ARGV, DISPATCH_OPEN_PRS

## Global Constraints

- Fix both module and fence, and keep the parity row: #5230 is CLOSED but #5231 (remove the fence) is OPEN, so the spec's rule applies ("if the fence … has not been removed by #5231 when this lands, fix both and keep the parity row").
- `plugin/skills/dispatch/queue-pull-script.md` is 52,444 bytes at HEAD; the rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`) is 52,500 (56 bytes headroom). The finished file must be `wc -c` ≤ 52,500. The fence line change adds about 90 bytes, so Step 4 trims restatement in the comment above it (lines 621-624). Trim restatement only; never a clause that tells the reader what to do. Quote `wc -c` before and after.
- **The fence's line count must not change** (queue-pull.js cites fence lines as `fence NNN` in about 25 comments; earlier reviews on this branch raised stale ones). Line 625 stays one line; the comment stays four lines. Confirm with `wc -l` before and after (equal).
- The Warning text, both sides, byte for byte (the dash is U+2014, as in every other queue-pull Warning):
  `Warning: open-PR pull failed — cross-PR overlap not checked this run`
- Project skill `skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 8: compare the exit status, the files each side writes, and the reported line kinds the criterion names (`Warning:`).
- `failGh` is bound in `tests/bin-lib/dispatch/queue-pull.test.js` only at line 4150. This plan adds no test that needs it (the in-process test edited below uses `withGh`, already bound at the top).
- Every commit message ends, after a blank line, with `Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb`.
- Worktree shell constraint for any dispatched agent: one plain command per Bash call, no `&&` / `;` / `$(...)` / heredoc / loop; literal absolute paths, double-quoted.

## Review Focus

1. A failed fetch that printed partial stdout: the session file is still `[]\n` (module `r.ok ? r.stdout : '[]\n'`, unchanged; fence `{ echo '[]' > …; … }` branch), and the overlap file is `[]`.
2. Exactly one Warning, never a `queue-pull: …` step diagnostic beside it (`ghRun(…, { quiet: true })` already suppresses it).
3. The Warning prints before the `open-pr-count` step, the same position on both sides (fence: in the `||` branch on line 625, before line 626's count).
4. The files oracle (`filesOracleScript`, `queue-pull-oracle.js:150-154`) anchors on line 625's exact new text; the files rows stay green.
5. The cap Warning (100 PRs) and the success path print no new line.

---

### Task 1: Warn on a failed cross-PR open-PR list, in module and fence

**Review risk:** medium — it edits a fence at 56 bytes of headroom and a parity row.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (constants after line 1206; comment 1208-1210; `runCrossPrOverlap` 1220-1221)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (comment 621-624; line 625)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`filesOracleScript`'s cross-PR anchor, line 151)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (the `#5227 cross-PR` test 2415-2441; a new constant after `OPEN_PR_CAP` at 2085; `FAULT_EXPECT['F-openprs']` 3528; header comment 49)

**Interfaces:**
- Produces: module constant `OPEN_PR_FAIL_WARNING` (the Warning text above, no trailing newline), placed beside `OPEN_PR_CAP_WARNING`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/queue-pull.test.js`:
  - After `const OPEN_PR_CAP = …` (line 2085) add `const OPEN_PR_FAIL = 'Warning: open-PR pull failed — cross-PR overlap not checked this run';`.
  - In the `#5227 cross-PR` test (2415): rename it to `'#5227 cross-PR: gh pr list feeds detectCrossPRFileOverlap; a failure writes [] and prints one Warning naming the fetch (#5312); files writes [] with no gh call; 100 PRs print the cap Warning'`, and replace line 2430 (the `the failure is silent` assertion) with:
    ```js
    // AC1 (#5312): the failed list prints one line naming the fetch, and no step diagnostic beside it.
    assert.deepEqual(failed.stderr.split('\n').filter((l) => l.startsWith('Warning:')), [OPEN_PR_FAIL]);
    assert.ok(!/queue-pull:/.test(failed.stderr), `no step diagnostic: ${failed.stderr}`);
    ```
    and add one control assertion after the success-path block (after line 2421): `assert.ok(!r.stderr.includes(OPEN_PR_FAIL), 'a successful list prints no failure Warning');`.
  - Add a fence pin next to the other fence-text pins (beside the `LINKED_WARNING` equality at 1642 is fine, or inside the edited test): `assert.ok(fenceText(/echo "(Warning: open-PR pull failed[^"]*)" >&2/) === OPEN_PR_FAIL, 'the fence prints the same Warning');` — use whatever form `fenceText` returns (read its definition first; `LINKED_WARNING` at 1563 shows the capture-group usage).
  - `FAULT_EXPECT['F-openprs']` (line 3528) becomes `{ status: 0, stderr: [OPEN_PR_FAIL], drops: [] },` with a one-line comment above it: `// #5312: the failed open-PR list warns on both sides; the overlap file is still [].`
  - Header comment line 49: `//   - The silent fail-open (ledger row 6) is F-prview; F-openprs warns since #5312. F-depfresh, F-depfresh-writeback` (keep line 50 as it is, so the sentence still reads).

- [ ] **Step 2: Run the edited test to verify it fails**

Run: `node --test --test-name-pattern "5227 cross-PR" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL — the Warning list is `[]`.

- [ ] **Step 3: Implement the module side** in `plugin/bin/lib/dispatch/queue-pull.js`:
  - After `OPEN_PR_CAP_WARNING` (line 1206) add `// fence 625's failure branch, byte for byte (#5312)` and `const OPEN_PR_FAIL_WARNING = 'Warning: open-PR pull failed — cross-PR overlap not checked this run';`.
  - Comment 1208-1210: replace "On `gh` the open-PR fetch fails silently (`2>/dev/null || echo '[]'`)" with "On `gh` a failed open-PR fetch writes [] and prints one Warning (#5312)", keeping the rest of the sentence ("and a compute failure is a step error the fence does not stop on") and the fence citation `Fence 621-642`.
  - After line 1221 (`put(ctx, prsFile, r.ok ? r.stdout : '[]\n');`) add `if (!r.ok) deps.stderr(\`${OPEN_PR_FAIL_WARNING}\n\`);`.
  - No `fence NNN` citation moves (the fence's line count is unchanged); confirm with `grep -n "fence 6[2-5][0-9]\|Fence 6[2-5][0-9]" plugin/bin/lib/dispatch/queue-pull.js` that each still points at the line it names.

- [ ] **Step 4: Implement the fence side** in `plugin/skills/dispatch/queue-pull-script.md`. Run `wc -c` and `wc -l` first (expect 52444 bytes).
  - Line 625 becomes:
    `gh pr list --state open --json number,files,closingIssuesReferences --limit 100 > "$DISPATCH_OPEN_PRS" 2>/dev/null || { echo '[]' > "$DISPATCH_OPEN_PRS"; echo "Warning: open-PR pull failed — cross-PR overlap not checked this run" >&2; }`
  - Line 624 drops its trailing restatement: `# truncation posture as the queue pulls (queue-pull-notes.md), one informational signal among several.` becomes `# truncation posture as the queue pulls (queue-pull-notes.md).` If the file is still over 52,500, also drop ` (AC2)` from line 622 (a bare criterion id with no file named). Neither phrase is pinned by a test (`grep -rn -F "one informational signal among several" tests` returns nothing at HEAD).
  - Run `wc -c` and `wc -l` and quote both; bytes ≤ 52500, lines unchanged.

- [ ] **Step 5: Update the files oracle** in `tests/bin-lib/dispatch/queue-pull-oracle.js`: `filesOracleScript`'s cross-PR `replaceSpan` `first:` (line 151) becomes line 625's exact new text from Step 4 (as a JS string; mind the single quotes around `[]`). `through`, `holds` and the replacement are unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (runs the bash oracle — slow; large timeout), then every other test file that reads the fence (`grep -rl -F queue-pull-script tests`), each with `node --test {file}`, and the rail test (`grep -rl RAIL_BYTES tests`).
Expected: PASS, every file. Quote the raw `# pass` / `# fail` summary lines. `F-openprs` must appear among the `AC4.1 [...]` test names and pass.

Proof(medium-risk): the edited `#5227 cross-PR` test and the `F-openprs` oracle row pin the Warning on both sides; reverting Step 3's `if (!r.ok) deps.stderr(...)` turns the in-process test and `AC4.1 [F-openprs]` red, and reverting fence line 625 turns `AC4.1 [F-openprs]` red from the oracle side.

- [ ] **Step 7: Prove discrimination by reverting.** Temporarily remove Step 3's `if (!r.ok) …` line and run `node --test --test-name-pattern "5227 cross-PR|F-openprs" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Temporarily restore fence line 625's old `|| echo '[]' > "$DISPATCH_OPEN_PRS"` tail (and the oracle anchor with it) and run `node --test --test-name-pattern "F-openprs" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Quote both red lines. Confirm `git diff` shows both restored.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Warn when the cross-PR overlap report's open-PR list fails, in module and fence (refs #5312)"
```

---

## Self-review

- **Spec coverage:** Deliverable (Warning on a failed list; the overlap pass no longer reads as clean) — Steps 3-4; AC1 (a line naming the fetch) — Step 1's assertions and the `F-openprs` row.
- **Placeholders:** none.
