# PR-Bookkeeping Precondition Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a phase-boundary precondition check — callable at `/claude-tweaks:test`'s entry with a *known* `$PIPELINE_RUN_DIR` — that catches a `pr-first` run whose materialize commit landed without a recorded `record-worktree` stamp and (when `integration-model` resolves `pr-first`) without either a recorded PR, a durable `prExempt`, or a logged `PR-early run lifecycle: ... FAILED` degrade line — mirroring `pre-tool-use.js`'s existing `checkBookkeepingStampsGate`, but running at a phase boundary where the run dir is already known rather than resolved ambiguously per tool call.

**Architecture:** Extract nothing from the existing, heavily-tested `checkBookkeepingStampsGate` — instead add one new, independent pure-function module that *reuses* three of its already-exported helpers (`hasMaterializeCommit`, `hasLoggedPrDegrade`, plus a newly-exported `resolveRunPinnedIntegrationModel`) to answer the narrower question "does this one known run comply with its own bookkeeping contract" without any of the gate's foreign-session/cross-repo scoping (not needed — the caller already knows which run it's asking about). Wrap that module in a small standalone CLI (mirroring `bin/log-decision.js`'s injectable-`deps` shape), then call the CLI from `/claude-tweaks:test`'s `SKILL.md` as a new early step that HARD-STOPS the pipeline on a violation.

**Tech Stack:** Node.js (`node --test`), no new dependencies. Follows this repo's existing `bin/lib/{module}/` + `bin/{cli}.js` + `tests/bin-lib/{module}/` conventions (see `bin/log-decision.js` / `bin/lib/log-decision/append.js` / `tests/bin-lib/log-decision/`).

**Spec:** `.claude-tweaks/pipelines/2026-09-17T180542-record-2472/work/2472-spec.md` (materialized from GitHub issue #2472, "pr-first run reached wrap-up with no PR/run-state and no logged degrade trace").

## Global Constraints

- Reuse `hasMaterializeCommit`, `hasLoggedPrDegrade` (already exported from `plugin/bin/lib/hooks/pre-tool-use.js`) and `resolveRunPinnedIntegrationModel` (newly exported in Task 1) rather than reimplementing any of their logic — single source of truth for what "materialized" / "degrade logged" / "which integration model" mean.
- New CLI exit codes follow this repo's existing vocabulary for run-dir-anchored CLIs (`bin/log-decision.js`): `0` ok, `2` malformed invocation, `3` run dir missing. This CLI adds `4` for "bookkeeping precondition violated" (a real HARD-GATE finding, distinct from a usage error).
- Ambiguity resolves to "ok" (fail-open) everywhere in the new module, mirroring `checkBookkeepingStampsGate`'s own posture — this is a defense-in-depth safety net layered on top of the existing PreToolUse gate and `build/SKILL.md` Common Step 7's bookkeeping assertion, not a replacement for either.
- Test file paths mirror `tests/bin-lib/log-decision/{append,cli}.test.js`'s split exactly: `tests/bin-lib/pr-bookkeeping/{precondition,cli}.test.js`.

---

### Task 1: Export `resolveRunPinnedIntegrationModel` from `pre-tool-use.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:1693-1715` (module.exports block)
- Test: `tests/hooks-pre-tool-use.test.js` (append one new test)

**Interfaces:**
- Produces: `resolveRunPinnedIntegrationModel(mainRoot, runDir) -> 'pr-first' | 'local-merge' | string` — now a public export, unchanged behavior. Task 2 imports this from `plugin/bin/lib/hooks/pre-tool-use`.

- [ ] **Step 1: Write the failing test**

Append to `tests/hooks-pre-tool-use.test.js` (after the existing `hasMaterializeCommit` test block, near line 1013+):

```javascript
test('resolveRunPinnedIntegrationModel: exported for reuse by the phase-boundary precondition check (#2472)', () => {
  const repo = gitRepoWithCommit();
  const runDir = runDirForId('2026-09-17T000000-spec-2472');
  assert.strictEqual(typeof pre.resolveRunPinnedIntegrationModel, 'function');
  // No policy.yml, no remote configured -> detectIntegrationModel falls back
  // to local-merge (no forge to be pr-first against).
  assert.strictEqual(pre.resolveRunPinnedIntegrationModel(repo, runDir), 'local-merge');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: FAIL with "pre.resolveRunPinnedIntegrationModel is not a function" (or `assert.strictEqual` failing on `typeof ... === 'function'`)

- [ ] **Step 3: Add the export**

In `plugin/bin/lib/hooks/pre-tool-use.js`, add `resolveRunPinnedIntegrationModel` to the existing `module.exports` block (around line 1693-1715):

```javascript
module.exports = {
  run,
  GATE_COVERAGE,
  PIPELINE_STATE_DIR,
  POLICY_FILE,
  isPipelineBookkeeping,
  isPolicyFile,
  isUntrackedOrIgnored,
  hasMaterializeCommit,
  isPolicyOnlyCommit,
  POLICY_COMMIT_ALLOWLIST,
  isDeleteOnlyPush,
  DELETE_ONLY_PUSH_ALLOWLIST,
  shadowPipelineRunDir,
  checkPipelineShadowGuard,
  teardownTargets,
  toplevel,
  checkBookkeepingStampsGate,
  hasLoggedPrDegrade,
  // Exported for check-pr-bookkeeping.js's phase-boundary precondition check
  // (#2472) to reuse rather than reimplement — the same integration-model
  // resolution checkBookkeepingStampsGate's own PR-stamp branch already uses.
  resolveRunPinnedIntegrationModel,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: PASS (all tests in the file, not just the new one — confirm no regression)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git commit -m "Export resolveRunPinnedIntegrationModel for reuse by the new phase-boundary bookkeeping check (#2472)"
```

---

### Task 2: `checkPrBookkeepingPrecondition` pure-function module

**Files:**
- Create: `plugin/bin/lib/pr-bookkeeping/precondition.js`
- Test: `tests/bin-lib/pr-bookkeeping/precondition.test.js`

**Interfaces:**
- Consumes: `hasMaterializeCommit`, `hasLoggedPrDegrade`, `resolveRunPinnedIntegrationModel` from `../hooks/pre-tool-use` (Task 1); `readRunState` from `../hooks/context`; `mainCheckoutRoot` from `../hooks/worktree-detect`.
- Produces: `checkPrBookkeepingPrecondition({ runDir, cwd }) -> { ok: true, reason } | { ok: false, reason, message }` — Task 3's CLI imports this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/pr-bookkeeping/precondition.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkPrBookkeepingPrecondition } = require('../../../plugin/bin/lib/pr-bookkeeping/precondition');

function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

function makeRunDir(id) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-run-'));
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function writeRunState(runDir, state) {
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
}

function commitMaterializeFile(repo, runId) {
  const rel = path.join('.claude-tweaks', 'pipelines', runId, 'work', '1-spec.md');
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'materialize', '-q']);
}

test('checkPrBookkeepingPrecondition: ok when run dir is absent (nothing to check)', () => {
  const r = checkPrBookkeepingPrecondition({ runDir: null, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
});

test('checkPrBookkeepingPrecondition: ok when the run is already clean', () => {
  const runId = '2026-09-17T000001-spec-1';
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'clean' });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'clean');
});

test('checkPrBookkeepingPrecondition: ok when no materialize commit has landed yet', () => {
  const runId = '2026-09-17T000002-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-materialized-yet');
});

test('checkPrBookkeepingPrecondition: DENY when materialize commit landed but no worktree stamp was ever recorded (#2472 core scenario)', () => {
  const runId = '2026-09-17T000003-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  // No run-state.json at all -- record-worktree never ran.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
  assert.match(r.message, /record-worktree/);
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and prExempt is set', () => {
  const runId = '2026-09-17T000004-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, prExempt: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and a PR is recorded', () => {
  const runId = '2026-09-17T000005-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when integration model resolves local-merge (no policy, no remote)', () => {
  const runId = '2026-09-17T000006-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-pr-first');
});

test('checkPrBookkeepingPrecondition: ok when a PR-early-lifecycle FAILED degrade line is already logged', () => {
  const runId = '2026-09-17T000007-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  fs.writeFileSync(path.join(runDir, 'decisions.md'),
    '- AUTO 10:00:00 -- PR-early run lifecycle: push of br FAILED (network). Reversibility: n/a.\n');
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'degrade-logged');
});

test('checkPrBookkeepingPrecondition: DENY when pr-first, worktree stamped, no PR and no degrade line logged (#2472 core scenario)', () => {
  const runId = '2026-09-17T000008-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-pr-stamp');
  assert.match(r.message, /pr-early-run-lifecycle/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/pr-bookkeeping/precondition'"

- [ ] **Step 3: Write the implementation**

Create `plugin/bin/lib/pr-bookkeeping/precondition.js`:

```javascript
'use strict';

const path = require('path');
const {
  hasMaterializeCommit, hasLoggedPrDegrade, resolveRunPinnedIntegrationModel,
} = require('../hooks/pre-tool-use');
const { readRunState } = require('../hooks/context');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');

// checkPrBookkeepingPrecondition({ runDir, cwd }) -> { ok, reason, message? }
//
// Phase-boundary companion to pre-tool-use.js's checkBookkeepingStampsGate
// (per-tool-call enforcement keyed off an ambiguously-resolved ctx.runDir --
// see that file's own header comment on IL-131). This check runs against a
// KNOWN run dir (the caller already holds $PIPELINE_RUN_DIR, e.g.
// /claude-tweaks:test's own entry) so it needs none of that gate's
// foreign-session / cross-repo scoping machinery -- it only answers "does
// THIS run comply with its own pr-first bookkeeping contract" (#2472).
//
// Ambiguity resolves to { ok: true } throughout, mirroring the PreToolUse
// gate's own posture -- this is a defense-in-depth safety net layered on top
// of that gate and build/SKILL.md Common Step 7's bookkeeping assertion, not
// a replacement for either.
function checkPrBookkeepingPrecondition({ runDir, cwd = process.cwd() }) {
  if (!runDir) return { ok: true, reason: 'no-run-dir' };

  let runState;
  try {
    runState = readRunState(runDir) || {};
  } catch {
    return { ok: true, reason: 'unreadable-run-state' };
  }
  if (runState.status === 'clean') return { ok: true, reason: 'clean' };

  const worktreeRoot = runState.worktree ? path.resolve(runState.worktree) : cwd;

  let materialized;
  try {
    materialized = hasMaterializeCommit(worktreeRoot, runDir);
  } catch {
    return { ok: true, reason: 'materialize-check-failed' };
  }
  if (!materialized) return { ok: true, reason: 'not-materialized-yet' };

  if (!runState.worktree) {
    return {
      ok: false,
      reason: 'no-worktree-stamp',
      message: `pipeline run ${path.basename(runDir)} has a landed materialize commit but no recorded `
        + 'worktree assignment -- build/worktree-setup.md Step 4.5 (record-worktree) is non-skippable '
        + `[IL-131]. Run: node "\${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "${runDir}" "${worktreeRoot}"`,
    };
  }

  if (runState.pr || runState.prExempt) return { ok: true, reason: 'pr-stamped-or-exempt' };

  let model;
  try {
    const mainRoot = mainCheckoutRoot(worktreeRoot) || worktreeRoot;
    model = resolveRunPinnedIntegrationModel(mainRoot, runDir);
  } catch {
    model = 'local-merge';
  }
  if (model !== 'pr-first') return { ok: true, reason: 'not-pr-first' };

  if (hasLoggedPrDegrade(runDir)) return { ok: true, reason: 'degrade-logged' };

  return {
    ok: false,
    reason: 'no-pr-stamp',
    message: `this project resolves integration-model: pr-first and a materialize commit already landed in `
      + `${worktreeRoot}, but no PR is recorded for this run and no degrade line is logged -- `
      + 'build/worktree-setup.md Step 6 (_shared/pr-early-run-lifecycle.md) is non-skippable [IL-131]. '
      + 'Open the PR now, or if push/gh pr create genuinely failed, log the mandatory degrade line: '
      + `node "\${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "${runDir}" --section "/build" --status AUTO `
      + '--reversibility n/a --text "PR-early run lifecycle: <push|gh pr create> of <branch> FAILED (<reason>); '
      + 'run proceeds local-only, no PR opened"',
  };
}

module.exports = { checkPrBookkeepingPrecondition };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-bookkeeping/precondition.js tests/bin-lib/pr-bookkeeping/precondition.test.js
git commit -m "Add checkPrBookkeepingPrecondition — phase-boundary bookkeeping-stamp check reusing pre-tool-use.js's helpers (#2472)"
```

---

### Task 3: `bin/check-pr-bookkeeping.js` CLI wrapper

**Files:**
- Create: `plugin/bin/check-pr-bookkeeping.js`
- Test: `tests/bin-lib/pr-bookkeeping/cli.test.js`

**Interfaces:**
- Consumes: `checkPrBookkeepingPrecondition` from `./lib/pr-bookkeeping/precondition` (Task 2).
- Produces: `run(argv, deps) -> exitCode` (0 ok, 2 malformed, 3 run dir missing, 4 precondition violated) — same injectable-`deps` shape as `bin/log-decision.js`'s `run`/`parseArgs` exports, for direct unit testing without spawning a child process.

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/pr-bookkeeping/cli.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/check-pr-bookkeeping');

function makeCleanRunDir() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-cli-'));
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-09-17T000009-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  return runDir;
}

function makeDeps() {
  const out = []; const err = [];
  return {
    deps: { cwd: () => process.cwd(), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

test('parseArgs: --help sets help flag', () => {
  const o = parseArgs(['--help']);
  assert.strictEqual(o.help, true);
});

test('parseArgs: unknown flag returns an error', () => {
  const o = parseArgs(['--bogus']);
  assert.ok(o.error);
});

test('run: --help exits 0 and prints usage', () => {
  const { deps, out } = makeDeps();
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /usage: check-pr-bookkeeping\.js/);
});

test('run: missing --run exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run([], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /--run <run-dir> is required/);
});

test('run: unknown argument exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run(['--bogus'], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /unknown argument/);
});

test('run: nonexistent run dir exits 3', () => {
  const { deps, err } = makeDeps();
  const code = run(['--run', '/nonexistent/path/xyz'], deps);
  assert.strictEqual(code, 3);
  assert.match(err.join(''), /run dir does not exist/);
});

test('run: a clean run exits 0', () => {
  const { deps, out } = makeDeps();
  const runDir = makeCleanRunDir();
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /ok \(clean\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/check-pr-bookkeeping'"

- [ ] **Step 3: Write the implementation**

Create `plugin/bin/check-pr-bookkeeping.js`:

```javascript
#!/usr/bin/env node
// bin/check-pr-bookkeeping.js -- phase-boundary bookkeeping precondition
// check: does this run comply with its pr-first bookkeeping contract
// (record-worktree stamped, and under integration-model: pr-first, either a
// recorded PR, a durable prExempt, or a logged PR-early-lifecycle FAILED
// degrade line)?
//
// Complements pre-tool-use.js's checkBookkeepingStampsGate (per-tool-call
// enforcement keyed off an ambiguously-resolved ctx.runDir) with an explicit
// check at a KNOWN run dir, callable at a pipeline phase boundary
// (/claude-tweaks:test's entry, where $PIPELINE_RUN_DIR is already known
// rather than resolved ambiguously) -- #2472.
//
//   node bin/check-pr-bookkeeping.js --run <run-dir> [--help]
//
// Exit 0 ok (compliant, or nothing to check yet); 2 malformed invocation;
// 3 run dir missing; 4 bookkeeping precondition violated (HARD-GATE finding
// -- the caller should stop the pipeline and surface stderr verbatim).
'use strict';

const fs = require('fs');
const { checkPrBookkeepingPrecondition } = require('./lib/pr-bookkeeping/precondition');

const USAGE = 'usage: check-pr-bookkeeping.js --run <run-dir> [--help]\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`check-pr-bookkeeping.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`check-pr-bookkeeping.js: --run <run-dir> is required\n${USAGE}`); return 2; }
  if (!fs.existsSync(o.run)) {
    deps.stderr(`check-pr-bookkeeping.js: run dir does not exist: ${o.run}\n`);
    return 3;
  }
  const result = checkPrBookkeepingPrecondition({ runDir: o.run, cwd: deps.cwd() });
  if (result.ok) {
    deps.stdout(`check-pr-bookkeeping.js: ok (${result.reason})\n`);
    return 0;
  }
  deps.stderr(`check-pr-bookkeeping.js: ${result.message}\n`);
  return 4;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/check-pr-bookkeeping.js tests/bin-lib/pr-bookkeeping/cli.test.js
git commit -m "Add bin/check-pr-bookkeeping.js CLI wrapper for the phase-boundary precondition check (#2472)"
```

---

### Task 4: Wire the check into `/claude-tweaks:test`'s entry

**Files:**
- Modify: `plugin/skills/test/SKILL.md` (insert a new step immediately before the existing `## Step 1: Resolve Scope and Execute`, currently at line 76)

**Interfaces:**
- Consumes: `plugin/bin/check-pr-bookkeeping.js` (Task 3), exit codes 0/2/3/4.
- Produces: nothing new for later steps — this step either lets the pipeline continue (`## Step 1` runs unchanged) or renders a HARD-GATE failure and stops, exactly like every other precondition check `/flow`'s "On Gate Failure" section documents.

- [ ] **Step 1: Insert the new step**

In `plugin/skills/test/SKILL.md`, insert immediately before the line `## Step 1: Resolve Scope and Execute` (currently line 76):

```markdown
## Step 0: PR-Bookkeeping Precondition Check

Runs unconditionally, before any scope resolution, regardless of `$ARGUMENTS` — this is a
defense-in-depth safety net (#2472) layered on top of `pre-tool-use.js`'s
`checkBookkeepingStampsGate` (per-tool-call enforcement during build, keyed off an ambiguously
resolved run dir) and `build/SKILL.md` Common Step 7's own bookkeeping assertion (both of which
should already have caught this — this step exists for the case where either one didn't fire).

**Skip when `$PIPELINE_RUN_DIR` is unset** — a standalone `/claude-tweaks:test` invocation with no
pipeline run has nothing to check.

Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/check-pr-bookkeeping.js" --run "$PIPELINE_RUN_DIR"
```

- **Exit 0** — compliant (or nothing to check yet, e.g. no materialize commit landed). Continue to
  Step 1.
- **Exit 4** — a genuine bookkeeping-precondition violation: this pr-first run's materialize
  commit landed without a recorded worktree assignment, or (under `integration-model: pr-first`)
  without a recorded PR, a durable exemption, or a logged degrade line. **Stop the pipeline** and
  render the command's stderr verbatim as a HARD-GATE failure card — do not attempt to silently
  remediate on the test skill's own initiative; the remediation command is already named in the
  stderr message, aimed at whoever runs `/claude-tweaks:build` (or a human) to fix forward.
- **Exit 2 or 3** — a tooling/usage problem with the check itself (should not occur when
  `$PIPELINE_RUN_DIR` resolved correctly), not a bookkeeping finding. Fail open: log a `SKIP`
  entry per `_shared/auto-decision-log.md`'s degrade-trace rule (`condition: check-pr-bookkeeping.js
  exited {code} → fallback: precondition not verified this run`) and continue to Step 1 — this
  check is additive, never a reason to block on its own malfunction.

```

- [ ] **Step 2: Verify the insertion by reading it back**

Run: `grep -n "^## Step 0: PR-Bookkeeping Precondition Check\|^## Step 1: Resolve Scope and Execute" plugin/skills/test/SKILL.md`
Expected: two lines, `## Step 0: ...` immediately followed (a few lines later) by `## Step 1: Resolve Scope and Execute` — confirms the new step landed before Step 1, not interleaved inside it.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/test/SKILL.md
git commit -m "Wire check-pr-bookkeeping.js into /claude-tweaks:test's entry as a phase-boundary HARD-GATE (#2472)"
```

---

## Self-Review

**1. Spec coverage:** Deliverables asked to "consider whether flow/materialize.md's ... hard gate (or build/worktree-setup.md Step 6) should assert" the PR/degrade-line invariant — Tasks 2-4 add that assertion at the next phase boundary (`/test`'s entry) rather than inside materialize.md itself, since materialize.md runs *before* build (it cannot observe a bookkeeping failure that only manifests *during* build). Acceptance Criteria ("caught by a gate before reaching test/review/wrap-up, rather than being discovered only by wrap-up's own merge-time precondition check") is satisfied directly: Task 4's Step 0 runs at `/test`'s entry, strictly before `/review`/`/wrap-up`.

**2. Placeholder scan:** No TBD/TODO markers; every code block is complete, runnable code, not a description of code.

**3. Type consistency:** `checkPrBookkeepingPrecondition`'s return shape (`{ ok, reason, message? }`) is used identically in Task 2's tests, Task 3's CLI, and Task 4's skill prose (exit-code mapping matches the CLI's own doc comment). `resolveRunPinnedIntegrationModel(mainRoot, runDir)`'s two-argument signature (confirmed by reading the existing definition at `pre-tool-use.js:1138`) is used consistently in Task 1's test and Task 2's module.
