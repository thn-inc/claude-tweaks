# Verify Baseline Adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `plugin/bin/verify.js` adjudicate a failing run against a base ref — re-running only the failing test files at the base (scratch worktree) and in isolation at HEAD — and stamp a pass when no failure is attributable to the branch, so `/flow` on a checkout with a known environment-specific failure baseline verifies once at build and never loops at `/test` or `/review` Step 1.5.

**Architecture:** A new pure-ish module `plugin/bin/lib/verify/baseline.js` (`adjudicate()` with injected git + runOne seams) runs after the normal check run when `--baseline <ref>` is passed and a check failed. `verify.js` wires it in: resolves the base before running anything (exit 2 if it doesn't resolve), records `baselineAdjudicated` in `report.json`, exits 0 and writes a pass stamp carrying a `baseline` field when nothing is attributable, and `--stamp-status` reports `baselineAdjudicated: true, match: false, verifiedHead: true`. Prerequisite: `extract.js` learns node's `spec` reporter (the Node ≥20 default), which today sniffs as `generic` and yields no failing files on this repo's own `npm test` output.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-08T161427-record-3043/work/3043-spec.md`

## Global Constraints

- `verify.js` never reads `policy.yml` or `CLAUDE.md` — every command (including the per-file baseline template) is caller-supplied (`--baseline-cmd`), same Option-A boundary as `--cmd`.
- The runner is the ONLY stamp writer (#1921); an agent never writes a stamp.
- `report.json`'s `pass` keeps its raw meaning (every non-skipped check exited 0); the adjudication verdict lives only in `baselineAdjudicated`.
- `--stamp-status`'s `match` keeps its strict "clean full pass" meaning — a baseline-adjudicated stamp is `match: false`, `verifiedHead: true`.
- The legacy bare-SHA stamp twin is never written for a baseline-adjudicated pass (an older installed build would read it as a clean full pass).
- Fail closed: anything the adjudicator cannot classify with evidence (no extractable file, a fail-fast skip, a spawn error, a signal-killed base run) is never treated as "fails at base".
- `plugin/skills/review/code-mode-steps.md` is 41,859 bytes against the 46,080-byte shared ceiling — Task 5 may add at most ~400 bytes there. `plugin/skills/test/verification.md` is 30,636 bytes.
- Commit style: `{Verb} {what} — {detail}`, each commit message ending with `Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S`. Never `git stash`, never `git reset`.
- Worktree Bash guard: one plain command per Bash call; no heredocs; write commit messages to a file with the Write tool and use `git commit -F <file>`.
- Node 24 rejects a directory argument to `node --test` — always pass file paths.

## Review Focus

1. **Windows backslash paths in the spec reporter** (`test at tests\x.test.js:229:1`) must come back as repo-relative forward-slash paths, or nothing downstream (git `cat-file`, the template) can use them — Task 1 test.
2. **CRLF-terminated log lines** (`test at tests/x.test.js:1:1\r`) must still extract — Task 1 test.
3. **A base run killed by a signal or failing to spawn** (`exitCode: null`) must never classify the file as "fails at base" — it is attributable (fail closed) — Task 3 test.
4. **The scratch worktree is always removed**, including when a run throws mid-adjudication — Task 3 test.
5. **`--cwd <subdir>` runs**: failing files are relative to the subdir, so the base run's cwd and the `cat-file` path must both be offset by the subdir — Task 3 test.

---

### Task 1: node `spec` reporter family in extract.js

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js` (sniffFamily, extractFailingRegion, parseCounts, extractFailingFiles)
- Test: `tests/bin-lib/verify/extract.test.js` (append)

**Interfaces:**
- Produces: `sniffFamily(text)` may now return `'spec'`; `extractFailingFiles(text, 'spec', {cwd})` returns repo-relative forward-slash test paths from the `✖ failing tests:` section's `test at <path>:<line>:<col>` lines; `parseCounts(text, 'spec')` returns `{tests, pass, fail}` from `ℹ tests N` / `ℹ pass N` / `ℹ fail N`.

Real format (captured from this checkout's `npm test`, Node v24.11.1, `.git/worktrees/record-3040/claude-tweaks-verify/tests.log`):

```
ℹ tests 10565
ℹ suites 0
ℹ pass 10209
ℹ fail 349
...
✖ failing tests:

test at tests\apply-refine-labels.test.js:229:1
✖ run: --run given logs one AUTO decisions.md line per successfully-applied action, under /backlog (3.0502ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
```

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/verify/extract.test.js` (match the file's existing `require`/`test` style):

```js
const SPEC_LOG = [
  '✔ passes (1.2ms)',
  '✖ breaks (3.0ms)',
  'ℹ tests 4',
  'ℹ suites 0',
  'ℹ pass 2',
  'ℹ fail 2',
  'ℹ cancelled 0',
  '',
  '✖ failing tests:',
  '',
  'test at tests\\a.test.js:229:1',
  '✖ breaks (3.0ms)',
  '  AssertionError [ERR_ASSERTION]: nope',
  '      at TestContext.<anonymous> (C:\\repo\\plugin\\lib\\x.js:12:3)',
  '',
  'test at tests/sub/b.test.js:5:1',
  '✖ also breaks (1.0ms)',
  '',
  'test at tests\\a.test.js:300:1',
  '✖ second failure in a (1.0ms)',
].join('\n');

test('spec reporter: sniffed as its own family (#3043)', () => {
  assert.strictEqual(sniffFamily(SPEC_LOG), 'spec');
});

test('spec reporter: failing files come from the failing-tests section, forward-slash, deduped, log order — never a stack-frame source file (#3043)', () => {
  assert.deepStrictEqual(extractFailingFiles(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }), ['tests/a.test.js', 'tests/sub/b.test.js']);
});

test('spec reporter: CRLF-terminated lines still extract (#3043)', () => {
  const crlf = SPEC_LOG.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(extractFailingFiles(crlf, 'spec', { cwd: 'C:\\repo' }), ['tests/a.test.js', 'tests/sub/b.test.js']);
});

test('spec reporter: an absolute test-at path under cwd is relativized (#3043)', () => {
  const abs = SPEC_LOG.replace('test at tests\\a.test.js:229:1', 'test at C:\\repo\\tests\\c.test.js:1:1');
  assert.deepStrictEqual(extractFailingFiles(abs, 'spec', { cwd: 'C:\\repo' })[0], 'tests/c.test.js');
});

test('spec reporter: counts parse from the ℹ summary lines (#3043)', () => {
  assert.deepStrictEqual(parseCounts(SPEC_LOG, 'spec'), { tests: 4, pass: 2, fail: 2 });
});

test('spec reporter: missing ℹ fail line means counts null, never a guess (#3043)', () => {
  assert.strictEqual(parseCounts(SPEC_LOG.replace('ℹ fail 2\n', ''), 'spec'), null);
});

test('spec reporter: failing region starts at the failing-tests section (#3043)', () => {
  const region = extractFailingRegion(SPEC_LOG, 'spec');
  assert.ok(region.startsWith('✖ failing tests:'));
  assert.ok(region.includes('test at tests/sub/b.test.js:5:1'));
});

test('spec reporter: a passing spec log (no failing section) extracts no files (#3043)', () => {
  const passing = ['✔ ok (1ms)', 'ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'].join('\n');
  assert.strictEqual(sniffFamily(passing), 'spec');
  assert.deepStrictEqual(extractFailingFiles(passing, 'spec'), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/extract.test.js`
Expected: FAIL — `sniffFamily` returns `'generic'`.

- [ ] **Step 3: Implement** in `plugin/bin/lib/verify/extract.js`:

Add near the other marker constants:

```js
// node --test's `spec` reporter — the default since Node 20 (#3043). Its
// summary is `ℹ tests N` / `ℹ pass N` / `ℹ fail N`, and every failure is
// listed after `✖ failing tests:` as `test at <path>:<line>:<col>` followed by
// the failing test's name and diagnostics. Without this family the runner
// sniffed this repo's own `npm test` output as `generic` and named no file.
const SPEC_MARKERS = [/^ℹ tests \d+/m, /^✖ failing tests:/m];
const SPEC_TEST_AT_RE = /^test at (.+):\d+:\d+\s*$/;
```

`sniffFamily` — after the `summary` check, before `return 'generic'`:

```js
  if (SPEC_MARKERS.some((re) => re.test(text))) return 'spec';
```

`extractFailingRegion` — before the generic tail return:

```js
  if (family === 'spec') {
    const start = lines.findIndex((line) => /^✖ failing tests:/.test(line));
    if (start !== -1) return cap(lines.slice(start).map((line) => line.replace(/\r$/, '')));
  }
```

and normalize the backslash in the region? No — the region is display-only; leave paths as printed. (The test above asserts `tests/sub/b.test.js`, which is printed with `/` in the fixture.)

`parseCounts` — before the final `return null`:

```js
  if (family === 'spec') {
    const tests = num(text.match(/^ℹ tests (\d+)/m));
    const pass = num(text.match(/^ℹ pass (\d+)/m));
    const fail = num(text.match(/^ℹ fail (\d+)/m));
    if (tests === null || pass === null || fail === null) return null;
    return { tests, pass, fail };
  }
```

`extractFailingFiles` — before the final `return found`:

```js
  if (family === 'spec') {
    let inSection = false;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (/^✖ failing tests:/.test(line)) { inSection = true; continue; }
      if (!inSection) continue;
      const m = line.match(SPEC_TEST_AT_RE);
      if (m) push(m[1]);
    }
    return found;
  }
```

(`push` already relativizes against `cwd` and converts `\` to `/` via `relativize`, and filters to `TEST_FILE_RE`.) Update the file's header comment to name the `spec` family.

- [ ] **Step 4: Run to verify they pass, plus the module's neighbors**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/flaky.test.js`
Expected: PASS. If an existing test asserted `generic` for node-spec-shaped text, read it before changing anything — report it rather than silently rewriting it.

- [ ] **Step 5: Real-input probe (required, record the output in the task report)**

Run: `node .claude-tweaks/pipelines/2026-10-08T161427-record-3043/scratch/probe-extract.js C:/repos/claude-tweaks/.git/worktrees/record-3040/claude-tweaks-verify/tests.log C:/repos/claude-tweaks/.claude/worktrees/record-3040`
Expected (exact): `{"family":"spec","count":106,...}` — the independent count over the same file is `grep -o "test at [^ ]*\.test\.js" … | sort -u | wc -l` = **106**; counts must be `tests 10565, pass 10209, fail 349`. If the log is gone (the 3040 worktree was reaped), say so in the report instead of fabricating numbers.

- [ ] **Step 6: Commit** — `Teach the verify runner node's spec reporter — failing files and counts from the default Node 20+ output (#3043)`

---

### Task 2: `--baseline` / `--baseline-cmd` argument parsing

**Files:**
- Modify: `plugin/bin/lib/verify/args.js`
- Test: `tests/bin-lib/verify/args.test.js` (update the full-shape `deepStrictEqual` at line ~18, append new tests)

**Interfaces:**
- Produces: `parseArgs()` returns two new keys: `baseline` (string ref or `null`) and `baselineCmds` (array of `{name, template}`, `[]` when none).

Rules:
- `--baseline <ref>` and `--baseline-cmd <name>=<template>` are VALUE_FLAGS; `--baseline-cmd` repeatable.
- `--baseline` without any `--baseline-cmd`, or `--baseline-cmd` without `--baseline` → UsageError.
- Each `--baseline-cmd` `<name>` must match a declared `--cmd` name (resolved after the loop, like `--cmd-env`) → else UsageError naming it.
- Each template must contain the literal `{file}` → else UsageError.
- Duplicate `--baseline-cmd` name → UsageError.
- `--baseline`/`--baseline-cmd` with `--stamp-status` or `--changed-files` → UsageError.
- USAGE gains `[--baseline <ref> --baseline-cmd <name>=<template-with-{file}> ...]` in the check-run form.

- [ ] **Step 1: Write the failing tests** (append; and add `baseline: null, baselineCmds: []` to the existing full-shape expectation so it stays exact):

```js
test('--baseline with --baseline-cmd parses (#3043)', () => {
  const got = parseArgs(['--cmd', 'tests=npm test', '--baseline', 'origin/main', '--baseline-cmd', 'tests=node --test {file}']);
  assert.strictEqual(got.baseline, 'origin/main');
  assert.deepStrictEqual(got.baselineCmds, [{ name: 'tests', template: 'node --test {file}' }]);
});

test('--baseline without --baseline-cmd is a usage error (#3043)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--baseline', 'origin/main']), /--baseline requires at least one --baseline-cmd/);
});

test('--baseline-cmd without --baseline is a usage error (#3043)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--baseline-cmd', 'tests=node --test {file}']), /--baseline-cmd requires --baseline/);
});

test('--baseline-cmd naming no --cmd is a usage error (#3043)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--baseline', 'x', '--baseline-cmd', 'web=node --test {file}']), /--baseline-cmd "web" names no declared --cmd/);
});

test('--baseline-cmd template without {file} is a usage error (#3043)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--baseline', 'x', '--baseline-cmd', 'tests=npm test']), /must contain \{file\}/);
});

test('duplicate --baseline-cmd name is a usage error (#3043)', () => {
  assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--baseline', 'x', '--baseline-cmd', 'tests=a {file}', '--baseline-cmd', 'tests=b {file}']), /duplicate --baseline-cmd name: tests/);
});

test('--baseline is rejected with --stamp-status and --changed-files (#3043)', () => {
  assert.throws(() => parseArgs(['--stamp-status', '--baseline', 'x']), /--baseline/);
  assert.throws(() => parseArgs(['--changed-files', '--baseline', 'x']), /--baseline/);
});
```

- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/args.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** — add `'--baseline', '--baseline-cmd'` to `VALUE_FLAGS`; `let baseline = null; const baselineCmds = [];` in the loop (`--baseline-cmd` parsed as `<name>=<template>` split on the first `=`, same name regex as `--cmd`); after the `--cmd-env` resolution block add the validation listed above, checking the mode-conflict rule first (`if ((stampStatus || changedFiles) && (baseline !== null || baselineCmds.length)) throw new UsageError('--baseline/--baseline-cmd apply to a check run — not to --stamp-status or --changed-files');`), then `--baseline requires at least one --baseline-cmd`, `--baseline-cmd requires --baseline`, unknown name, `{file}`, duplicate. Return both keys. Note `--stamp-status --baseline x` must reach the mode-conflict message, not the "at least one --cmd" one — order the checks so it does.
- [ ] **Step 4: Run** `node --test tests/bin-lib/verify/args.test.js tests/bin-lib/verify/snippet-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Parse --baseline and --baseline-cmd in the verify runner — per-file template caller-supplied, validated up front (#3043)`

---

### Task 3: `baseline.js` — the adjudicator

**Files:**
- Create: `plugin/bin/lib/verify/baseline.js`
- Test: `tests/bin-lib/verify/baseline.test.js`

**Interfaces:**
- Consumes: `extract.js`'s `sniffFamily`, `extractFailingFiles`, `stripAnsi` (Task 1); `run.js`'s `runOne({name, command, logDir, spawnImpl, now, cwd, env})` shape (injected, never required directly, so tests can fake it).
- Produces:
  - `realGit(cwd) -> { repoRoot(), resolveCommit(ref) -> sha|null, fileExistsAt(sha, repoRelPath) -> bool, addWorktree(sha) -> dir, removeWorktree(dir) }`
  - `async adjudicate({ checks, baselineCmds /* Map name->template */, base, baseSha, cwd /* string|null */, logDir, runOne, spawnImpl, now, envOf = () => null, git, concurrency = 4 })` →
    - ineligible: `{ base, baseSha, eligible: false, reason }`
    - eligible: `{ base, baseSha, eligible: true, verdict: 'pass'|'fail', failingFiles, baselineFailing, flakyPassed, attributable }` (each an array of cwd-relative forward-slash paths, log order)

- [ ] **Step 1: Write the failing tests** — `tests/bin-lib/verify/baseline.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { adjudicate } = require('../../../plugin/bin/lib/verify/baseline');

function logFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-test-'));
  const p = path.join(dir, 'tests.log');
  fs.writeFileSync(p, text);
  return { dir, p };
}

const SPEC = (files) => ['ℹ tests 9', 'ℹ pass 1', `ℹ fail ${files.length}`, '', '✖ failing tests:', '',
  ...files.flatMap((f) => [`test at ${f}:1:1`, '✖ x (1ms)', ''])].join('\n');

// outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/b.test.js': 0, ... } — exit code per (kind, file)
function fakes({ outcomes, existsAtBase = () => true, throwOn = null }) {
  const calls = { runs: [], added: [], removed: [] };
  const git = {
    repoRoot: () => '/repo',
    fileExistsAt: (sha, f) => existsAtBase(f),
    addWorktree: (sha) => { calls.added.push(sha); return '/scratch'; },
    removeWorktree: (dir) => { calls.removed.push(dir); },
  };
  const runOne = async ({ name, command, cwd }) => {
    const kind = name.includes('-baseline-') ? 'baseline' : 'isolated';
    const file = command.replace('node --test ', '');
    calls.runs.push({ kind, file, cwd });
    if (throwOn && throwOn === `${kind}:${file}`) throw new Error('boom');
    const code = outcomes[`${kind}:${file}`];
    return { name, command, exitCode: code === undefined ? 1 : code, durationMs: 1, logPath: 'x' };
  };
  return { git, runOne, calls };
}

const tmpl = new Map([['tests', 'node --test {file}']]);

test('every failing file also fails at base → verdict pass, nothing re-run at HEAD (#3043 AC1)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, true);
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js', 'tests/b.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(calls.runs.filter((c) => c.kind === 'isolated'), []);
  assert.deepStrictEqual(calls.runs.map((c) => c.cwd), ['/scratch', '/scratch']);
  assert.deepStrictEqual(calls.removed, ['/scratch']);
});

test('a file passing at base and failing in isolation at HEAD is attributable → verdict fail (#3043 AC2)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'fail');
  assert.deepStrictEqual(r.attributable, ['tests/b.test.js']);
});

test('a file passing at base and passing in isolation at HEAD is flaky, not attributable (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/b.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 0 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.flakyPassed, ['tests/b.test.js']);
});

test('a failing file absent at base skips the base run and is attributable unless it passes in isolation (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/new.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'isolated:tests/new.test.js': 1 }, existsAtBase: () => false });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.attributable, ['tests/new.test.js']);
  assert.deepStrictEqual(calls.added, [], 'no scratch worktree when no failing file exists at base');
});

test('Review Focus 3: a base run killed by a signal (exitCode null) never counts as failing at base (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': null, 'isolated:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('Review Focus 4: the scratch worktree is removed even when a run throws (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: {}, throwOn: 'baseline:tests/a.test.js' });
  await assert.rejects(adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git }), /boom/);
  assert.deepStrictEqual(calls.removed, ['/scratch']);
});

test('Review Focus 5: a --cwd subdir offsets both the base cwd and the cat-file path (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const seen = [];
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 }, existsAtBase: (f) => { seen.push(f); return true; } });
  await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: path.join('/repo', 'packages', 'app'), logDir: dir, runOne, git });
  assert.deepStrictEqual(seen, ['packages/app/tests/a.test.js']);
  assert.strictEqual(calls.runs[0].cwd, path.join('/scratch', 'packages', 'app'));
});

test('ineligible: a fail-fast skip, a spawn error, a missing template, or no extractable file (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { p: generic } = logFile('something went wrong\n');
  const { git, runOne } = fakes({ outcomes: {} });
  const base = { baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git };
  assert.match((await adjudicate({ ...base, checks: [{ name: 'lint', exitCode: 1, logPath: p }] })).reason, /no --baseline-cmd for failing check lint/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', skipped: 'fail-fast' }] })).reason, /tests skipped/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', exitCode: null, spawnError: 'ENOENT', logPath: p }] })).reason, /could not spawn/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', exitCode: 1, logPath: generic }] })).reason, /no-parse/);
});

test('passing checks are ignored — only failed ones are adjudicated (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'lint', exitCode: 0, logPath: 'unused' }, { name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
});
```

- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/baseline.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `plugin/bin/lib/verify/baseline.js`:

```js
// plugin/bin/lib/verify/baseline.js — baseline adjudication (#3043). When a
// check fails on a checkout with a known environment-specific failure baseline
// (a Windows dev checkout's separator/CRLF failures), this re-runs only the
// failing test files: at the base commit in a scratch detached worktree, and
// — for files passing at base or absent there — once more in isolation at
// HEAD. A file failing at base is baseline; one passing in isolation at HEAD
// is flaky; the rest are attributable. Fails closed: anything not classified
// with evidence (no extractable file, a fail-fast skip, a spawn error, a
// base run with no numeric exit) is never "fails at base". git and runOne are
// injected so the tests never touch a real repo; realGit is the CLI's seam.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sniffFamily, extractFailingFiles, stripAnsi } = require('./extract');

function realGit(cwd) {
  const git = (args) => String(execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })).trim();
  return {
    repoRoot: () => git(['rev-parse', '--show-toplevel']),
    resolveCommit: (ref) => {
      try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null; } catch { return null; }
    },
    fileExistsAt: (sha, file) => {
      try { git(['cat-file', '-e', `${sha}:${file}`]); return true; } catch { return false; }
    },
    addWorktree: (sha) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-'));
      const dir = path.join(parent, 'wt');
      git(['worktree', 'add', '--detach', dir, sha]);
      return dir;
    },
    removeWorktree: (dir) => {
      try { git(['worktree', 'remove', '--force', dir]); } catch { /* best effort — rm below */ }
      try { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* best effort */ }
      try { git(['worktree', 'prune']); } catch { /* best effort */ }
    },
  };
}

// The same `/` → `+` log-name slug flaky.js's retryLogName uses, so two
// files never share a log path.
function slug(file) { return file.replace(/[\\/]/g, '+'); }

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function adjudicate({
  checks, baselineCmds, base, baseSha, cwd = null, logDir, runOne, spawnImpl, now = Date.now,
  envOf = () => null, git, concurrency = 4,
}) {
  const header = { base, baseSha };
  const work = [];
  const headDir = cwd || process.cwd();
  for (const c of checks.filter((x) => x.skipped || x.exitCode !== 0)) {
    if (c.skipped) return { ...header, eligible: false, reason: `${c.name} skipped (${c.skipped})` };
    if (c.spawnError !== undefined) return { ...header, eligible: false, reason: `${c.name} could not spawn` };
    const template = baselineCmds.get(c.name);
    if (!template) return { ...header, eligible: false, reason: `no --baseline-cmd for failing check ${c.name}` };
    let text;
    try { text = stripAnsi(fs.readFileSync(c.logPath, 'utf8')); } catch {
      return { ...header, eligible: false, reason: `${c.name} log unreadable` };
    }
    const files = extractFailingFiles(text, sniffFamily(text), { cwd: headDir });
    if (files.length === 0) return { ...header, eligible: false, reason: `no-parse: no failing test file extractable from ${c.name}` };
    for (const file of files) work.push({ check: c.name, file, command: template.replace(/\{file\}/g, file) });
  }

  // A --cwd subdir: failing files are relative to it, so the base-side path
  // and cwd are offset by the same subdir (Review Focus 5).
  const sub = path.relative(git.repoRoot(), headDir).replace(/\\/g, '/');
  const repoRel = (file) => (sub ? `${sub}/${file}` : file);
  const atBase = work.map((w) => git.fileExistsAt(baseSha, repoRel(w.file)));
  let scratch = null;
  const run = (w, kind, dir) => runOne({
    name: `${w.check}-${kind}-${slug(w.file)}`, command: w.command, logDir, spawnImpl, now, cwd: dir, env: envOf(w.check),
  });
  try {
    if (atBase.some(Boolean)) scratch = git.addWorktree(baseSha);
    const baseDir = scratch && (sub ? path.join(scratch, ...sub.split('/')) : scratch);
    const baseRuns = await pool(work, concurrency, (w, k) => (atBase[k] ? run(w, 'baseline', baseDir) : null));
    // Only a numeric non-zero exit is evidence of failing at base (Review Focus 3).
    const failsAtBase = baseRuns.map((r) => r !== null && typeof r.exitCode === 'number' && r.exitCode !== 0);
    const headRuns = await pool(work, concurrency, (w, k) => (failsAtBase[k] ? null : run(w, 'isolated', cwd)));
    const baselineFailing = [];
    const flakyPassed = [];
    const attributable = [];
    work.forEach((w, k) => {
      if (failsAtBase[k]) baselineFailing.push(w.file);
      else if (headRuns[k] && headRuns[k].exitCode === 0) flakyPassed.push(w.file);
      else attributable.push(w.file);
    });
    return {
      ...header,
      eligible: true,
      verdict: attributable.length === 0 ? 'pass' : 'fail',
      failingFiles: work.map((w) => w.file),
      baselineFailing,
      flakyPassed,
      attributable,
    };
  } finally {
    if (scratch) git.removeWorktree(scratch);
  }
}

module.exports = { adjudicate, realGit };
```

Note the test at "a --cwd subdir" passes `cwd: path.join('/repo','packages','app')` with `repoRoot: () => '/repo'` — `path.relative` gives `packages\app` on win32 and `packages/app` on POSIX; the `.replace(/\\/g,'/')` makes both `packages/app`.

- [ ] **Step 4: Run** `node --test tests/bin-lib/verify/baseline.test.js` — Expected: PASS (all 10).
- [ ] **Step 5: Commit** — `Add the verify runner's baseline adjudicator — failing files re-run at base in a scratch worktree and in isolation at HEAD (#3043)`

---

### Task 4: wire `--baseline` into verify.js, report.json, the stamp, and `--stamp-status`

**Files:**
- Modify: `plugin/bin/verify.js`, `plugin/bin/lib/verify/report.js` (`composeReport` gains optional `baselineAdjudicated`), `plugin/bin/lib/verify/stamp.js` (`composeStamp` gains optional `baseline`, included only when non-null)
- Test: `tests/bin-lib/verify/cli.test.js` (append), `tests/bin-lib/verify/report.test.js` / `stamp.test.js` (append one test each)

**Interfaces:**
- Consumes: Task 2's `parsed.baseline` / `parsed.baselineCmds`; Task 3's `adjudicate`, `realGit`.
- Produces: `report.json` → `baselineAdjudicated` object (omitted when no adjudication ran); pass stamp → `baseline: { base, baseSha, baselineFailing, flakyPassed }` (omitted otherwise); `--stamp-status` JSON → new `baselineAdjudicated` boolean.

Return-shape widening check: before editing, `grep -n "deepStrictEqual" tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/report.test.js tests/bin-lib/verify/cli.test.js` and `grep -rn "stamp-status" tests --include=*.js -l` — every whole-object equality on the stamp-status JSON must gain `baselineAdjudicated: false`; `composeStamp`/`composeReport` outputs stay byte-identical for callers that pass no new argument (keys omitted when null — that is why).

Wiring in `verify.js`:
1. After `parseArgs`, before the run (right after the `ownGitDir`/logDir setup): if `parsed.baseline`, build `const bgit = realGit(parsed.cwd || process.cwd()); const baseSha = bgit.resolveCommit(parsed.baseline);` — `null` → `process.stderr.write(\`--baseline: ${parsed.baseline} does not resolve to a commit\n${USAGE}\n\`); process.exitCode = 2; return;` **before any check runs**.
2. After `results` is computed: `const rawPass = results.filter((c) => !c.skipped).every((c) => c.exitCode === 0);` and, when `parsed.baseline && !rawPass`: `baselineAdjudicated = await adjudicate({ checks: results, baselineCmds: new Map(parsed.baselineCmds.map((b) => [b.name, b.template])), base: parsed.baseline, baseSha, cwd: parsed.cwd, logDir, runOne, envOf, git: bgit });` (`runOne` is already imported from `./lib/verify/run`).
3. `composeReport({... , baselineAdjudicated })` — `report.js` sets `report.baselineAdjudicated` only when non-null. `report.pass` unchanged (raw).
4. `const adjudicatedPass = Boolean(baselineAdjudicated && baselineAdjudicated.verdict === 'pass'); const effectivePass = report.pass || adjudicatedPass;` — the stamp condition uses `effectivePass` in place of `report.pass`; `composeStamp({..., baseline: adjudicatedPass ? { base, baseSha, baselineFailing, flakyPassed } : null })`; `writeStamp(gitDir, stamp, { legacy: mode === 'full' && !adjudicatedPass })`.
5. stdout, after the flaky caveat lines and before `report:`: eligible → `Baseline: adjudicated against {base} ({baseSha first 9}) — {n} failing file(s): {b} also fail at base, {f} flaky (passed in isolation), {a} attributable`, then one `ATTRIBUTABLE: {file}` line per attributable file; ineligible → `Baseline: not adjudicated — {reason}`.
6. `process.exitCode = effectivePass ? 0 : 1;`
7. `stampStatus()`: `const baselineAdjudicated = present && stamp.baseline !== null && typeof stamp.baseline === 'object';` — `match` becomes `stampCoversCleanHead && scope === 'full' && !baselineAdjudicated`; `verifiedHead` unchanged; add `baselineAdjudicated` to the printed object right after `verifiedHead`. Update the comment block above `match`.
8. The `verify` event (`appendEvent`) gains `baselineAdjudicated: baselineAdjudicated ? baselineAdjudicated.verdict || 'ineligible' : null` — `pass` stays raw.

- [ ] **Step 1: Write the failing CLI tests** — append to `tests/bin-lib/verify/cli.test.js` (reuse its `tmpGitRepo`, `runCli`, `tmpDir`). Use TAP output (`--test-reporter=tap`) in fixtures so the test is independent of the Node version's spec-reporter format (CI runs Node 20):

```js
// #3043: a repo whose base commit already carries a failing test file.
function baselineRepo() {
  const r = tmpGitRepo();
  fs.mkdirSync(path.join(r.repo, 'tests'));
  fs.writeFileSync(path.join(r.repo, 'tests', 'env.test.js'), "require('node:test')('env', () => { throw new Error('env-specific'); });\n");
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'base');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  return { ...r, baseSha };
}
const SUITE = 'tests=node --test --test-reporter=tap tests/env.test.js tests/ok.test.js';
const PER_FILE = 'tests=node --test --test-reporter=tap {file}';

test('--baseline: failures that also fail at base exit 0, stamp a baseline pass, and --stamp-status says verifiedHead (#3043 AC1)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'README.md'), 'change\n');
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'head');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], { cwd: r.repo });
  assert.strictEqual(code, 0, stdout);
  assert.match(stdout, /Baseline: adjudicated against .* 1 also fail at base, 0 flaky \(passed in isolation\), 0 attributable/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, false);
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.attributable, []);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.verifiedHead, true);
  assert.strictEqual(status.match, false);
  assert.strictEqual(status.baselineAdjudicated, true);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass')), 'no legacy twin for an adjudicated pass');
});

test('--baseline: a file that passes at base but fails at HEAD exits 1 naming it, and writes no stamp (#3043 AC2)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => { throw new Error('regressed'); });\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'break ok');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /ATTRIBUTABLE: tests\/ok\.test\.js/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('--baseline: an unresolvable ref exits 2 before any check runs (#3043)', async () => {
  const r = baselineRepo();
  const { code, stderr } = await runCli(['--cmd', SUITE, '--baseline', 'no-such-ref', '--baseline-cmd', PER_FILE], { cwd: r.repo });
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline: no-such-ref does not resolve to a commit/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'tests.log')));
});

test('--baseline: a passing run never adjudicates and stamps exactly as before (#3043)', async () => {
  const r = baselineRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test tests/ok.test.js', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], { cwd: r.repo });
  assert.strictEqual(code, 0);
  assert.doesNotMatch(stdout, /Baseline:/);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.match, true);
  assert.strictEqual(status.baselineAdjudicated, false);
});

test('--baseline: a failing check with no extractable file is not adjudicated and exits 1 (#3043)', async () => {
  const r = baselineRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=node -e "process.exit(3)"', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /Baseline: not adjudicated — no-parse/);
});

test('--baseline: the scratch worktree is gone after the run (#3043)', async () => {
  const r = baselineRepo();
  await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], { cwd: r.repo });
  const list = r.git('worktree', 'list', '--porcelain');
  assert.strictEqual((list.match(/^worktree /gm) || []).length, 1, list);
});
```

Plus in `stamp.test.js`: `composeStamp` with no `baseline` argument has no `baseline` key; with one, carries it. In `report.test.js`: `composeReport` with no `baselineAdjudicated` has no such key; with one, carries it.

- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/report.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** items 1-8 above.
- [ ] **Step 4: Run** `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/report.test.js tests/bin-lib/verify/args.test.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/snippet-conformance.test.js tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/bin-lib/wrap-up/engine-verify.test.js` — Expected: PASS (the last three consume stamp-status JSON; confirm a new field breaks none of them).
- [ ] **Step 5: Commit** — `Wire baseline adjudication into the verify runner — report field, baseline-marked pass stamp, stamp-status verifiedHead (#3043)`

---

### Task 5: contracts and docs — verification.md, review Step 1.5, plugin-structure

**Files:**
- Modify: `plugin/skills/test/verification.md` (new `### Baseline adjudication (#3043)` subsection after "Isolating pre-existing failures by file, not by keyword grep"; Foreground rule exception; one clause in Skip-if-recent's stamp bullet; one clause in Step 2.5's stamp description)
- Modify: `plugin/skills/review/code-mode-steps.md` Step 1.5 (≤ ~400 bytes total)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/verify/` row at ~line 51: add `baseline.js` and the extract.js `spec` family; the `node plugin/bin/verify.js …` command line at ~line 153: add the two flags and the `baselineAdjudicated` stamp-status field)

Byte pins: before editing, `grep -rln "verification.md\|code-mode-steps" tests --include=*.js` and, for each hit, grep for `byteLength|wc -c|46080|CEILING` — record each pin and its headroom in the task report. Moved-prose check: this task moves no prose; it only adds — do not reword existing sentences (pins assert them by content).

Text to add (adapt only for flow; keep every fact):

**verification.md — new subsection:**

```markdown
### Baseline adjudication (#3043)

On a checkout whose suite carries a known environment-specific failure baseline (a Windows dev checkout's path-separator and CRLF failures), the runner adjudicates a failing run against the integration branch itself — this replaces the hand-run by-file comparison above for pipeline sites. Pipeline sites (`$PIPELINE_RUN_DIR` set: Build Common Step 5 and every scoped site in the Re-verify scoping table) append, for each check `.claude-tweaks/verify-scope.json` gives a `retry.{check}` template, `--baseline origin/{integration-branch} --baseline-cmd {check}="{template}"` — in this repo:

    node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --run "$PIPELINE_RUN_DIR" --cmd tests="npm test" --baseline origin/main --baseline-cmd tests="node --test {file}"

Standalone runs never pass it — a human asked for the suite. No `retry` template → no `--baseline`; the by-file procedure above still applies. A passing run is unaffected; adjudication runs only when a check fails. The runner then takes each failing check's failing test files (a fail-fast skip, a spawn error, a check with no `--baseline-cmd`, or no extractable file → `Baseline: not adjudicated — {reason}`, exit 1), runs each file that exists at the base in a scratch detached worktree of the base commit, and re-runs once in isolation at HEAD every file that passed at base or is new. Fails at base → baseline; passes in isolation at HEAD → flaky; anything else → attributable. No attributable file → exit 0 and a pass stamp carrying `baseline: {base, baseSha, baselineFailing, flakyPassed}` (no legacy bare-SHA twin); `report.json` records `baselineAdjudicated: {base, baseSha, eligible, verdict, failingFiles, baselineFailing, flakyPassed, attributable}` while `pass` stays the raw `false`. Any attributable file → exit 1, each named on an `ATTRIBUTABLE:` line. `--stamp-status` then reads `baselineAdjudicated: true`, `match: false`, `verifiedHead: true`, so Skip-if-recent and `/claude-tweaks:review` Step 1.5 accept the stamp and the re-trigger rule terminates. An unresolvable `--baseline` ref exits 2 before any check runs. The stamp says this branch added no failure — not that the suite is green; the hosted CI check stays the authoritative gate.
```

(Use the indented-code form above or a fenced ```bash block — check `tests/bin-lib/verify/snippet-conformance.test.js` first: if it parses every fenced `verify.js` snippet with `parseArgs`, a fenced block is right and must parse; Task 2's validation accepts it.)

**verification.md — Foreground rule, append:**

```markdown
One exception, for the orchestrating session only: when the full resolved set is known to run past the calling tool's foreground ceiling (Claude Code's Bash tool caps a foreground call at 600s; this repo's full `npm test` takes ~16 minutes on a Windows checkout), run the same single command with `run_in_background`, then do not end the turn or start anything that depends on its result until the completion notification arrives, and read the outcome from the runner's stdout and `report.json`. A dispatched subagent never backgrounds it — its turn cannot wait on a notification — and a second attempt never starts while the first runs.
```

**verification.md — Skip-if-recent stamp bullet:** after "`verifiedHead: true` (a clean HEAD covered by a full pass — `match: true` —" insert "or by a baseline-adjudicated pass (Baseline adjudication below; `match: false`)," — keep the rest of the sentence intact.

**verification.md — Step 2.5:** after the sentence ending "rewrites the legacy twin." add: "A baseline-adjudicated pass (#3043) adds `baseline: {base, baseSha, baselineFailing, flakyPassed}` and never rewrites the legacy twin."

**code-mode-steps.md Step 1.5, pipeline paragraph:** change "`verifiedHead: true` (a clean HEAD covered by a full pass, or by a passing scoped run anchored on a still-valid `fullSha`" to "`verifiedHead: true` (a clean HEAD covered by a full pass — a baseline-adjudicated one included, `test/verification.md`'s Baseline adjudication — or by a passing scoped run anchored on a still-valid `fullSha`" — the first occurrence only (the pipeline bullet); leave the standalone bullet unchanged.

- [ ] **Step 1:** Grep the pins (above) and record them.
- [ ] **Step 2:** Make the four verification.md edits, the code-mode-steps edit, and the two plugin-structure edits.
- [ ] **Step 3: Run** every test file the Step 1 grep found, plus `node --test tests/bin-lib/verify/snippet-conformance.test.js tests/review-step1-5-verifiedhead-gate.test.js tests/verification-skip-before-execute.test.js tests/verification-flake-handling.test.js tests/bin-lib/skill-audit/context-cost.test.js` — Expected: PASS. `wc -c plugin/skills/review/code-mode-steps.md` must stay under 46,080.
- [ ] **Step 4: Commit** — `Document baseline adjudication in the verification contract — pipeline sites pass --baseline, review Step 1.5 accepts the stamp, over-ceiling runs background in the orchestrator only (#3043)`

---

## Self-review notes

- Spec Deliverable 1 → Tasks 2-4 (`verify.js --baseline <ref>`, scratch worktree, subset rule after flake re-runs, `report.json` `baselineAdjudicated`). Deliverable 2 → Task 4 item 7 + Task 5 (verification.md, code-mode-steps.md Step 1.5). Deliverable 3 → Task 5 Foreground rule.
- AC1 → Task 4 CLI test 1 (exit 0, `verifiedHead: true`). AC2 → Task 4 CLI test 2. AC3 → Task 5's pipeline-site rule (Build Common Step 5 passes `--baseline`, an adjudicated pass exits 0 so build sets `VERIFICATION_PASSED`/`VERIFICATION_SHA` and `/test` skips per Skip-if-recent) — proven live by this build's own Common Step 5 run on this Windows checkout (the real-input probe for the whole feature).
- Prerequisite found at authoring time (real-input probe on the #3040 run's `tests.log`): this repo's `npm test` output sniffs `generic` → `extractFailingFiles` returns `[]` → every adjudication would be `no-parse`. Task 1 fixes it; Task 1 Step 5 pins the exact numbers (106 files; 10565/10209/349).
