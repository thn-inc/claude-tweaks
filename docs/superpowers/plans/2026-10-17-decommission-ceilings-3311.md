# Decommission the Old Skill-Size Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every skill-size number other than the Read-limit rail: `CEILING_BYTES` and its warning tier, the composed ceiling and its exception map, the description ceilings, `merge-size-probe`, `bloat.js`'s ceiling signal, and every per-file byte pin in `tests/`. Then add a durable test that stops them coming back.

**Architecture:**
- Consumers go first, then the exports they read. Deleting an export a test destructures would turn `bytes <= CEILING_BYTES` into `bytes <= undefined`, which silently evaluates `false` for some comparison shapes.
- Order: `bloat.js` (Task 1) and `merge-size-probe` (Task 2) drop their imports. The per-file test pins go (Task 3). Then `context-cost.js` loses the exports (Task 4). Prose that described the deleted mechanisms is rewritten (Task 5). The anti-scatter guard lands last (Task 6), when the tree it checks is clean.

**Tech Stack:** Node 18+, CommonJS, `node --test`. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3311/work/3311-spec.md`. Its "Boundary amendments" section supersedes the body above it. _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

**Execution:** batched

Task 3 bundles 23 same-shape test-file edits into one dispatch.

## Global Constraints

- `plugin/bin/lib/skill-audit/budgets.js` is the only file in `plugin/` or `tests/` that defines a skill-size number. Its exports `RAIL_BYTES` (52,500), `RAIL_LINES` (2,000) and `DESCRIPTION_MAX_CHARS` (1,536) are untouched.
- The `rail:` suites in `tests/bin-lib/skill-audit/context-cost.test.js` stay unchanged. They are the four tests whose titles start with `rail` (lines 745, 753, 761 and 769 today).
- Keep every content assertion. Remove only the size assertion; delete a test only when the size check was its only assertion, and delete any `require` left unused.
- Non-Goals, verbatim from the spec:
  - `tests/claude-md-budget.test.js` and `tests/design-wrapper-review-surface-gate-prose.test.js`'s 35 KB check stay.
  - `plugin/bin/lib/code-health/scope.js`'s slice byte ceiling stays.
  - `descriptionHashHazard` and `findDescriptionHashHazards` stay.
- History is never rewritten. `docs/incident-log.md`, `docs/decisions/`, `docs/superpowers/`, `docs/plans/` and `.claude-tweaks/` are excluded from every sweep.
- Absence guards stay. A `doesNotMatch` that pins an old name's absence is kept, and AC1's sweep filters such lines (`grep -v doesNotMatch`), per boundary amendment 5.
- Commit style: `{Verb} {what} — {detail} (refs #3311)`. Never write "closes" or "fixes". End every commit message with `Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717`.
- Work only in `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/skill-size-limits-3230`. Start each dispatch with `cd` there, then `pwd` and `git rev-parse --show-toplevel`.

## Review Focus

1. **A comparison silently degrading to `undefined`.** A test that still destructures a deleted export compares against `undefined`. `x > undefined` used as a skip condition evaluates `false` and passes. Task 3 removes every consumer before Task 4 deletes the export. Task 4's Step 5 greps for each deleted name across `tests/` and `plugin/` before its suite run, so a leftover import is caught by name, not by a red test.
2. **A pin hidden behind variables.** A per-file pin whose path, text and byte count sit on three different lines (`terminal-track.test.js:40-45`) is invisible to a per-line grep. Task 6's self-test `rule (b) follows a skill path through variables, literals, and for...of bindings` pins the taint chain and the multi-line `BUDGETS` map shape.
3. **A constant named against the spec's regex.** `PR_FIRST_BYTE_CEILING` ends in `CEILING`, not `_BYTES`. Task 6's rule (a) covers both name orders, and its self-test asserts `const PR_FIRST_BYTE_CEILING = 31304;` goes red.
4. **The guard flagging its own fixtures or message strings.** Comparisons and declarations inside string literals must not count. Task 6's self-test `what the scanner must not flag` covers a comparison inside a message string, a non-skill fixture path, a rail comparison, and a sub-1024 literal.
5. **A composed bundle losing its only gate.** Removing `overComposedCeiling` must leave every compose call site checked against the rail. Task 4 keeps `rail: every compose call site's max composed bytes fit one Read call`, and retargets the unparsed-row test to `composedRailViolations`, so an unparsed call site still fails a gate (Task 4, Step 3).

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 (the deletion grep returns no lines) | Task 6 Step 6 (sweep, `grep -v doesNotMatch`) |
| AC1.2 (history excluded by pathspec; plan-audit's `nearCeiling` key is not a call) | Task 6 Step 6 (the pathspec is the sweep's own; the key survives in `plan-audit/checks.js`, unmatched by `nearCeiling\(`) |
| AC2.1 (`N * 1024` lines in tests that mention skills) | Task 6 Step 6 |
| AC2.2 (unfiltered hits listed with a one-word reason) | Task 6 Step 6 (written to the task report for the PR body) |
| AC3.1 (guard passes, zero unclassified, self-test fixtures go red) | Task 6 Steps 1–4 |
| AC4.1 (60,000 B target prints no `ceiling` line; no `overCeiling`/`headroom` keys) | Task 1 Step 1 |
| AC5.1 (`merge-size-probe.js` gone; no `plugin/skills/**` names it) | Task 2 Steps 2 and 4 |
| AC6.1 (`npm test` passes, run centrally) | the controller's final verification (build Common Step 5) |

---

### Task 1: Drop the ceiling signal from `bloat.js`

**Files:**
- Modify: `plugin/bin/lib/skill-audit/bloat.js` (header lines 3-18, import line 21, `auditText` at 327-337, `auditCorpus` at 345-366, `hasFindings` at 368-374, `formatBloatReport` at 403-408, `bloatReport` comment at 433-441)
- Modify: `plugin/skills/_shared/harness-health-analysis.md:158`
- Modify: `plugin/skills/harness-health/judge-procedure.md:116`
- Test: `tests/bin-lib/skill-audit/bloat.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `auditText(text, { bytes, rowMedian, sizeThreshold })` returns `{ bytes, longRows, provenance, degenerate, sizeOutlier }`, with no `overCeiling` or `headroom`.
  - `auditCorpus(files, { sizeOutlier = true })` returns `{ rowBaseline, rowThreshold, sizeBaseline, files }`, with no `ceiling`.
  - `bloatReport(target, corpus, opts)` accepts only `{ sizeOutlier }`.
  - `bloat.js` no longer requires `context-cost.js` at all. Task 4 depends on this.

- [ ] **Step 1: Write the failing test.** In `tests/bin-lib/skill-audit/bloat.test.js`, replace the whole test `'a 60,000 B skill target scanned with { ceiling: Infinity } prints no soft-ceiling line (#3310 AC3)'` (lines 603-615 today) with:

```js
test('AC4.1: a 60,000 B skill target prints no ceiling line, and per-file objects carry no overCeiling/headroom keys', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bloat-3311-'));
  try {
    const target = path.join(dir, 'big.md');
    fs.writeFileSync(target, `# Big\n\n${'word '.repeat(12000)}`);
    const sibling = path.join(dir, 'small.md');
    fs.writeFileSync(sibling, '# Small\n\ntext\n');
    assert.ok(fs.statSync(target).size >= 60000);
    assert.doesNotMatch(bloatReport(target, [sibling]), /ceiling/);
    for (const entry of auditCorpus([target, sibling]).files) {
      assert.ok(!('overCeiling' in entry), `${entry.file} still carries overCeiling`);
      assert.ok(!('headroom' in entry), `${entry.file} still carries headroom`);
    }
    assert.ok(!('ceiling' in auditCorpus([target, sibling])), 'auditCorpus still returns a ceiling');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the probe to verify the ceiling fields still exist.**

Run: `node -e "const k=Object.keys(require('./plugin/bin/lib/skill-audit/bloat.js').auditText('',{bytes:1}));process.exit(k.includes('overCeiling')||k.includes('headroom')?1:0)"`
Expected: FAIL (exit 1). `auditText` still returns `overCeiling` and `headroom`. The new test in Step 1 also fails: `node --test tests/bin-lib/skill-audit/bloat.test.js` reports `AC4.1` red on the `soft ceiling` report line.

- [ ] **Step 3: Edit `bloat.js`.** Make exactly these edits:
  1. Header line 5: `This module detects the five` becomes `This module detects the four`. Header line 13: `every one of the five has a` becomes `every one of the four has a`.
  2. Delete line 21: `const { CEILING_BYTES } = require('./context-cost.js');`.
  3. `// One file's five signals.` becomes `// One file's four signals.`.
  4. `auditText`'s signature becomes `function auditText(text, { bytes, rowMedian, sizeThreshold } = {}) {`. Delete its two lines `overCeiling: …` and `headroom: …`.
  5. `auditCorpus`'s signature becomes `function auditCorpus(files, { sizeOutlier = true } = {}) {`. Delete the `ceiling,` line from its returned object. The per-file call becomes `...auditText(text, { bytes, rowMedian, sizeThreshold })`.
  6. `hasFindings` starts `return entry.longRows.length > 0` (drop `entry.overCeiling\n    || `).
  7. In `formatBloatReport`, delete the whole `if (entry.overCeiling) { … }` block, including its two comment lines and the `applied` line.
  8. Replace `bloatReport`'s comment paragraphs beginning `// The byte ceiling is the SKILL.md/sub-file rule.` and ending `// their own line budgets.` with:

```js
// The size-outlier signal can be suppressed with `{ sizeOutlier: false }`: a
// rule file or CLAUDE.md already has its own tiered LINE budget in the
// harness-health procedure, so it never joins the skill-size sample. File size
// against the Read limit is the rail's job (`rail.js`, decision 0024), not a
// bloat signal.
```

- [ ] **Step 4: Edit both harness-health bloat-scan call sites.** In `plugin/skills/_shared/harness-health-analysis.md:158` and `plugin/skills/harness-health/judge-procedure.md:116`, replace

```
   const opts = kind === 'skill' ? { ceiling: Infinity } : { ceiling: Infinity, sizeOutlier: false };
```

with

```
   const opts = kind === 'skill' ? {} : { sizeOutlier: false };
```

- [ ] **Step 5: Update the remaining `bloat.test.js` cases** that read the deleted fields:
  1. Delete the test `'auditText reports the ceiling breach and its headroom'` (lines 240-248).
  2. In `'bloatReport reports only the target, dedupes it out of its own corpus, and honours the ceiling opt'` (line 261):
     - Rename it to `'bloatReport reports only the target and dedupes it out of its own corpus'`.
     - Delete its three ceiling lines (285-287: `const withCeiling = …`, the `/over the 10 B soft ceiling/` match, and the `{ ceiling: Infinity }` assertion).
  3. In `'prose signal list names exactly the signals auditText returns'`:
     - Replace the two comment lines beginning `// overCeiling is suppressed` with `// auditText returns four signals plus bytes (#3311 deleted overCeiling/headroom).`.
     - The filter becomes `.filter((k) => k !== 'bytes')`.
  4. In `'both bloat-scan call sites suppress the ceiling signal, and suppress size outliers only for non-skill targets (#3310)'`:
     - Rename it to `'both bloat-scan call sites suppress size outliers only for non-skill targets, and carry no ceiling option (#3311)'`.
     - Its first `assert.match` becomes `assert.match(text, /kind === 'skill' \? \{\} : \{ sizeOutlier: false \}/, \`${label}: bloat call must pick options by kind\`);`.
     - Add `assert.doesNotMatch(text, /ceiling: Infinity/, \`${label}: no ceiling option\`);` right after it.
  5. In `'auditCorpus runs over the whole live skill corpus and reports a usable baseline'`:
     - Delete the `ceiling: acc.ceiling + (f.overCeiling ? 1 : 0),` line.
     - Delete `ceiling: 0, ` from the reducer's initial value.
     - Change the log line `${totals.ceiling} over-ceiling, ${totals.rows} long rows, ` to `${totals.rows} long rows, `.

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `node --test tests/bin-lib/skill-audit/bloat.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS, every test. Then run `node -e "const k=Object.keys(require('./plugin/bin/lib/skill-audit/bloat.js').auditText('',{bytes:1}));process.exit(k.includes('overCeiling')||k.includes('headroom')?1:0)"`. Expected: exit 0.

- [ ] **Step 7: Commit.**

```bash
git add plugin/bin/lib/skill-audit/bloat.js plugin/skills/_shared/harness-health-analysis.md plugin/skills/harness-health/judge-procedure.md tests/bin-lib/skill-audit/bloat.test.js
git commit -F <msgfile>   # "Drop the ceiling signal from bloat.js — four signals, no ceiling option, harness-health calls pass only sizeOutlier (refs #3311)" + the Claude-Session line
```

---

### Task 2: Delete `merge-size-probe`

**Files:**
- Delete: `plugin/bin/merge-size-probe.js`
- Delete: `plugin/bin/lib/merge-size-probe.js`
- Delete: `tests/bin-lib/merge-size-probe.test.js`
- Delete: `tests/merge-size-probe-cli-e2e.test.js`
- Modify: `docs/plugin-structure.md:191` (the CLI row)
- Modify: `tests/bin-lib/wrap-up/pack.test.js:905`

**Interfaces:**
- Consumes: nothing.
- Produces: no file in `plugin/` requires `merge-size-probe.js`. Task 4 relies on its `CEILING_BYTES` import being gone.

- [ ] **Step 1: Convert the absence guard.** `tests/bin-lib/wrap-up/pack.test.js:905` reads `assert.ok(!refresh.includes('merge-size-probe'), 'the pre-merge step no longer runs the probe CLI');`. Change it to `assert.doesNotMatch(refresh, /merge-size-probe/, 'the pre-merge step no longer runs the probe CLI');`, so AC1's `grep -v doesNotMatch` filter treats it as an absence guard (boundary amendment 5).

- [ ] **Step 2: Run the probe to verify the CLI still exists.**

Run: `node -e "process.exit(require('fs').existsSync('plugin/bin/merge-size-probe.js')?1:0)"`
Expected: FAIL (exit 1). The CLI is still on disk.

- [ ] **Step 3: Delete the four files and the docs row.** Run `git rm plugin/bin/merge-size-probe.js plugin/bin/lib/merge-size-probe.js tests/bin-lib/merge-size-probe.test.js tests/merge-size-probe-cli-e2e.test.js`. Then delete the one line in `docs/plugin-structure.md` that begins `node plugin/bin/merge-size-probe.js [--integration-branch <branch>] [--head <ref>]` (line 191 today).

- [ ] **Step 4: Verify.**

Run: `node plugin/bin/merge-size-probe.js`
Expected: exits non-zero with `Cannot find module` (AC5.1).

Run: `git grep -n merge-size-probe -- plugin/skills`
Expected: no output, exit 1 (AC5.1).

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add docs/plugin-structure.md tests/bin-lib/wrap-up/pack.test.js
git commit -F <msgfile>   # "Delete merge-size-probe — CLI, module, both suites and the plugin-structure row; pack.test keeps its absence guard as doesNotMatch (refs #3311)"
```

---

### Task 3: Remove every per-file size pin from `tests/` [batch]

**Files (Modify):**
- `tests/backlog-refine-resolve-lane.test.js`
- `tests/ceremony-derivation-mode-gate.test.js`
- `tests/ceremony-profile-roster.test.js`
- `tests/console-resolve-conformance.test.js`
- `tests/deferral-gate-conformance.test.js`
- `tests/dispatch-graphql-blocked-preflight.test.js`
- `tests/dispatch-named-form-exclusion-reasons.test.js`
- `tests/dispatch-per-record-groups-prose.test.js`
- `tests/dispatch-sequential-execution-conformance.test.js`
- `tests/flow-ledger-creation-timing-conformance.test.js`
- `tests/flow-preflight-conformance.test.js`
- `tests/fork-worktree-isolation-conformance.test.js`
- `tests/merge-subject-composer-conformance.test.js`
- `tests/multispec-preflight-failure-conformance.test.js`
- `tests/review-dispatch-composition.test.js`
- `tests/run-dir-timestamp-utc.test.js`
- `tests/skill-mode-split-conformance.test.js`
- `tests/sweep-backstop.test.js`
- `tests/terminal-track.test.js`
- `tests/timing-prose-conformance.test.js`
- `tests/untrusted-record-content-conformance.test.js`
- `tests/wrap-up-flaky-escalation-row.test.js`
- `tests/wrap-up-pack-conformance.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: no file under `tests/` (other than `tests/bin-lib/skill-audit/context-cost.test.js`, which Task 4 rewrites) imports `CEILING_BYTES`, `COMPOSED_STEP_EXCEPTIONS` or `overComposedCeiling`, or compares a `plugin/skills/**` file's size against a number. Task 4 deletes those exports next. Task 6's guard asserts the result.

The rule for every edit: delete the size assertion line. If that leaves a test with no assertion, delete the whole test (title line through its closing `});`). If that leaves a `CEILING_BYTES`/`composedBytesReport`/`overComposedCeiling` import unused, delete the import. If a test title names the ceiling or a byte budget, rename it to describe what it still checks.

- [ ] **Step 1: Run the probe to verify the pins exist.**

Run: `node -e "const fs=require('fs');const re=/CEILING_BYTES|PR_FIRST_BYTE_CEILING|STUB_CEILING_BYTES|overComposedCeiling|COMPOSED_STEP_EXCEPTIONS|BUDGETS = \{|<= 40893|<= 3072|bytes < 8000|bytes < 8192|<= 6144|< 20480|<= 28 \* 1024/;const hits=fs.readdirSync('tests').filter((f)=>f.endsWith('.test.js')&&re.test(fs.readFileSync('tests/'+f,'utf8').split('\n').filter((l)=>!/doesNotMatch/.test(l)).join('\n')));console.log(hits.join('\n'));process.exit(hits.length?1:0)"`
Expected: FAIL (exit 1), listing the files below.

- [ ] **Step 2: Apply the edits, one row per file** (line numbers as of HEAD `d63367ebc`):

| File | Edit |
|---|---|
| `backlog-refine-resolve-lane.test.js` | Delete the test `'refine-mode.md stays under the per-file ceiling after the #1887 additions'` (137-140), the comment line above it `// --- (7) refine-mode.md stays under the per-file lazy-load ceiling ---`, and the `CEILING_BYTES` import (line 14). |
| `ceremony-derivation-mode-gate.test.js` | Delete line 82 (`assert.ok(Buffer.byteLength(text, 'utf8') <= CEILING_BYTES);`) and the import at line 12. |
| `ceremony-profile-roster.test.js` | Delete the test `'every touched skill file stays under the byte ceiling (#1926 AC7)'` (88-93) and the import at line 12. |
| `console-resolve-conformance.test.js` | Delete the five `<= CEILING_BYTES` lines (24, 30, 36, 46, 96) and the import at line 10. Delete the test `'wrap-up/SKILL.md did not grow past its pre-#1932 size (#1932 AC7)'` (53-55, the `<= 40893` pin). Rename the test at line 12 so its title drops its trailing size clause: cut from `, and stays under t…` to the end of the title string. |
| `deferral-gate-conformance.test.js` | Delete line 192 (`<= 3072`). Rename the test at 190 to `'refused-proposals.md never hardcodes the vocabulary'`. |
| `dispatch-graphql-blocked-preflight.test.js` | Delete line 25 and the import at line 9. Rename the test at 23 to drop its `and stays under the context-cost c…` clause. |
| `dispatch-named-form-exclusion-reasons.test.js` | Delete lines 123-124 (`const bytes = …` and its `assert.ok(bytes < CEILING_BYTES …)`) and the import at line 19. Rename the test at 114 to drop its `, within the byte cei…` clause. |
| `dispatch-per-record-groups-prose.test.js` | Delete the test `'AC9.1: dispatch SKILL.md and queue-pull-script.md stay within CEILING_BYTES'` (57-62) and the import at line 15. If `QUEUE_PULL` is now unused, delete its declaration too. |
| `dispatch-sequential-execution-conformance.test.js` | Delete line 32 and the import at line 10. |
| `flow-ledger-creation-timing-conformance.test.js` | Delete the test `'multi-spec.md stays under its 20,480-byte raw budget'` (112-115). If `SKILLS` or `fs` becomes unused, delete it. |
| `flow-preflight-conformance.test.js` | Delete lines 27, 67 and 73, and the import at line 11. Rename the test at 70 to `'flow/SKILL.md names the pack in Step 3 (#1931 AC6)'`, and drop the size clause from the test at 13 if its title has one. |
| `fork-worktree-isolation-conformance.test.js` | Delete the test `'fork-worktree-isolation.md stays well clear of the _shared ceiling'` (27-30). Delete line 36 and the `bytes` declaration it uses. Delete the import at line 8. Rename the test at 32 to `'subagent-output-contract.md cites the new file'`. |
| `merge-subject-composer-conformance.test.js` | Delete the test `'pr-first-merge.md stays net-small (AC 6 byte ceiling)'` (63-66) and the constant `const PR_FIRST_BYTE_CEILING = 31304;` (line 26, plus any comment lines directly above it that describe only that constant). |
| `multispec-preflight-failure-conformance.test.js` | Delete the test `'AC7.1: multi-spec.md stays under its 20,480-byte read budget'` (79-81). |
| `review-dispatch-composition.test.js` | Rename the test at 71 to `'the review-dispatch call site is measured with no error row'`. Keep its `rows.length > 0` and `row.error === undefined` assertions. Delete the `row.max < CEILING_BYTES`, `COMPOSED_STEP_EXCEPTIONS` and `overComposedCeiling` assertions (76, 78-80). The import becomes `findComposeCallSites, composedBytesReport,` only (keep whichever of the two the file still uses). In the header comment (lines 7-11), replace `, and the composed result must stay under the shared byte ceiling with no\n// COMPOSED_STEP_EXCEPTIONS entry — the reason this record split the two sources in the first\n// place.` with `. Its composed size is the rail suite's job (decision 0024).`, and replace `"the real call site's sources actually compose to the expected content, under the gate."` with `"the real call site's sources actually compose to the expected content."`. |
| `run-dir-timestamp-utc.test.js` | Delete the test `'multi-spec.md and manifesto.md fit their single-read budgets (#724, #1997)'` (80-102, the `BUDGETS` map) and the test `'manifesto.md has no over-ceiling composed-bytes row (#1997)'` (110-122), with the comment block between them (103-109). Delete the import at line 12. The `rail:` suite covers both raw files and the `manifesto` bundle. |
| `skill-mode-split-conformance.test.js` | Delete the `const STUB_CEILING_BYTES = …` line (32) and the whole `for (const skill of ['demo', 'feedback']) { test(\`${skill}/SKILL.md stays under the post-split stub ceiling\`, …) }` block (81-86). |
| `sweep-backstop.test.js` | Delete the test `'github-pr-scan.md stays under the pr-scan composed-bytes ceiling'` (395-407). Delete the whole comment block above it, from `// --- Composed-bytes gate on the one touched file that is a compose source ---` (line 380) to the line before the test. Delete the import at line 26. |
| `terminal-track.test.js` | Delete line 45 (`assert.ok(bytes < 8192, …)`) and the `const bytes = …` line above it. Rename the test at 40 to `'terminal-ux.md exists and carries the six sections'`. |
| `timing-prose-conformance.test.js` | Delete line 14 (`< 20480`), lines 57 and 96 (`<= CEILING`), the alias `const CEILING = CEILING_BYTES;` (line 25) and the import at line 9. Rename the three tests (11, 52, 91) to drop their `and stays under its read budget` / `, and SKILL.md stays under the ceiling` clauses. |
| `untrusted-record-content-conformance.test.js` | Delete the test `'contract stays within its 6144-byte cap'` (75-77). Delete line 143 (the `28 * 1024` pin) and keep that test's other three assertions. |
| `wrap-up-flaky-escalation-row.test.js` | Delete line 20 and the import at line 10. Rename the test at 12 to drop its `within the byte …` clause. |
| `wrap-up-pack-conformance.test.js` | Delete line 19 and the import at line 10. Rename the test at 12 to `'wrap-up SKILL.md calls wrap-up-pack.js --run exactly once, in Phase 3 (#1930 AC5)'`. |

- [ ] **Step 3: Verify.**

Run: the Step 1 probe again.
Expected: exit 0, no files listed.

Run: `node --test tests/backlog-refine-resolve-lane.test.js tests/ceremony-derivation-mode-gate.test.js tests/ceremony-profile-roster.test.js tests/console-resolve-conformance.test.js tests/deferral-gate-conformance.test.js tests/dispatch-graphql-blocked-preflight.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-per-record-groups-prose.test.js tests/dispatch-sequential-execution-conformance.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/flow-preflight-conformance.test.js tests/fork-worktree-isolation-conformance.test.js tests/merge-subject-composer-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/review-dispatch-composition.test.js tests/run-dir-timestamp-utc.test.js tests/skill-mode-split-conformance.test.js tests/sweep-backstop.test.js tests/terminal-track.test.js tests/timing-prose-conformance.test.js tests/untrusted-record-content-conformance.test.js tests/wrap-up-flaky-escalation-row.test.js tests/wrap-up-pack-conformance.test.js`
Expected: PASS, every test. Quote the raw `# tests` / `# pass` / `# fail` lines in the report.

- [ ] **Step 4: Commit.**

```bash
git add <the 23 files>
git commit -F <msgfile>   # "Remove every per-file size pin from tests/ — CEILING_BYTES consumers, literal budgets, BUDGETS map, composed-ceiling checks; content assertions kept (refs #3311)"
```

---

### Task 4: Delete the old model from `context-cost.js`

**Files:**
- Modify: `plugin/bin/lib/skill-audit/context-cost.js`
- Modify: `plugin/bin/lib/skill-audit/harness-cost.js:119` (comment)
- Test: `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes:
  - Task 1: `bloat.js` no longer requires `context-cost.js`.
  - Task 2: `merge-size-probe` is gone.
  - Task 3: no test outside `context-cost.test.js` imports a deleted name.
  - `rail.js`'s `composedRailViolations(root)` returns `[{ file, error }]` for every error or unparsed row, plus `overRail` hits.
- Produces: `context-cost.js` exports exactly:
  - measurement: `corpusDir, measuredTextBytes, measuredBytes, walkMarkdown, measureSkills, measureSubFiles`
  - compose: `parseComposeCallLine, findComposeCallSites, usedConditionKeys, conditionCombinations, measureComposed, composedBytesReport`
  - totals and descriptions: `totalBytes, extractDescription, descriptionHashHazard, findDescriptionHashHazards, measureDescriptions, totalDescriptionChars`

- [ ] **Step 1: Write the failing probe test.** Add to the top of `tests/bin-lib/skill-audit/context-cost.test.js`'s test list, after the imports:

```js
test('context-cost.js measures only — no size limit, warning tier or exception map is exported (#3311)', () => {
  const exported = Object.keys(require('../../../plugin/bin/lib/skill-audit/context-cost.js'));
  for (const gone of ['CEILING_BYTES', 'WARN_RATIO', 'DESCRIPTION_CEILING_CHARS', 'DESCRIPTION_TOTAL_CEILING_CHARS', 'COMPOSED_STEP_EXCEPTIONS', 'overCeiling', 'overCeilingWarnings', 'overComposedCeiling', 'headroom', 'nearCeiling', 'overDescriptionCeiling']) {
    assert.ok(!exported.includes(gone), `context-cost.js still exports ${gone}`);
  }
});
```

- [ ] **Step 2: Run the probe to verify it fails.**

Run: `node -e "process.exit('CEILING_BYTES' in require('./plugin/bin/lib/skill-audit/context-cost.js')?1:0)"`
Expected: FAIL (exit 1).

- [ ] **Step 3: Rewrite `context-cost.test.js`.**
  1. Delete these tests whole:
     - `'overCeiling and headroom agree on the boundary'` (83)
     - `'nearCeiling flags only the half-open [90%, 100%) band'` (92)
     - `'overCeilingWarnings: a synthetic SKILL.md over 40 KB is warned about, not failed'` (144)
     - `'per-file ceiling is a warning tier for sub-files (#1990): report, never fail'` (155)
     - `'no shipped SKILL.md exceeds CEILING_BYTES (#2020: invocation units keep a hard ceiling)'` (189)
     - `'the SKILL.md hard ceiling actually goes red on a doctored 41 KB fixture (#2020 AC)'` (200)
     - `'no /specify lazy-loaded sub-file exceeds the ~20-28 KB single-read ceiling (legacy exceptions aside)'` (241), with the `SPECIFY_SUBFILE_CEILING_BYTES` constant (230) and its legacy-exception set and comment block above the test
     - `'warns (without failing) on any file in the 90-100% ceiling band'` (281), with its `// ── Early-warning tier (#336)` comment block
     - `'no description exceeds the per-skill ceiling'` (376)
     - `'the corpus-wide description total stays under budget'` (385)
     - `'overComposedCeiling: a synthetic call site whose composed bytes exceed 40 KB fails the gate (AC2)'` (658)
     - `'overComposedCeiling: a per-step exception raises that step\'s ceiling only'` (671)
     - `'no compose call site\'s composed bytes exceed its ceiling under any condition combination (#1990)'` (684)
     - `'COMPOSED_STEP_EXCEPTIONS: every exception is still needed, and stays tight to the measured max'` (698), with `COMPOSED_EXCEPTION_SLACK_BYTES`
     - `'overComposedCeiling: a step named after an Object.prototype member is not silently treated as exception-free (own-property guard)'` (716)
  2. Delete the `// ── composedBytesReport / overComposedCeiling (#1990 Task 4)` comment block (640-650).
  3. Retarget `'findComposeCallSites: an unparsed line is emitted as { step: null, unparsed: true, reason }, and fails the composed-bytes gate'` (471): replace its last three lines (`const over = overComposedCeiling(…)` and its two asserts) with:

```js
  const violations = composedRailViolations(root);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].error, 'repo-relative source path (install-dead): plugin/skills/_shared/a.md');
```

     and add `const { composedRailViolations } = require('../../../plugin/bin/lib/skill-audit/rail.js');` beside the other imports (skip it if the file already imports from `rail.js`; extend that import instead).
  4. Retarget `'reports the payload total and the tightest headroom'` (253) against the rail:
     - Rename it to `'reports the payload total and the tightest rail headroom'`.
     - `.map((s) => ({ ...s, free: headroom(s) }))` becomes `.map((s) => ({ ...s, free: RAIL_BYTES - s.bytes }))`.
     - The log text `under the ceiling` becomes `under the rail`.
     - Delete the trailing `// Defensive only …` comment and its `if (tightest.free < 0)` block. The `rail:` suite is the hard gate.
     - Import `RAIL_BYTES` from `../../../plugin/bin/lib/skill-audit/budgets.js` (extend an existing `budgets.js` import if present).
  5. Remove the deleted names from the `context-cost.js` import list at lines 9-35: `CEILING_BYTES`, `DESCRIPTION_CEILING_CHARS`, `DESCRIPTION_TOTAL_CEILING_CHARS`, `overCeiling`, `overCeilingWarnings`, `WARN_RATIO`, `headroom`, `nearCeiling`, `overDescriptionCeiling`, `overComposedCeiling`, `COMPOSED_STEP_EXCEPTIONS`. Then remove any remaining imported name the file no longer uses (`totalDescriptionChars` stays only if the `rail diagnostic` test uses it).

- [ ] **Step 4: Edit `context-cost.js`.**
  1. Replace the header comment (lines 3-24, from `// Context-cost measurement for the shipped skill payload.` through `// never inflates a count that nobody actually reads.`) with:

```js
// Context-cost measurement for the shipped skill payload.
//
// A SKILL.md loads in full on every invocation, and once per dispatched subagent.
// Bloat here is invisible until someone measures it, which is how the corpus
// reached 931 KB before anyone looked. This module measures; it sets no limit.
// The one size limit in force is the Read-limit rail — RAIL_BYTES, RAIL_LINES
// and DESCRIPTION_MAX_CHARS in ./budgets.js, applied through ./rail.js and the
// `rail:` suite (decision 0024).
//
// Per-file bytes are CRLF-normalized and marker-stripped (`measuredBytes`) so a
// `core.autocrlf=true` checkout or an unrendered `<!-- when: ... -->` marker
// never inflates a count. The number a reader actually pays at a compose call
// site is the composed bundle (`composedBytesReport`), not any one source file.
```

  2. Delete `const CEILING_BYTES = 50 * 1024;` (35).
  3. Delete the description-budget comment block and `const DESCRIPTION_CEILING_CHARS = 260;` (37-47). Delete the running bump-history comment block and `const DESCRIPTION_TOTAL_CEILING_CHARS = 8700;` (48-91).
  4. Delete `function overCeiling` and `function overCeilingWarnings` with the comment between them (176-184).
  5. Delete the `#2002 removed the merge exception` / `scan-procedures.md` comment block and `const COMPOSED_STEP_EXCEPTIONS = {};` (383-401). Change `composedBytesReport`'s comment to `// One row per compose call site in the shipped skill prose.`.
  6. Delete `overComposedCeiling` with its comment (408-434), `headroom` with its comment (436-441), and the early-warning comment, `WARN_RATIO` and `nearCeiling` (443-452).
  7. Delete `function overDescriptionCeiling` (517-519).
  8. Remove the eleven deleted names from `module.exports`.
  9. In `plugin/bin/lib/skill-audit/harness-cost.js:118-119`, change the comment's `(\`measureSubFiles\`/\`overCeilingWarnings\`)` to `(\`measureSubFiles\`)`.

- [ ] **Step 5: Verify every consumer is gone before running suites.**

Run: `git grep -n -P "\b(CEILING_BYTES|WARN_RATIO|DESCRIPTION_CEILING_CHARS|DESCRIPTION_TOTAL_CEILING_CHARS|COMPOSED_STEP_EXCEPTIONS|overCeilingWarnings|overComposedCeiling|overDescriptionCeiling)\b|\b(headroom|nearCeiling|overCeiling)\(" -- plugin tests tools | grep -v doesNotMatch`
Expected: no output (exit 1).

Run: `node -e "process.exit('CEILING_BYTES' in require('./plugin/bin/lib/skill-audit/context-cost.js')?1:0)"`
Expected: exit 0.

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/bloat.test.js tests/bin-lib/skill-audit/harness-cost.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js tests/review-dispatch-composition.test.js`
Expected: PASS, including all four `rail` tests.

- [ ] **Step 6: Commit.**

```bash
git add plugin/bin/lib/skill-audit/context-cost.js plugin/bin/lib/skill-audit/harness-cost.js tests/bin-lib/skill-audit/context-cost.test.js
git commit -F <msgfile>   # "Delete the old size model from context-cost.js — ceiling, warning tier, composed exceptions and description ceilings; measurement only, limits in budgets.js (refs #3311)"
```

---

### Task 5: Rewrite the prose that cites deleted code

**Files:**
- Modify: `docs/journeys/measure-composed-bytes-per-call-site-1990.md` (Step 3, lines 32-37)
- Modify: `docs/skill-authoring.md:39` and `:126`
- Modify: `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md:47`

**Interfaces:**
- Consumes: Task 4's export set (the journey's command must run against it), and `rail.js`'s `skillFileRailViolations(root)` / `composedRailViolations(root)`, where `root` is the plugin root.
- Produces: no prose naming `overCeilingWarnings`, `nearCeiling`, `overDescriptionCeiling`, `DESCRIPTION_TOTAL_CEILING_CHARS`, the `manifesto` composed gate or a per-file `BUDGETS` pin.

- [ ] **Step 1: Run the probe to verify the stale prose exists.**

Run: `node -e "const fs=require('fs');const t=['docs/journeys/measure-composed-bytes-per-call-site-1990.md','docs/skill-authoring.md','.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md'].map((f)=>fs.readFileSync(f,'utf8')).join('\n');process.exit(/overCeilingWarnings|nearCeiling\(|overDescriptionCeiling|DESCRIPTION_TOTAL_CEILING_CHARS|manifesto\` composed gate|260 characters — mechanically/.test(t)?1:0)"`
Expected: FAIL (exit 1).

- [ ] **Step 2: Journey 1990 Step 3.** Replace the whole `### 3. Read the per-file warning tier` step (heading through its **Red flags** line) with:

```markdown
### 3. Read the per-file rail check
- **URL:** `node -e 'const r=require("./plugin/bin/lib/skill-audit/rail.js");const c=require("./plugin/bin/lib/skill-audit/context-cost.js");const s=[...c.measureSkills("plugin"),...c.measureSubFiles("plugin")];console.log(JSON.stringify({files:s.length,overRail:r.skillFileRailViolations("plugin"),markerErrors:s.filter(e=>e.markerError).length}))'`
- **Action:** Run it and compare with `node --test tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` results.
- **Should feel:** One number to watch per file, the Read rail, with nothing below it that can tip a merge red.
- **Should understand:** There is no per-file ceiling or warning tier anymore (decision 0024). A raw file fails only when it cannot be read in one Read call: over `RAIL_BYTES` (52,500 measured bytes) or `RAIL_LINES` (2,000). Bytes are counted after CRLF → LF normalization and with `when:` marker lines stripped, so a `core.autocrlf` checkout and an unrendered marker never inflate them. A file near the rail is cut, or has a genuinely lazy section moved out. Fencing does not shrink a raw file.
- **Red flags:** `markerErrors > 0` (the conformance suite will say the same); a non-empty `overRail` array on a tree whose `rail:` suite passes; a raw `wc -c` used to argue with these numbers on a Windows checkout.
```

- [ ] **Step 3: `docs/skill-authoring.md:39`.** Replace the paragraph beginning `A sub-file may carry a **tighter per-file pin** than the rail` (the whole line 39) with:

```markdown
No file carries a tighter per-file byte pin than the rail: #3311 removed the last ones (`flow/manifesto.md`, `flow/multi-spec.md` and the rest), and `tests/skill-size-single-source.test.js` fails if a new one appears anywhere but `plugin/bin/lib/skill-audit/budgets.js`. Check `wc -c` against `RAIL_BYTES` before adding to a file near the rail.
```

- [ ] **Step 4: `docs/skill-authoring.md:126`.** In the `description` bullet, replace `Keep it at or under 260 characters — mechanically enforced by \`plugin/bin/lib/skill-audit/context-cost.js\`'s \`overDescriptionCeiling\` check (\`context-cost.test.js\`) —` with `Keep it short — every description loads into every session — and under the CLI's 1,536-character per-description listing max (\`DESCRIPTION_MAX_CHARS\`, the \`rail: every skill description fits the CLI listing max\` test) —`. Leave the rest of the bullet unchanged.

- [ ] **Step 5: `advanced-proof-patterns.md:47`.** In that paragraph, replace the clause beginning `` `plugin/bin/lib/skill-audit/context-cost.js`'s `DESCRIPTION_TOTAL_CEILING_CHARS` `` and ending `no headroom to trim);` with:

```markdown
the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js` — every description must fit the CLI's 1,536-character listing max, and its total is reported against the listing budget (never failed);
```

Fix the paragraph's count word so it matches the number of counters it still lists. Today it says "at least four"; count the items after the edit.

- [ ] **Step 6: Verify.**

Run: the Step 1 probe again.
Expected: exit 0.

Run: the journey's Step 3 `node -e` command verbatim from the repo root.
Expected: prints a JSON object with `"overRail":[]` and `"markerErrors":0`.

Run: `node --test tests/argument-hint-mirrors.test.js tests/bin-lib/skill-audit/house-structure.test.js`
Expected: PASS (both read `docs/skill-authoring.md`).

- [ ] **Step 7: Commit.**

```bash
git add docs/journeys/measure-composed-bytes-per-call-site-1990.md docs/skill-authoring.md .claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md
git commit -F <msgfile>   # "Rewrite prose that cited the deleted size model — journey 1990 Step 3 on rail.js, skill-authoring's pin and description rules, the proof-patterns counter list (refs #3311)"
```

---

### Task 6: Add the durable anti-scatter guard

**Files:**
- Create: `tests/skill-size-single-source.test.js`

**Interfaces:**
- Consumes: the post-Task-3/4 tree, in which no pin remains outside `budgets.js` and the two allowlisted files.
- Produces: `module.exports = { scanText }`, where `scanText(text)` returns `{ violations: [{ line, rule, text }], unclassified: [{ line, operand, text }] }`.

- [ ] **Step 1: Write the test file** with exactly this content:

```js
// tests/skill-size-single-source.test.js — the durable anti-scatter guard (#3311).
//
// plugin/bin/lib/skill-audit/budgets.js is the one place in tests/ or plugin/bin/
// that may define a skill-size number (decision 0024). This test fails when any
// other file there (a) declares a size-limit constant — a CEILING/BUDGET name
// carrying BYTE(S)/CHAR(S) — assigned a number, or (b) compares a measure taken
// from a plugin/skills path against a numeric literal of 1024 or more (or an
// `N * 1024` expression). A skill path reaches a comparison through variables
// (`const p = path.join(ROOT, 'plugin', 'skills', …)`, then `read(p)`, then
// `bytes`), so references are tainted forward line by line, including into
// multi-line object literals and `for…of` bindings. A size comparison whose
// operand is a named value the scanner cannot resolve (an UPPER_CASE constant,
// or a name containing ceiling/budget/cap) is reported as `unclassified` —
// distinct from a violation, and never silently passed.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SINGLE_SOURCE = 'plugin/bin/lib/skill-audit/budgets.js';
// Named exceptions — each is a size number about something other than a shipped skill file.
const ALLOWLIST = new Map([
  ['tests/claude-md-budget.test.js', "CLAUDE.md's own line/byte budget — a different artifact from a shipped skill file"],
  ['tests/design-wrapper-review-surface-gate-prose.test.js', 'a 35 KB check proving a fixture discriminates, not a ceiling on a real file'],
]);
// The rail's own names (budgets.js) are the single source, never an unresolved operand.
const RAIL_NAMES = new Set(['RAIL_BYTES', 'RAIL_LINES', 'RAIL_TOKENS', 'DESCRIPTION_MAX_CHARS']);

const RULE_A = /\b(?:const|let|var)\s+([A-Z0-9_]*(?:CEILING|BUDGET)[A-Z0-9_]*_(?:BYTES|CHARS)|[A-Z0-9_]*_(?:BYTE|CHAR)S?_(?:CEILING|BUDGET)[A-Z0-9_]*)\s*=\s*([^;\n]*)/;
const SKILL_PATH = /plugin\/skills\b|['"`]skills\/|['"]skills['"]/;
const SIZE_MEASURE = /\bBuffer\.byteLength\b|\bmeasuredBytes\b|\.bytes\b|\.size\b|\.max\b|\bbytes\b/;
const COMPARISON = /(<=|>=|<|>)\s*(\(?\s*\d[\d_]*(?:\s*\*\s*1024)?\s*\)?|[A-Za-z_$][\w$.]*(?:\[[^\]]*\])?)/g;
const NUMERIC = /^\(?\s*(\d[\d_]*)(\s*\*\s*1024)?\s*\)?$/;

function escapeName(name) {
  return name.replace(/\$/g, '\\$');
}

// scanText(text) -> { violations: [{ line, rule, text }], unclassified: [{ line, operand, text }] }
function scanText(text) {
  const violations = [];
  const unclassified = [];
  const tainted = new Set();
  let openLiteral = null;
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/(^|[^:'"`])\/\/.*$/, '$1');
    // Rules are read from code only: string and template contents are removed
    // (a path inside a string still taints — SKILL_PATH reads `line`, not `code`).
    const code = line.replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
    const a = code.match(RULE_A);
    if (a && /\d/.test(a[2])) violations.push({ line: n, rule: 'a', text: raw.trim() });
    const refsTainted = [...tainted].some((t) => new RegExp(`(^|[^\\w$])${escapeName(t)}([^\\w$]|$)`).test(line));
    const refsSkill = SKILL_PATH.test(line) || refsTainted;
    if (openLiteral) {
      if (refsSkill) tainted.add(openLiteral);
      if (/^\s*[}\]]/.test(line)) openLiteral = null;
    }
    const decl = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([{[]?)/);
    if (decl) {
      if (refsSkill) tainted.add(decl[1]);
      if (decl[2] && !/[}\]]\s*[;,)]?\s*$/.test(line)) openLiteral = decl[1];
    }
    const forOf = line.match(/\bfor\s*\(\s*(?:const|let|var)\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)\s+of\b/);
    if (forOf && refsSkill) for (const name of forOf[1].match(/[A-Za-z_$][\w$]*/g)) tainted.add(name);
    if (!refsSkill) return;
    if (!SIZE_MEASURE.test(code)) return;
    let flagged = false;
    for (const m of code.matchAll(COMPARISON)) {
      const op = m[2].trim();
      const num = op.match(NUMERIC);
      if (num) {
        if (num[2] || Number(num[1].replace(/_/g, '')) >= 1024) flagged = true;
        continue;
      }
      const last = op.split('.').pop().replace(/\[.*$/, '');
      if (RAIL_NAMES.has(last)) continue;
      if (/^[A-Z][A-Z0-9_]*$/.test(last) || /ceiling|budget|cap\b/i.test(last)) {
        unclassified.push({ line: n, operand: op, text: raw.trim() });
      }
    }
    if (flagged) violations.push({ line: n, rule: 'b', text: raw.trim() });
  });
  return { violations, unclassified };
}

function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('AC3.1: no file under tests/ or plugin/bin/ other than budgets.js defines or compares a skill-size number, and none is unclassified', () => {
  const violations = [];
  const unclassified = [];
  for (const abs of [...walkJs(path.join(ROOT, 'tests')), ...walkJs(path.join(ROOT, 'plugin', 'bin'))]) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel === SINGLE_SOURCE || ALLOWLIST.has(rel)) continue;
    const r = scanText(fs.readFileSync(abs, 'utf8'));
    for (const v of r.violations) violations.push(`${rel}:${v.line} (rule ${v.rule}): ${v.text}`);
    for (const u of r.unclassified) unclassified.push(`${rel}:${u.line} [${u.operand}]: ${u.text}`);
  }
  assert.deepStrictEqual(violations, [], `skill-size numbers outside ${SINGLE_SOURCE} — move them to budgets.js or delete them:\n${violations.join('\n')}`);
  assert.deepStrictEqual(unclassified, [], `size comparisons the scanner cannot classify — resolve or allowlist with a reason:\n${unclassified.join('\n')}`);
});

test('every allowlist entry names an existing file and carries a reason', () => {
  for (const [rel, reason] of ALLOWLIST) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `allowlisted file is gone: ${rel}`);
    assert.ok(reason.length > 20, `allowlist entry needs a reason: ${rel}`);
  }
});

test('AC3.1: self-test — rule (a) goes red on a size-limit constant', () => {
  assert.equal(scanText('const FOO_CEILING_BYTES = 30 * 1024;').violations[0].rule, 'a');
  assert.equal(scanText('const PR_FIRST_BYTE_CEILING = 31304;').violations[0].rule, 'a');
  assert.deepStrictEqual(scanText("const FOO_CEILING_BYTES = require('./x');").violations, []);
});

test('AC3.1: self-test — rule (b) goes red on a skill-path size compared to a literal', () => {
  const fixture = "assert.ok(Buffer.byteLength(read('plugin/skills/x.md'), 'utf8') <= 28 * 1024);";
  assert.equal(scanText(fixture).violations[0].rule, 'b');
  const plain = "assert.ok(Buffer.byteLength(read('plugin/skills/x.md'), 'utf8') <= 40893);";
  assert.equal(scanText(plain).violations[0].rule, 'b');
});

test('self-test: rule (b) follows a skill path through variables, literals, and for...of bindings', () => {
  const chained = [
    "const p = path.join(ROOT, 'plugin', 'skills', '_shared', 'x.md');",
    'const md = readText(p);',
    "const bytes = Buffer.byteLength(md, 'utf8');",
    'assert.ok(bytes < 8192);',
  ].join('\n');
  assert.deepStrictEqual(scanText(chained).violations.map((v) => v.line), [4]);
  const mapped = [
    'const BUDGETS = {',
    "  'plugin/skills/flow/a.md': 20480,",
    '};',
    'for (const [p, budget] of Object.entries(BUDGETS)) {',
    "  const bytes = Buffer.byteLength(read(p), 'utf8');",
    '  assert.ok(bytes < budget);',
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanText(mapped).unclassified.map((u) => u.line), [6]);
});

test('self-test: what the scanner must not flag', () => {
  // A fixture path with no skills reference, a comparison inside a message string,
  // a comparison against the rail, and a small literal are all clean.
  assert.deepStrictEqual(scanText("const t = path.join(dir, 'big.md');\nassert.ok(fs.statSync(t).size >= 60000);"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const s = read('plugin/skills/x.md');\nassert.ok(s.includes('a'), 'expected < 8000 bytes');"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const bytes = Buffer.byteLength(read('plugin/skills/x.md'));\nassert.ok(bytes <= RAIL_BYTES);"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const n = measureSkills('plugin/skills');\nassert.ok(n.bytes > 0);"), { violations: [], unclassified: [] });
});

module.exports = { scanText };
```

- [ ] **Step 2: Run it to verify it fails before the file exists.**

Run: `node --test tests/skill-size-single-source.test.js`
Expected: FAIL. Before Step 1 the file does not exist. Once it exists on a tree where Tasks 3-4 have not landed, the AC3.1 live-tree test fails, listing the pins.

- [ ] **Step 3: Run it on the post-Task-4 tree.**

Run: `node --test tests/skill-size-single-source.test.js`
Expected: PASS, all six tests, with zero violations and zero `unclassified` lines (AC3.1).

- [ ] **Step 4: Prove each rule goes red against the live corpus** (scratch only — never commit this):
  1. Temporarily add `const FOO_CEILING_BYTES = 30 * 1024;` to the end of `tests/terminal-track.test.js`. Run Step 3's command. Expected: the AC3.1 live-tree test fails naming `tests/terminal-track.test.js` (rule a).
  2. Revert, then temporarily add `assert.ok(Buffer.byteLength(require('fs').readFileSync('plugin/skills/flow/multi-spec.md', 'utf8')) < 20480);` instead. Expected: it fails naming that line (rule b).
  3. Revert, and confirm `git status --porcelain tests/terminal-track.test.js` is empty.

- [ ] **Step 5: Commit.**

```bash
git add tests/skill-size-single-source.test.js
git commit -F <msgfile>   # "Add the skill-size single-source guard — fails on any size-limit constant or skill-path size literal outside budgets.js, with an allowlist and go-red self-tests (refs #3311)"
```

- [ ] **Step 6: Run the AC sweeps and write the results into the task report** (for the PR body; nothing is committed):

Run: `git grep -n -E "CEILING_BYTES|WARN_RATIO|COMPOSED_STEP_EXCEPTIONS|overComposedCeiling|overCeilingWarnings|nearCeiling\(|DESCRIPTION_(TOTAL_)?CEILING_CHARS|overDescriptionCeiling|SPECIFY_SUBFILE_CEILING_BYTES|STUB_CEILING_BYTES|merge-size-probe" -- . ':!docs/incident-log.md' ':!docs/decisions' ':!docs/superpowers' ':!docs/plans' ':!.claude-tweaks' | grep -v doesNotMatch`
Expected: no output (AC1.1, AC1.2). Record separately, as the absence guards, the lines the `grep -v doesNotMatch` filter removed: today `tests/specify-decomposition-collapse.test.js:285`, `tests/bin-lib/skill-audit/bloat.test.js:597` and `tests/bin-lib/wrap-up/pack.test.js:905`. Confirm `plugin/bin/lib/plan-audit/checks.js` still carries the `nearCeiling` envelope key, which the `nearCeiling\(` pattern does not match (AC1.2).

Run: `git grep -n -E "[0-9]+ \* 1024" -- tests | grep -E "plugin/skills|skills/"`
Expected: no output (AC2.1). Then run the unfiltered `git grep -n -E "[0-9]+ \* 1024" -- tests` and list each hit with a one-word reason (`fixture`, `maxBuffer`, `discrimination`, `image`) (AC2.2).
