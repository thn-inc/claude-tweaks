# Premise-check filing-time self-validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a harness-health finding's composed `Premise-check:` command once at filing time and drop the line unless it currently exits 0 ("still unresolved"), so a generic anchor can no longer auto-close a finding whose work was never done.

**Architecture:** A new stateful helper `plugin/bin/lib/health-core/premise-self-check.js` executes one composed command via `/bin/sh -c` from the repo root with a bounded 5 s timeout and an injectable runner. `toIssuePayload` gains an optional 4th `options` argument carrying a `premiseSelfCheck(command) -> boolean` callback; absent, behavior is byte-identical to today (so its unit tests never spawn shells). `bin/harness-health.js`'s `cmdValidateFindings` is the one production caller that injects the real check.

**Tech Stack:** Node 18+, `node:test`, `child_process.execFileSync`.

**Spec:** `.claude-tweaks/pipelines/2026-09-30T190052-spec-2633-2664/spec-2633/work/2633-spec.md` (record #2633)

## Global Constraints

- `buildPremiseCheck` stays pure and unchanged; `MAX_PREMISE_ANCHOR_LENGTH` (400) and its anchor-eligibility rules are not touched; no length or specificity floor is added.
- Timeout matches `plugin/bin/materialize.js`'s `PREMISE_CHECK_TIMEOUT_MS` (5000 ms); interpreter matches materialize's `runPremiseCheckDefault` (`/bin/sh`, `-c`, `stdio: 'ignore'`).
- A timeout or spawn error while self-checking omits the line (fail toward "no auto-close") — never keeps it.
- A kept line is byte-identical to what `buildPremiseCheck` produces today.
- The new module is NOT added to `tests/bin-lib/health-core/purity.test.js`'s `PURE_MODULES` (it requires `child_process` by design).
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01SVHow4R2CEesmDt5hC3M1r`. Commit messages reference `#2633` with "refs", never a closing keyword.

## Review Focus

1. A hung command (e.g. a pathological grep on a huge file) must be killed at the timeout and treated as "drop", not block filing — pinned by Task 1's real-shell `sleep` test.
2. A target path containing a space must still self-check correctly (shQuote'd path) — pinned by Task 1's real-shell tests, which use a temp dir whose name contains a space.
3. `/bin/sh` absent / spawn failure must read as "drop", never crash `validate-findings` — pinned by Task 1's fake-runner spawn-error test.
4. A finding whose target differs from `--target/--kind` (no `path`) must never invoke the self-check at all — pinned by Task 2's spy test (not invoked when no command composes).
5. A removal-intent finding whose old string is already gone at filing time must be filed without the line — pinned by Task 3's CLI removal test.

Behavioral claim trace: "the filed finding carries no `Premise-check:` line" is produced by `toIssuePayload` passing `premiseCheck: undefined` to `specShapedBody` (`plugin/bin/lib/issues/record.js:875` — `if (!isEmpty(premiseCheck)) parts.push(...)`), verified by Task 2's and Task 3's body assertions.

---

### Task 1: `premise-self-check.js` helper

**Files:**
- Create: `plugin/bin/lib/health-core/premise-self-check.js`
- Test: `tests/bin-lib/health-core/premise-self-check.test.js`

**Interfaces:**
- Consumes: `buildPremiseCheck(finding, targetPath)` from `plugin/bin/lib/harness-health/issue-payload.js` (tests only, to compose a real command).
- Produces: `premiseReadsUnresolved(command, { root, runner, timeoutMs }) -> boolean` — `true` only when the command exited 0; `false` on non-zero exit, timeout, or spawn error. `runner(command, { cwd, timeoutMs }) -> number` returns the exit code and throws when no exit code exists. Also exports `defaultRunner` and `PREMISE_SELF_CHECK_TIMEOUT_MS` (5000).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  premiseReadsUnresolved, defaultRunner, PREMISE_SELF_CHECK_TIMEOUT_MS,
} = require('../../../plugin/bin/lib/health-core/premise-self-check');
const { buildPremiseCheck } = require('../../../plugin/bin/lib/harness-health/issue-payload');

// Temp dir name deliberately contains a space — the composed command
// shQuotes the target path, and this proves the quoting survives a real shell.
function tmpWithSpace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'premise self-check-')); }

test('exit 0 reads as unresolved (keep the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 0 }), true);
});

test('a non-zero exit reads as resolved (drop the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 1 }), false);
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 2 }), false);
});

test('a timeout drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ETIMEDOUT'); e.code = 'ETIMEDOUT'; e.signal = 'SIGTERM'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('a spawn error drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ENOENT'); e.code = 'ENOENT'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('the runner receives the command, the root as cwd, and the timeout', () => {
  const calls = [];
  premiseReadsUnresolved('echo hi', { root: '/some/root', runner: (c, o) => { calls.push([c, o]); return 0; } });
  assert.deepStrictEqual(calls, [['echo hi', { cwd: '/some/root', timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS }]]);
});

test('the timeout matches materialize.js (5000 ms)', () => {
  assert.strictEqual(PREMISE_SELF_CHECK_TIMEOUT_MS, 5000);
});

test('real shell: an additive check whose anchor already appears in the target file is dropped', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/session.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
});

test('real shell: an additive check whose anchor is absent reads unresolved and is kept', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/login.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
});

test('real shell: a hung command is killed at the timeout and dropped', () => {
  const dir = tmpWithSpace();
  const start = Date.now();
  assert.strictEqual(premiseReadsUnresolved('sleep 5', { root: dir, timeoutMs: 100 }), false);
  assert.ok(Date.now() - start < 4000, 'must not wait for the full sleep');
});

test('defaultRunner returns the exit code of a command that ran', () => {
  assert.strictEqual(defaultRunner('exit 0', { cwd: os.tmpdir(), timeoutMs: 5000 }), 0);
  assert.strictEqual(defaultRunner('exit 3', { cwd: os.tmpdir(), timeoutMs: 5000 }), 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/health-core/premise-self-check.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/health-core/premise-self-check'"

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';

// Filing-time self-validation of a composed Premise-check: command (#2633).
// A health skill composes the command (harness-health's buildPremiseCheck —
// pure, never executes); this module runs it ONCE, before filing, so a
// command that already reads "resolved" (non-zero) is dropped instead of
// auto-closing the record at its first materialize (#2621's M2). Lives in
// health-core, not harness-health, so the other three health skills reuse it
// verbatim if they ever gain a Premise-check: composer. Stateful (spawns a
// shell) — deliberately NOT in tests/bin-lib/health-core/purity.test.js's
// PURE_MODULES.
const { execFileSync } = require('child_process');

// Mirrors plugin/bin/materialize.js's PREMISE_CHECK_TIMEOUT_MS — the same
// command runs there later, under the same bound.
const PREMISE_SELF_CHECK_TIMEOUT_MS = 5000;

// command, { cwd, timeoutMs } -> exit code. Same shape as materialize.js's
// runPremiseCheckDefault: a non-zero exit is a normal outcome (unwrapped
// from execFileSync's throw); no exit code at all (timeout, spawn error)
// re-throws.
function defaultRunner(command, { cwd, timeoutMs }) {
  try {
    execFileSync('/bin/sh', ['-c', command], { cwd, stdio: 'ignore', timeout: timeoutMs });
    return 0;
  } catch (err) {
    if (typeof err.status === 'number') return err.status;
    throw err;
  }
}

// true only when the command exited 0 — the "premise still unresolved"
// reading a Premise-check: line must have at filing time to be worth
// keeping. Every other outcome (non-zero, timeout, spawn error) is false:
// fail toward "no auto-close", never toward keeping a line that may fire.
function premiseReadsUnresolved(command, {
  root, runner = defaultRunner, timeoutMs = PREMISE_SELF_CHECK_TIMEOUT_MS,
} = {}) {
  try {
    return runner(command, { cwd: root, timeoutMs }) === 0;
  } catch {
    return false;
  }
}

module.exports = { premiseReadsUnresolved, defaultRunner, PREMISE_SELF_CHECK_TIMEOUT_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/health-core/premise-self-check.test.js tests/bin-lib/health-core/purity.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/health-core/premise-self-check.js tests/bin-lib/health-core/premise-self-check.test.js
git commit -m "Add health-core premise-self-check helper — run a composed Premise-check once, keep only on exit 0 (refs #2633)" -m "Claude-Session: https://claude.ai/code/session_01SVHow4R2CEesmDt5hC3M1r"
```

### Task 2: `toIssuePayload` drops a self-check-failing `Premise-check:` line

**Files:**
- Modify: `plugin/bin/lib/harness-health/issue-payload.js:75-146` (`toIssuePayload` signature + the `premiseCheck` composition at line 129)
- Test: `tests/bin-lib/harness-health/issue-payload.test.js` (append after the existing `// ── Premise-check threading (#2621)` block, i.e. after the test at line ~398)

**Interfaces:**
- Consumes: nothing from Task 1 directly (the callback is injected).
- Produces: `toIssuePayload(finding, verifiedAsOf, pluginVersion, options = {})` where `options.premiseSelfCheck: (command: string) => boolean`. Called at most once, only when `buildPremiseCheck` composed a command; `false` omits the line; `true` or an absent callback keeps it unchanged.

- [ ] **Step 1: Write the failing test**

```js
// ── Filing-time self-check (#2633) ──────────────────────────────────────────

test('toIssuePayload drops the Premise-check: line when the injected self-check reads it as not unresolved', () => {
  const p = toIssuePayload(patchFinding({ path: '/tmp/x.md' }), undefined, undefined, { premiseSelfCheck: () => false });
  assert.ok(!p.body.includes('Premise-check:'), `expected no Premise-check: line, got:\n${p.body}`);
});

test('toIssuePayload keeps a byte-identical Premise-check: line when the injected self-check passes', () => {
  const finding = patchFinding({ path: '/tmp/x.md' });
  const p = toIssuePayload(finding, undefined, undefined, { premiseSelfCheck: () => true });
  assert.strictEqual(extractPremiseCheck(p.body), buildPremiseCheck(finding, '/tmp/x.md'));
});

test('toIssuePayload passes exactly the composed command to the self-check, once', () => {
  const seen = [];
  const finding = patchFinding({ path: '/tmp/x.md' });
  toIssuePayload(finding, undefined, undefined, { premiseSelfCheck: (c) => { seen.push(c); return true; } });
  assert.deepStrictEqual(seen, [buildPremiseCheck(finding, '/tmp/x.md')]);
});

test('toIssuePayload never invokes the self-check when no command composes (no path, or new-skill)', () => {
  let calls = 0;
  const spy = () => { calls += 1; return true; };
  toIssuePayload(patchFinding(), undefined, undefined, { premiseSelfCheck: spy });
  toIssuePayload(newSkillFinding({ path: '/tmp/x.md' }), undefined, undefined, { premiseSelfCheck: spy });
  assert.strictEqual(calls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js`
Expected: FAIL after Step 1 — the "drops the Premise-check: line" test fails (the line is still present because `options` is ignored).

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/harness-health/issue-payload.js`, extend the comment block above `toIssuePayload` with:

```js
// options.premiseSelfCheck (#2633, optional): (command) -> boolean, injected
// by bin/harness-health.js's cmdValidateFindings with health-core/
// premise-self-check.js's real shell runner. Called once, only when
// buildPremiseCheck composed a command; false drops the Premise-check: line
// (the command doesn't read "unresolved" right now, so it would auto-close
// the record at its first materialize). Absent, the line is kept exactly as
// composed — this module never spawns a shell itself, so its own unit tests
// stay shell-free.
```

change the signature line to:

```js
function toIssuePayload(finding, verifiedAsOf, pluginVersion, options = {}) {
```

and replace line 129:

```js
  const premiseCheck = buildPremiseCheck(finding, finding.path);
```

with:

```js
  let premiseCheck = buildPremiseCheck(finding, finding.path);
  if (premiseCheck && options.premiseSelfCheck && !options.premiseSelfCheck(premiseCheck)) {
    premiseCheck = undefined;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js`
Expected: PASS (all tests, including every pre-existing one)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/harness-health/issue-payload.js tests/bin-lib/harness-health/issue-payload.test.js
git commit -m "Let toIssuePayload drop a self-check-failing Premise-check line — injected callback, absent keeps today's output (refs #2633)" -m "Claude-Session: https://claude.ai/code/session_01SVHow4R2CEesmDt5hC3M1r"
```

### Task 3: Wire the real self-check into `validate-findings`

**Files:**
- Modify: `plugin/bin/harness-health.js` (require block near line 18; the `dedupAndDispatch({...})` call near line 273)
- Test: `tests/bin-lib/harness-health/cli-validate-findings.test.js` (append after the `// ── Premise-check threading end-to-end (#2621)` block, after line ~451)

**Interfaces:**
- Consumes: `premiseReadsUnresolved(command, { root })` (Task 1); `toIssuePayload(finding, verifiedAsOf, pluginVersion, { premiseSelfCheck })` (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

```js
// ── Filing-time self-check end-to-end (#2633) ───────────────────────────────

test('validate-findings: an additive finding whose proposed string already exists in the target is filed with no Premise-check: line', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  // The proposed newString is already present (the generic-anchor case #2633 guards against).
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth\n\nSee `src/auth/login.js`.\nSee `src/auth/session.js`.\n');
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(!payloads[0].body.includes('Premise-check:'), `expected the self-check to drop the line, got:\n${payloads[0].body}`);
});

test('validate-findings: a removal finding whose old string is already gone is filed with no Premise-check: line', () => {
  const root = tmp();
  // intent "remove" is only valid for assetType claude-md + classification
  // restructural (validate-finding.js); scope.js's listClaudeMd resolves
  // --kind claude-md --target CLAUDE to <root>/CLAUDE.md.
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n\nNothing stale here.\n');
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({
    assetType: 'claude-md', target: 'CLAUDE', classification: 'restructural',
    intent: 'remove', oldString: 'See `src/auth/login.js`.', newString: '',
  })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'CLAUDE', '--kind', 'claude-md']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(!payloads[0].body.includes('Premise-check:'), `expected the self-check to drop the line, got:\n${payloads[0].body}`);
});
```

(The pre-existing test "a patch finding against a real target file carries a Premise-check: line resolvable to that file" is the keep-side proof: its fixture file lacks the proposed string, so the real self-check exits 0 and the exact pre-#2633 line must still appear.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js`
Expected: FAIL after Step 1 — both new tests fail (the CLI still emits the line).

Verified at plan time: `validate-finding.js:52-88` accepts `intent: 'remove'` only with `kind: 'patch'`, `assetType: 'claude-md'`, `classification: 'restructural'`, non-empty `oldString`, and `newString === ''` — the fixture above carries exactly that shape. If the removal test sees 0 payloads, read the CLI's stderr "dropped finding" line and fix the fixture, never the validator.

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/harness-health.js`, add next to the existing `toIssuePayload` require:

```js
const { premiseReadsUnresolved } = require('./lib/health-core/premise-self-check');
```

and in `cmdValidateFindings`, replace the `dedupAndDispatch` call's `toIssuePayload` argument with a wrapper that injects the real self-check (declare it right above the call):

```js
  // #2633: run each composed Premise-check: once, from this sweep's own
  // root, before filing — a command that doesn't read "unresolved" right now
  // is dropped rather than left to auto-close the record at its first
  // materialize. Only this CLI injects the real shell runner; toIssuePayload
  // itself never spawns one.
  const toIssuePayloadSelfChecked = (finding, v, p) => toIssuePayload(finding, v, p, {
    premiseSelfCheck: (command) => premiseReadsUnresolved(command, { root }),
  });

  const { cache, payloads, seen, wontfixSuppressed } = dedupAndDispatch({
    root, issuesPath: args.issues, toolName: TOOL_NAME, survivors, readCache: readCacheWithDeclined, decide, toIssuePayload: toIssuePayloadSelfChecked, verifiedAsOf, pluginVersion,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/health-core/premise-self-check.test.js`
Expected: PASS (all tests, including the three pre-existing #2621 end-to-end tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/harness-health.js tests/bin-lib/harness-health/cli-validate-findings.test.js
git commit -m "Self-check Premise-check lines in harness-health validate-findings — drop any that don't read unresolved at filing time (refs #2633)" -m "Claude-Session: https://claude.ai/code/session_01SVHow4R2CEesmDt5hC3M1r"
```
