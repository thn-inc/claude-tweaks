// tests/teardown-gate.test.js
// This suite grows through Tasks 1-4 of the teardown-gate plan (spec #373).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRunByWorktreePath, readRunState } = require('../plugin/bin/lib/hooks/context');
const { fixtureGit } = require('./helpers/git-fixtures');
const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function sh(cwd, ...args) {
  return fixtureGit(['-C', cwd, ...args]).toString();
}

// Spawns the real dispatcher (`node bin/hooks.js <args>`), same pattern as
// tests/hooks-dispatcher.test.js. Task 3's tests are dispatcher-level, not
// unit-level, so they exercise the exact stdin-parse -> ctx-build -> module.run
// -> stdout-write path a real hook invocation goes through.
// `PIPELINE_RUN_DIR: ''` neutralizes any ambient run-dir env var so
// resolveRun's env-attribution branch never wins over the fixture's own
// fallback scan.
// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-teardown-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

// A linked worktree of `root` (itself created via fixtureRoot()), placed
// OUTSIDE the main checkout — the shape raw `git worktree add` produces, and
// what wtDetect.mainCheckoutRoot's admin-dir walk-back is exercised against
// when the gate resolves a run from inside the worktree itself (ExitWorktree's
// real cwd).
let wtSeq = 0;
function addWorktree(root) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tdg-wt-'));
  const wt = path.join(parent, 'wt');
  sh(root, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${wtSeq++}`);
  return fs.realpathSync(wt);
}

// Same shape as tests/hooks-pre-tool-use.test.js's own withPolicy — used by
// the IMPORTANT-3 compound-command test below, which needs a repo that has
// OPTED IN to worktree-always so checkWorktreeRequired has something to deny.
function withPolicy(repo, content) {
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), content);
}

// A main-checkout repo root with .claude-tweaks/pipelines inside it.
// findRunByWorktreePath's underlying iterRunDirsWithState anchors via the
// main checkout resolution (bin/lib/hooks/worktree-detect.js), so the fixture
// root must itself be a real git repo, same as tests/run-integrity.test.js.
function fixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tdg-')));
  fixtureGit(['init', '-q', '-b', 'trunk', root]);
  sh(root, 'config', 'user.email', 't@example.com');
  sh(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  sh(root, 'add', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'base');
  return root;
}

let runSeq = 0;
function makeRun(root, state) {
  const name = `2026-08-01T09000${runSeq}-spec-9`;
  runSeq += 1;
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(runDir, { recursive: true });
  if (state !== undefined) {
    fs.writeFileSync(path.join(runDir, 'run-state.json'), state);
  } else {
    // #721: an unadopted mint (neither run-state.json nor decisions.md) is
    // invisible to resolveRun's fallback — touch decisions.md so callers that
    // deliberately start from an empty run dir (record-worktree's first claim)
    // stay reachable.
    fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  }
  return runDir;
}

test('exact-path match returns the run', () => {
  const root = fixtureRoot();
  const wt = path.join(root, 'wt-exact');
  fs.mkdirSync(wt);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const result = findRunByWorktreePath(root, wt);
  assert.ok(result, 'expected a match');
  assert.strictEqual(result.runDir, runDir);
  assert.strictEqual(result.state.worktree, wt);
});

test('realpath match (symlinked target) returns the run', () => {
  const root = fixtureRoot();
  const real = path.join(root, 'wt-real');
  fs.mkdirSync(real);
  const link = path.join(root, 'wt-link');
  fs.symlinkSync(real, link);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: real }));
  // Query via the symlink; recorded assignment is the canonical real path.
  const result = findRunByWorktreePath(root, link);
  assert.ok(result, 'expected a match via realpath canonicalization');
  assert.strictEqual(result.runDir, runDir);
});

test('unmatched path returns null', () => {
  const root = fixtureRoot();
  const wt = path.join(root, 'wt-recorded');
  fs.mkdirSync(wt);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const other = path.join(root, 'wt-other');
  fs.mkdirSync(other);
  const result = findRunByWorktreePath(root, other);
  assert.strictEqual(result, null);
});

test('terminal (clean) run is not returned', () => {
  const root = fixtureRoot();
  const wt = path.join(root, 'wt-clean');
  fs.mkdirSync(wt);
  makeRun(root, JSON.stringify({ status: 'clean', worktree: wt }));
  const result = findRunByWorktreePath(root, wt);
  assert.strictEqual(result, null);
});

test('corrupt run-state.json returns null for that run without throwing', () => {
  const root = fixtureRoot();
  const wt = path.join(root, 'wt-corrupt');
  fs.mkdirSync(wt);
  makeRun(root, '{not valid json');
  assert.doesNotThrow(() => {
    const result = findRunByWorktreePath(root, wt);
    assert.strictEqual(result, null);
  });
});

// --- Task 3: the deny/allow matrix at the dispatcher level ------------------

// AC1: ExitWorktree on a worktree assigned to a non-terminal run -> deny.
test('AC1: ExitWorktree on a worktree assigned to an active run is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({
    tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt, session_id: 'caller-1',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes(runDir),
    'deny reason must name the run dir path');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('cleanup-procedures.md'),
    'deny reason must point at the documented cleanup sequence');
});

// AC2: same payload, after the run was closed -> allow.
test('AC2: after close-run, the identical ExitWorktree payload is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const closed = runHook(['close-run', '--run', runDir], { cwd: root });
  assert.strictEqual(closed.code, 0);
  assert.strictEqual(readRunState(runDir).status, 'clean');
  const payload = JSON.stringify({
    tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt, session_id: 'caller-1',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), '', 'a clean run must not be enforced');
});

// CRITICAL 2 (whole-branch review): action:'keep' is non-destructive (the
// worktree stays on disk; only cwd is restored) and must never be denied.
test('CRITICAL 2: ExitWorktree action:\'keep\' on a worktree assigned to an active same-session run is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt, sessionId: 'caller-1' }));
  const payload = JSON.stringify({
    tool_name: 'ExitWorktree', tool_input: { action: 'keep' }, cwd: wt, session_id: 'caller-1',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), '', 'action:\'keep\' must never be gated, let alone denied');
});

// AC3: the narrow `git worktree remove [--force] <path>` Bash shape.
test('AC3: Bash `git worktree remove <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

// #2351: previously this deny logged nothing at all, regardless of whether
// the caller owned a run dir — checkTeardownGate's deny branch never called
// appendEvent. A standalone main-checkout session (e.g. /claude-tweaks:wrap-up
// doing post-dispatch cleanup, no worktree of its own) denied here lost the
// event entirely, even though the friction genuinely occurred. The deny now
// logs a `wd-deny` event to the CALLER's own run dir (stamped ad-hoc via
// context.js's stampAdHocRunDirForDenial when the caller owns none yet) —
// never to the unrelated TARGET run (`wt`'s own run dir) being torn down.
test('#2351: Bash `git worktree remove <abs-path>` from the main checkout with no owned run dir logs a wd-deny event to a newly stamped ad-hoc run', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const targetRunDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: root, session_id: 'wrap-up-caller',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');

  const pipelinesDir = path.join(root, '.claude-tweaks', 'pipelines');
  const runDirs = fs.readdirSync(pipelinesDir).map((n) => path.join(pipelinesDir, n));
  const stampedRun = runDirs.find((d) => d !== targetRunDir);
  assert.ok(stampedRun, 'an ad-hoc run dir distinct from the target worktree\'s own run must be minted');
  const events = fs.readFileSync(path.join(stampedRun, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'wd-deny');
  assert.strictEqual(events[0].path, wt);
  // The target run's own events.jsonl must stay untouched — this is the
  // caller's friction, not the target run's.
  assert.strictEqual(fs.existsSync(path.join(targetRunDir, 'events.jsonl')), false);
});

test('AC3: Bash `git worktree remove <relative-path>` resolving to the same worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  // The call cwd must stay INSIDE root's main-checkout tree — findRunByWorktreePath
  // anchors its run scan off ctx.cwd via mainCheckoutRoot, so a cwd with no
  // ancestor .git (e.g. a bare unrelated tmpdir) would resolve zero runs
  // regardless of whether the relative path itself resolves correctly.
  const callCwd = path.join(root, 'sub');
  fs.mkdirSync(callCwd);
  const rel = path.relative(callCwd, wt);
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${rel}` }, cwd: callCwd });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: callCwd });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny',
    `relative path ${rel} from ${callCwd} must resolve to ${wt} and be denied`);
});

test('AC3: Bash `git worktree remove --force <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove --force ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('AC3: `git worktree list` is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git worktree list' }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

test('AC3: `git worktree prune` is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git worktree prune' }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

// MINOR 5 (whole-branch review): `--` is an option terminator, same class as
// --force/-f, not the path itself.
test('MINOR 5: Bash `git worktree remove -- <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove -- ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

// whole-branch review (pre-6.80.0): teardownTargets used to check only a
// literal `-C` token immediately after `git`, unlike gitTargets' loop which
// skips past any global flag before the subcommand — so a global flag other
// than -C ahead of `worktree remove` defeated the parser and silently
// allowed tearing down a worktree still assigned to a non-terminal run.
test('whole-branch review: Bash `git -c foo=bar worktree remove <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git -c foo=bar worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('whole-branch review: Bash `git --no-pager worktree remove <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git --no-pager worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

// #1308: teardownTargets used to check toks[0] !== 'git' directly, so a
// command-wrapper prefix (env, and whatever else #590's findGitLead
// normalizes) defeated the parser and let the raw removal through
// completely ungated.
test('#1308: Bash `env git worktree remove <abs-path>` on an active run\'s worktree is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `env git worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

// #1308: env-prefixed and bare forms must resolve to the identical
// teardown target from teardownTargets() itself, not merely both deny —
// a direct unit-level check against the function the spec names.
test('#1308: teardownTargets() resolves `env git worktree remove <path>` to the same target as the bare form', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const bareCtx = {
    input: { tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` } },
    cwd: root,
  };
  const envCtx = {
    input: { tool_name: 'Bash', tool_input: { command: `env git worktree remove ${wt}` } },
    cwd: root,
  };
  const bare = preToolUse.teardownTargets(bareCtx);
  const withEnv = preToolUse.teardownTargets(envCtx);
  assert.deepStrictEqual(withEnv, bare);
  assert.strictEqual(bare.length, 1);
  assert.strictEqual(bare[0].source, 'bash');
});

// IMPORTANT 4 (whole-branch review): teardownTargets must track `cd` across
// shell segments (via git-command.js's forEachCommandSegment), not just
// inspect each segment against the ORIGINAL cwd — otherwise `cd <dir> && git
// worktree remove <relative>` resolves against the wrong directory and is
// missed entirely.
test('IMPORTANT 4: Bash `cd <dir> && git worktree remove <relative-path>` is denied via cd-tracking', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const parent = path.dirname(wt);
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `cd ${parent} && git worktree remove ${path.basename(wt)}` }, cwd: root,
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny',
    'the cd-relative target must resolve to the assigned worktree and be denied');
});

// AC4: fail-open cases.
test('AC4: an unresolvable teardown target (no positional path) is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  // `--force` alone leaves zero positionals after filtering -> teardownTargets
  // deliberately produces no target for this segment (unconfident -> allow),
  // even though an active run exists for `wt`.
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git worktree remove --force' }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

test('AC4: a target matching no recorded assignment is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt })); // assigned to a DIFFERENT path
  const other = addWorktree(root);
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${other}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

test('AC4: a recorded worktree path already deleted from disk is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  sh(root, 'worktree', 'remove', '--force', wt); // actually tear it down; run-state.json is untouched
  assert.strictEqual(fs.existsSync(wt), false, 'sanity check: the worktree path must be gone from disk');
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

// MINOR 6 (whole-branch review): a run recording the MAIN CHECKOUT itself as
// its `worktree` (a bad record, or a current-branch-strategy run) must not
// deny an ExitWorktree call issued AT the main checkout — there is no
// worktree to orphan there.
test('MINOR 6: a run recording the main checkout as its worktree does not deny an ExitWorktree call at the main checkout', () => {
  const root = fixtureRoot();
  makeRun(root, JSON.stringify({ status: 'active', worktree: root }));
  const payload = JSON.stringify({ tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: root, session_id: 'caller-1' });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

// AC5: ownership.
test('AC5: a foreign-owned run warns instead of denying, and logs wd-foreign-teardown', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const emptyRun = makeRun(root); // empty run dir (no run-state.json yet) for record-worktree to claim
  const recorded = runHook(['record-worktree', '--run', emptyRun, wt], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'owner-1' } });
  assert.strictEqual(recorded.code, 0);
  assert.match(recorded.stdout, /worktree recorded/);
  const runDir = findRunByWorktreePath(root, wt).runDir;
  const payload = JSON.stringify({
    tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt, session_id: 'bystander-2',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput, undefined, 'foreign-owned teardown must not deny');
  assert.ok(out.systemMessage, 'foreign-owned teardown must warn');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(events[events.length - 1]);
  assert.strictEqual(last.type, 'wd-foreign-teardown');
  assert.strictEqual(last.path, wt);
});

test('AC5: an unowned run with a payload carrying no session_id is denied', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: wt })); // no sessionId recorded
  const payload = JSON.stringify({ tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

// #1563 / #1099: this gate's own ownership check now runs through
// classifyOwnership (#1098) instead of the old raw `owner && caller &&
// owner !== caller` comparison — the explicit decision this test was
// originally pinned to force (see its prior revision's comment, preserved in
// git history). classifyOwnership's worktree-binding branch proves 'foreign'
// from binding evidence ALONE whenever a caller stands in a different live
// worktree than the run's own recorded binding — session identity being
// present, absent, or equal on either side does not change that verdict, per
// #1098's own semantics table ("equal or either missing | recorded, exists |
// inside a different live worktree | foreign"). An unowned run (no sessionId
// recorded) bound to `targetWt`, torn down by a caller standing in a
// genuinely different, live `callerWt`, therefore now classifies 'foreign'
// and takes the allow-with-warning branch — not a silent regression, but the
// intended broadening #1099 exists to ship: the same worktree-binding proof
// `resolveRun`'s fallback arm has used since #1410 now applies uniformly at
// this gate too, rather than this gate alone being blind to it.
test('#1563/#1099: an unowned run targeted via Bash from a DIFFERENT live worktree is foreign-allowed (with a warning), via classifyOwnership\'s worktree-binding proof', () => {
  const root = fixtureRoot();
  const targetWt = addWorktree(root); // the run's own recorded binding — the removal target
  const callerWt = addWorktree(root); // a genuinely different, live worktree — where the caller stands
  makeRun(root, JSON.stringify({ status: 'active', worktree: targetWt })); // no sessionId recorded
  // Exercise both with and without a caller session_id — classifyOwnership's
  // worktree-binding branch proves 'foreign' from the binding mismatch alone
  // in both cases, so neither should change the outcome.
  const command = `git worktree remove ${targetWt}`;
  const withoutSessionId = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: callerWt }),
    cwd: callerWt,
  });
  const outWithout = JSON.parse(withoutSessionId.stdout);
  assert.strictEqual(outWithout.hookSpecificOutput, undefined, 'a foreign teardown must not deny');
  assert.ok(outWithout.systemMessage && outWithout.systemMessage.includes('recorded by a different session'));

  const withSessionId = runHook(['pre-tool-use'], {
    input: JSON.stringify({
      tool_name: 'Bash', tool_input: { command }, cwd: callerWt, session_id: 'caller-session',
    }),
    cwd: callerWt,
  });
  const outWith = JSON.parse(withSessionId.stdout);
  assert.strictEqual(outWith.hookSpecificOutput, undefined, 'a foreign teardown must not deny');
  assert.ok(outWith.systemMessage && outWith.systemMessage.includes('recorded by a different session'));
});

// The dual case AC1 also requires: the run's OWN session, with cwd inside the
// recorded worktree, still classifies 'mine' and takes the same-session deny
// branch — proving the broadening above is scoped to a genuine cross-worktree
// mismatch, not a general loosening of the gate.
test('#1099 AC1 dual case: caller cwd inside the recorded worktree still denies (classifies mine), even with no sessionId', () => {
  const root = fixtureRoot();
  const targetWt = addWorktree(root);
  makeRun(root, JSON.stringify({ status: 'active', worktree: targetWt })); // no sessionId recorded
  const command = `git worktree remove ${targetWt}`;
  const r = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: targetWt }),
    cwd: targetWt,
  });
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// IMPORTANT 3 (whole-branch review): the foreign-owner WARN path must not
// short-circuit runInner — previously, `git worktree remove <foreign-wt> &&
// git commit -m x` returned on the warn and never reached the trailing
// commit, silently bypassing worktree-always for it (measured).
test('IMPORTANT 3: a compound worktree-remove + commit is still denied by worktree-always, with the foreign-teardown warning attached', () => {
  const root = fixtureRoot();
  withPolicy(root, 'worktree-always: true\n');
  const foreignWt = addWorktree(root);
  const emptyRun = makeRun(root); // empty run dir for record-worktree to claim
  const recorded = runHook(['record-worktree', '--run', emptyRun, foreignWt], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'owner-1' } });
  assert.strictEqual(recorded.code, 0);
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: `git worktree remove ${foreignWt} && git commit -m x` },
    cwd: root,
    session_id: 'bystander-2',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny',
    'the trailing `git commit` in the main checkout must still be denied by worktree-always');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /worktree-always/);
  assert.ok(out.systemMessage && out.systemMessage.includes('recorded by a different session'),
    'the foreign-teardown warning must still be attached, proving the teardown gate did not silently swallow it');
});

// The other half: a LONE foreign-owned teardown (no compound command, no
// worktree-always policy) still allows + warns — the warn behavior itself is
// unchanged, only the short-circuit is fixed.
test('IMPORTANT 3: a lone foreign-owned `git worktree remove` (no compound command) still allows and warns', () => {
  const root = fixtureRoot();
  const foreignWt = addWorktree(root);
  const emptyRun = makeRun(root);
  const recorded = runHook(['record-worktree', '--run', emptyRun, foreignWt], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'owner-1' } });
  assert.strictEqual(recorded.code, 0);
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `git worktree remove ${foreignWt}` }, cwd: root, session_id: 'bystander-2',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput, undefined, 'a lone foreign teardown must not deny');
  assert.ok(out.systemMessage && out.systemMessage.includes('recorded by a different session'));
});

// Garbage stdin: the dispatcher-wide invariant, re-asserted for the
// ExitWorktree-shaped truncated payload this task's gate specifically parses.
test('garbage: truncated ExitWorktree stdin exits 0 with no stdout noise', () => {
  const r = runHook(['pre-tool-use'], { input: '{"tool_name":"ExitWorktree"' });
  assert.strictEqual(r.code, 0);
  if (r.stdout.trim()) assert.doesNotThrow(() => JSON.parse(r.stdout));
});

// GATE_COVERAGE.teardownGitCommands is load-bearing, not a parallel
// hand-kept list nothing reads — mirrors tests/hooks-gate-coverage.test.js's
// "every GATE_COVERAGE field is load-bearing" check for tools/gitActions.
// Task 5 adds the prose-block pin (policy-schema-coverage.md); this only pins the
// code-level branch-read, same scope as this file's other Task 3 tests.
test('GATE_COVERAGE.teardownGitCommands is branch-read by the Bash teardown parser', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'), 'utf8');
  assert.ok(src.includes('GATE_COVERAGE.teardownGitCommands'),
    'pre-tool-use.js must branch on GATE_COVERAGE.teardownGitCommands, not a hardcoded comparison');
});

// --- Task 4: AC6 — close-run warns when the ledger has no wrap-up invocation

test('AC6: close-run with events.jsonl lacking a wrap-up event warns and appends close-without-wrapup as the last event', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'other', ts: '2026-08-01T09:00:00Z' }) + '\n');
  const closed = runHook(['close-run', '--run', runDir], { cwd: root });
  assert.strictEqual(closed.code, 0);
  assert.strictEqual(readRunState(runDir).status, 'clean');
  assert.match(closed.stdout, /no recorded wrap-up/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(events[events.length - 1]);
  assert.strictEqual(last.type, 'close-without-wrapup');
});

test('AC6: close-run with a recorded wrap-up skill_invoked event does not warn and does not append an event', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  const wrapupEvent = JSON.stringify({ skill: 'claude-tweaks:wrap-up', ts: '2026-08-01T09:00:00Z', type: 'skill_invoked' });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), wrapupEvent + '\n');
  const closed = runHook(['close-run', '--run', runDir], { cwd: root });
  assert.strictEqual(closed.code, 0);
  assert.strictEqual(readRunState(runDir).status, 'clean');
  assert.doesNotMatch(closed.stdout, /no recorded wrap-up/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(events.length, 1, 'no new event should be appended when wrap-up was already recorded');
});

test('AC6: close-run with no events.jsonl at all still warns and creates the file with the single close-without-wrapup event', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const runDir = makeRun(root, JSON.stringify({ status: 'active', worktree: wt }));
  assert.strictEqual(fs.existsSync(path.join(runDir, 'events.jsonl')), false, 'sanity check: no events.jsonl fixture');
  const closed = runHook(['close-run', '--run', runDir], { cwd: root });
  assert.strictEqual(closed.code, 0);
  assert.match(closed.stdout, /no recorded wrap-up/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(JSON.parse(events[0]).type, 'close-without-wrapup');
});

// --- #693: own-cwd guard — a raw Bash `git worktree remove` (never
// ExitWorktree) must never be allowed to target the session's own cwd, or a
// directory containing it: removing it deletes the shell's live working
// directory out from under itself. This fires independent of any
// pipeline-run assignment — AC2 above shows the run-assignment check alone
// lets an ExitWorktree/`worktree remove` call through once close-run has
// already run, which does nothing to stop the shell's own cwd being pulled
// out from under it; that gap is exactly what let the real incident's raw
// remove through.

test('#693: Bash `git worktree remove <target>` denied when cwd is INSIDE target, no active run needed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const sub = path.join(wt, 'sub');
  fs.mkdirSync(sub);
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: sub });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: sub });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('ExitWorktree'),
    'deny reason must point at ExitWorktree');
});

test('#693: Bash `git worktree remove <target>` denied when cwd EQUALS target exactly, no active run needed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: wt });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('#693: `cd <elsewhere> && git worktree remove <own-cwd>` compound is still denied — the cd does not launder the target', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `cd ${root} && git worktree remove ${wt}` }, cwd: wt,
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('#693: Bash `git worktree remove <target>` from the main checkout targeting a DIFFERENT worktree is allowed', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: root });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: root });
  assert.strictEqual(r.stdout.trim(), '');
});

test('#693: ExitWorktree removing the session\'s own cwd is unaffected by the own-cwd guard', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({ tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt, session_id: 'caller-1' });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  assert.strictEqual(r.stdout.trim(), '');
});

// #2282: the own-cwd deny above previously left no friction-event trace at
// all. `session_id` is required for stampAdHocRunDirForDenial (context.js)
// to mint a run dir to log into — the AC2/#693 tests above omit it
// deliberately (appendEvent(null, ...) is then a documented no-op).
test('#2282: own-cwd `git worktree remove` deny logs a wd-guard-refusal event (reason: own-cwd-removal)', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: wt, session_id: 'sess-2282-owncwd',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  const pipelinesDir = path.join(root, '.claude-tweaks', 'pipelines');
  const adhocDirs = fs.readdirSync(pipelinesDir).filter((d) => d.endsWith('-adhoc-standalone'));
  assert.strictEqual(adhocDirs.length, 1, 'expected exactly one stamped ad-hoc run dir');
  const events = fs.readFileSync(path.join(pipelinesDir, adhocDirs[0], 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const hit = events.find((e) => e.type === 'wd-guard-refusal');
  assert.ok(hit, 'expected a wd-guard-refusal event, got: ' + JSON.stringify(events));
  assert.strictEqual(hit.reason, 'own-cwd-removal');
});

test('#2282: CT_HOOKS_TEST_MODE tags the own-cwd wd-guard-refusal event, excluded from friction-events.js aggregation', () => {
  const root = fixtureRoot();
  const wt = addWorktree(root);
  const payload = JSON.stringify({
    tool_name: 'Bash', tool_input: { command: `git worktree remove ${wt}` }, cwd: wt, session_id: 'sess-2282-testmode',
  });
  const r = runHook(['pre-tool-use'], { input: payload, cwd: wt, env: { CT_HOOKS_TEST_MODE: '1' } });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  const pipelinesDir = path.join(root, '.claude-tweaks', 'pipelines');
  const adhocDirs = fs.readdirSync(pipelinesDir).filter((d) => d.endsWith('-adhoc-standalone'));
  assert.strictEqual(adhocDirs.length, 1);
  const runDir = path.join(pipelinesDir, adhocDirs[0]);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const hit = events.find((e) => e.type === 'wd-guard-refusal');
  assert.ok(hit, 'expected the raw event to still be written (write side is unaffected by the test tag)');
  assert.strictEqual(hit.test, true);

  const frictionEvents = require('../plugin/bin/friction-events');
  let captured = '';
  frictionEvents.run(['--run', runDir], {
    isDirectory: () => true,
    cwd: () => wt,
    readEvents: frictionEvents.readEvents,
    findRunsByWorktreePath: () => [],
    stdout: (s) => { captured += s; },
    stderr: () => {},
  });
  const filtered = JSON.parse(captured);
  assert.strictEqual(
    filtered.some((e) => e.type === 'wd-guard-refusal'), false,
    'a test-tagged wd-guard-refusal event must be excluded from friction-events.js aggregation, mirroring gate-denial',
  );
});
