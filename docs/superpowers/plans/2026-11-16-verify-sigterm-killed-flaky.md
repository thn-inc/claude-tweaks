# Signal-killed file passing in isolation is flaky — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `verify.js --baseline` reports a test file that the full run killed outright (a wholly file-level failure — SIGTERM under load, a timeout) as `flaky` when its isolated HEAD run passes cleanly, instead of `attributable`.

**Architecture:** One predicate in `plugin/bin/lib/verify/baseline.js`'s `adjudicate()` changes: `ranCleanly(r, k)` currently requires every full-run failing name to show its own pass in the isolated log. A wholly file-level full-run failure has one failing "name" — the file path itself (`failingTestsByFile` normalizes it to the relative path) — which no isolated log ever lists as a test, so the file can never be flaky. When `work[k].headFileLevel` is true (every full-run failing entry for the file is file-level), the per-name check is waived; every other guard in `ranCleanly` (exit 0, `accountedFamily` — `ℹ cancelled 0`, no runner-level error —, tests > 0, pass > 0, fail 0, well-formed tree) still applies. Base-run outcome is not read by `ranCleanly`, so a base that fails an unrelated test changes nothing.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T070527-record-4424/work/4424-spec.md`

## Global Constraints

- Probed fact (Node v26.13.1 and Node 20, this session): the spec reporter prints a SIGTERM-killed file exactly like a file that exited non-zero — `test at tests/x.test.js:1:1` / `✖ tests/x.test.js (Nms)` / `  'test failed'` — with no signal in the log; TAP carries `exitCode: ~` / `signal: 'SIGTERM'` in the block's YAML. So "a signal kill or timeout (no test-level failure)" is detected as *wholly file-level* (`headFileLevel`), the only distinction the spec log supports. A file whose full-run entries mix a file-level entry with any test-level entry keeps today's per-name rule (spec Deliverable 2: "the kill cannot be told apart from a test-level failure").
- Quoted from `.claude/skills/node-test-output-evidence/SKILL.md` (governs `baseline.js`): "Reproduce a suspected parser hole with a real Node reporter log (spec and TAP) before fixing it, and keep that log's shape in the test." — the fixtures below copy the probed shapes.
- Quoted from the same skill's Decision Framework: "| A full-run failure that is absent from an isolated run | Not a pass. Only the test's own `✔` in that run counts |" — this row is the rule this change carves a file-level exception out of; Task 2 updates it.
- Quoted from the same skill: "In an isolated single-file run (the per-file base run or the isolated HEAD rerun): a non-zero cancelled count or a runner-level `ℹ Error:` … That run is no evidence: it cannot make the file baseline or flaky." — unchanged; the new path keeps `accountedFamily`.
- Source-scan lint: no new `fs.*` calls in `plugin/bin/` (path-guard conformance scan); the change is a boolean in an existing predicate.
- `plugin/skills/test/verification.md` is 51,856 B against `RAIL_BYTES` 52,500 B (644 B headroom): Task 2's edit there must add under 200 B.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. A file whose full-run entries are a file-level entry **plus** a test-level entry (the kill landed after a real failure) must stay attributable when the isolated run never shows that test — Task 1 test `mixed file-level + test-level`.
2. A file-level full-run failure whose isolated run reports `ℹ cancelled 1` (or exits 0 with every test skipped) must stay attributable — Task 1 test `isolated cancelled / all-skipped`.
3. TAP full-run logs (`signal: 'SIGTERM'` block) classify the same as spec — Task 1 test `TAP SIGTERM block`.
4. A file absent at base stays attributable outright even when killed and clean in isolation (existing `I3` test, unchanged — re-run it).
5. The existing test-level rule is not loosened: `flaky needs evidence too: … the full-run failure never ran` (existing test) must stay green and must go red if the `headFileLevel` guard is removed (Task 1 Step 6 mutation).

---

### Task 1: Classify a wholly file-level full-run failure by its isolated HEAD run

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (`ranCleanly`, ~lines 686-700, and its comment; header comment lines 1-18 gains one clause)
- Test: `tests/bin-lib/verify/baseline.test.js` (new tests after the `#3111` isolation tests, ~line 636)
- Test: `tests/bin-lib/verify/cli-baseline-verdicts.test.js` (two real-process tests after the `#3043 I3` test, ~line 110)

**Interfaces:**
- Consumes: `work[k].headFileLevel` (already computed in `adjudicate()` from `fileLevelFailures(text, family, at(headDir))`).
- Produces: no new export; `adjudicate()`'s result shape is unchanged (the file lands in `flakyPassed`/`flakyLogs`).

- [ ] **Step 1: Write the failing unit tests** in `tests/bin-lib/verify/baseline.test.js`, reusing `fakes`, `logFile`, `NAMED`, `PASS_LOG`, `R`, `tmpl`. Add a fixture constant copying the probed real spec shape of a killed file in a full run:

```js
// The full run's spec log when node --test's child for R was killed (SIGTERM under load):
// the shape probed on Node 20 and 26 — a file-level entry, no signal in the spec text (#4424).
const KILLED_SPEC = ['✔ other passes (1ms)', `✖ ${R} (6337000.5ms)`, 'ℹ tests 2', 'ℹ suites 0', 'ℹ pass 1', 'ℹ fail 1', 'ℹ cancelled 0',
  'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 6337001', '', '✖ failing tests:', '', `test at ${R}:1:1`, `✖ ${R} (6337000.5ms)`, "  'test failed'", ''].join('\n');
// The same kill in a TAP full run (cwd /repo, as fakes() uses).
const KILLED_TAP = ['TAP version 13', `# Subtest: ${R}`, `not ok 1 - ${R}`, '  ---', '  duration_ms: 6337000.5', "  type: 'test'",
  `  location: '/repo/${R}:1:1'`, "  failureType: 'testCodeFailure'", '  exitCode: ~', "  signal: 'SIGTERM'", "  error: 'test failed'",
  "  code: 'ERR_TEST_FAILURE'", '  ...', '1..1', '# tests 1', '# suites 0', '# pass 0', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 6337001'].join('\n');
const killedCase = ({ head = KILLED_SPEC, isolatedCode = 0, isolatedLog = PASS_LOG, retryLog, retryCode } = {}) => {
  const { p, dir } = logFile(head);
  const { git, runOne, calls } = fakes({
    outcomes: { [`baseline:${R}`]: 1, [`isolated:${R}`]: isolatedCode, ...(retryCode !== undefined ? { [`isolated-retry:${R}`]: retryCode } : {}) },
    // Base fails one test unrelated to the kill (the #3064 SIGINT-case shape in #3315's run).
    logs: { [`baseline:${R}`]: NAMED({ fails: [['unrelated']], passes: ['x'] }), [`isolated:${R}`]: isolatedLog, ...(retryLog !== undefined ? { [`isolated-retry:${R}`]: retryLog } : {}) },
  });
  return adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git })
    .then((r) => ({ ...r, calls }));
};
```

Tests (names and assertions):
- `AC1.1, AC1.2: a SIGTERM-killed file (file-level in the full run) passing cleanly in isolation at HEAD is baseline-flaky though its base run fails an unrelated test (#4424)` — `r = await killedCase()`; `assert.strictEqual(r.verdict, 'pass')`; `assert.deepStrictEqual(r.flakyPassed, [R])`; `assert.deepStrictEqual(r.attributable, [])`; `assert.match(r.flakyLogs[R], /tests-isolated-tests\+r\.test\.js\.log$/)`; `assert.deepStrictEqual(r.calls.runs.filter((c) => c.kind === 'isolated-retry'), [])`.
- `AC2.1: the same killed file whose isolated HEAD run also fails stays ATTRIBUTABLE (#4424)` — `killedCase({ isolatedCode: 1, isolatedLog: NAMED({ fails: [['x']] }), retryCode: 1, retryLog: NAMED({ fails: [['x']] }) })`; `verdict === 'fail'`, `attributable` `[R]`, `flakyPassed` `[]`.
- `TAP SIGTERM block: a killed file in a TAP full run classifies the same way (#4424)` — `killedCase({ head: KILLED_TAP })`; `flakyPassed` `[R]`, `verdict` `'pass'`.
- `mixed file-level + test-level: a kill beside a real test failure in the same file keeps the per-test rule — attributable (#4424)` — head is `KILLED_SPEC` with a second failing entry for R inserted into the failing section (`test at ${R}:9:3` / `✖ works (1ms)` / `  AssertionError`, and `ℹ fail 2`); isolated `PASS_LOG` (shows only `x`, never `works`); assert `attributable` `[R]`, `flakyPassed` `[]`.
- `isolated cancelled / all-skipped: a killed file is flaky only when its isolated run passes every accounting guard (#4424)` — two cases: isolated log `['✔ x (1ms)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 1'].join('\n')`, and `['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 0', 'ℹ cancelled 0'].join('\n')`; each with `isolatedCode: 0`; assert `attributable` `[R]`, `flakyPassed` `[]`.

- [ ] **Step 2: Run them to verify the new-behavior ones fail**

Run: `node --test --test-name-pattern="#4424" tests/bin-lib/verify/baseline.test.js`
Expected: FAIL — the `AC1.1, AC1.2` and `TAP SIGTERM block` tests fail (`flakyPassed` is `[]`, `attributable` is `['tests/r.test.js']`); the `AC2.1`, `mixed` and `isolated cancelled` tests already pass (they pin what must not change).

- [ ] **Step 3: Implement in `ranCleanly(r, k)` (`plugin/bin/lib/verify/baseline.js`)**

Change only its final `return`: keep `tree.wellFormed`, and require the per-name evidence (`work[k].headTests.length > 0 && work[k].headTests.every(passedIn(tree))`) only when `!work[k].headFileLevel`. Update the comment above `ranCleanly` to say a wholly file-level full-run failure (a killed or timed-out child — the spec reporter cannot tell which) names no test to show a pass for, so the clean isolated run is the evidence (#4424). Add one clause to the file header comment after "one passing in isolation at HEAD is flaky" naming the same case.

- [ ] **Step 4: Run the unit suite**

Run: `node --test tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/extract.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Real-process CLI tests** in `tests/bin-lib/verify/cli-baseline-verdicts.test.js`, after the `#3043 I3` test, modeled on it (`baselineRepo`, `headCommit`, `runCli`, `PER_FILE`, a `tmpDir()` marker file):
  - Base commit adds `tests/killed.test.js` with `test('unrelated', () => { throw new Error('old'); })` and `test('works', () => {})`. HEAD commit rewrites it: `unrelated` passes, and `works` does, when the marker exists, `fs.unlinkSync(marker); process.kill(process.pid, 'SIGTERM'); await new Promise((r) => setTimeout(r, 5000));` (kill-once). Write the marker, run `runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/env.test.js tests/killed.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE], r.opts)`.
  - Test `AC1.2: a test file SIGTERM-killed in the full run and clean in isolation at HEAD exits 0 with a baseline-flaky CAVEAT (#4424)`: `assert.strictEqual(code, 0, stdout)`; `assert.match(stdout, /^CAVEAT: baseline-flaky: tests\/killed\.test\.js — failed in the full run, passed in isolation at HEAD; see .*tests-isolated-tests\+killed\.test\.js\.log$/m)`.
  - Test `AC2.1: the same kill with an isolated HEAD failure exits 1 naming the file ATTRIBUTABLE (#4424)`: HEAD's `works` throws `new Error('real')` after the kill-once branch (so it fails whenever the marker is absent); `assert.strictEqual(code, 1, stdout)`; `assert.match(stdout, /ATTRIBUTABLE: tests\/killed\.test\.js/)`.

Run: `node --test tests/bin-lib/verify/cli-baseline-verdicts.test.js`
Expected: PASS. Then revert Step 3's change (`git stash` is forbidden — copy the file aside with the Write tool or edit the line back), re-run, and confirm the `AC1.2` CLI test fails with `code` 1; restore.

- [ ] **Step 6: Guard-discrimination mutation**

Temporarily change the new condition so the per-name check is skipped unconditionally (drop the `!work[k].headFileLevel` guard). Run `node --test tests/bin-lib/verify/baseline.test.js`. Expected: FAIL in `mixed file-level + test-level` and in the existing `flaky needs evidence too` test. Restore the guard and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/cli-baseline-verdicts.test.js
git commit -m "Classify a signal-killed file clean in isolation as flaky — refs #4424"
```

### Task 2: Update the prose that states the old flaky rule

**Role:** transcription

**Files:**
- Modify: `plugin/skills/test/verification.md:201` (the `**flaky**` bullet)
- Modify: `docs/plugin-structure.md:87` (`baseline.js` entry — "and every full-run failure showing its own pass")
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md:99` (Decision Framework row "A full-run failure that is absent from an isolated run")

**Interfaces:**
- Consumes: Task 1's rule (a wholly file-level full-run failure needs no per-test pass).

- [ ] **Step 1: Edit `verification.md:201`** — replace `Every test that failed in the full run must show its own \`✔\` pass there.` with `Every test that failed in the full run must show its own \`✔\` pass there, unless the file failed there only at file level (killed or timed out, #4424).` (+~70 B; stays under `RAIL_BYTES`).

- [ ] **Step 2: Edit `docs/plugin-structure.md:87`** — after `every full-run failure showing its own pass` insert ` (waived when every full-run failing entry for the file is file-level — a killed or timed-out child, #4424)`.

- [ ] **Step 3: Edit the skill's row 99** — append to its right cell: ` — except a wholly file-level full-run failure (a killed or timed-out child; spec shows no signal), which names no test: a clean isolated run is then the evidence (#4424)`.

- [ ] **Step 4: Verify**

Run: `wc -c plugin/skills/test/verification.md` — Expected: below 52500.
Run: `git grep -n -F 'killed or timed out' -- plugin/skills/test/verification.md docs/plugin-structure.md .claude/skills/node-test-output-evidence/SKILL.md` — Expected: one hit per file (control: before the edit the same command prints nothing for `verification.md`).
Run: `node --test tests/skill-size-single-source.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md docs/plugin-structure.md .claude/skills/node-test-output-evidence/SKILL.md
git commit -m "Document the file-level flaky rule — refs #4424"
```
