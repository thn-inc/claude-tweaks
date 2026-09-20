// tests/hooks-dispatcher.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRunState } = require('../plugin/bin/lib/hooks/context');
const { linkedWorktreeOf } = require('./helpers/git-fixtures');
const { skipUnderRoot } = require('./helpers/root');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-disp-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      // #1130: `PIPELINE_RUN_DIR: ''` neutralizes any ambient run-dir env var
      // so a call that doesn't explicitly pass one can't resolve against
      // whatever real run happens to be ambient in this test runner's own
      // process.env (e.g. when npm test itself runs inside a /flow-dispatched
      // shell). A caller that needs a run dir still passes it explicitly via
      // `env`, which wins because it spreads last.
      // #1337: CT_HOOKS_TEST_MODE tells pre-tool-use.js's gate-denial write
      // this denial came from the test suite's own exercise of the deny
      // logic, not a real operator action — see that file's appendEvent call
      // and friction-events.js's readEvents, which excludes tagged events
      // from aggregation. A caller that needs to assert real (untagged)
      // denial behavior overrides it via `env`.
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-disp-'));
  // #790: an explicit --run must resolve under a real git checkout (see
  // bin/hooks.js's resolveRunArg anchoring check) — a bare, non-git tmp dir
  // no longer counts as a valid anchor for any run dir nested under it.
  execFileSync('git', ['-C', dir, 'init', '-q']);
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  // #721: an unadopted mint (neither run-state.json nor decisions.md) is
  // invisible to resolveRun's fallback — touch decisions.md so this fixture's
  // pre-record-worktree run dir stays reachable, matching a real flow-initialized
  // run at this stage (config.yml/decisions.md exist, run-state.json doesn't yet).
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  return dir;
}

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-disp-repo-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  return fs.realpathSync(dir);
}

function writeWorktreeAlwaysPolicy(project) {
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
}

test('invariant: every event exits 0 on garbage stdin, no stdout noise', () => {
  for (const ev of ['session-start', 'session-end', 'pre-compact', 'pre-tool-use', 'post-tool-use', 'subagent-stop']) {
    const r = runHook([ev], { input: '%%%not json%%%' });
    assert.strictEqual(r.code, 0, `${ev} must exit 0 on garbage stdin`);
    if (r.stdout.trim()) assert.doesNotThrow(() => JSON.parse(r.stdout), `${ev} stdout must be empty or valid JSON`);
  }
});

// #1586: an unrecognized subcommand used to silently exit 0 with no output —
// caught only by re-reading decisions.md afterward and noticing a
// `hooks.js log-decision ...` call had no-op'd instead of writing the
// expected entry. Every unrecognized verb (including a bare/missing one)
// must now exit non-zero with a clear stderr message; only the six real
// EVENTS names (invoked by the harness via stdin JSON, never probed as a
// bare CLI arg in practice) keep the "never break a session" exit-0
// invariant pinned in the next test below.
test('#1586: an unrecognized hooks.js subcommand exits non-zero with a clear stderr message', () => {
  const r = runHook(['no-such-event'], { input: '{}' });
  assert.notStrictEqual(r.code, 0, 'unrecognized subcommand must exit non-zero, not silently no-op');
  assert.match(r.stderr, /unrecognized hooks\.js subcommand 'no-such-event'/);
});

test('#1586: a missing subcommand exits non-zero and lists known subcommands', () => {
  const r = runHook([], { input: '{}' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /no hooks\.js subcommand given/);
  assert.match(r.stderr, /record-worktree/, 'expected the known-subcommands list in the error');
});

// #1586's own reported incident: `log-decision` is not a hooks.js
// subcommand at all — the correct tool is the separate bin/log-decision.js
// CLI, a different script that only name-collides with the intended verb.
// This gets its own, more specific message pointing at that CLI directly,
// rather than the generic "did you mean" suggestion.
test("#1586: 'log-decision' — the specific name-collision case — points at the separate bin/log-decision.js CLI", () => {
  const r = runHook(['log-decision', '--run', 'x', '--text', 'y'], { input: '{}' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /no 'log-decision' subcommand/);
  assert.match(r.stderr, /bin\/log-decision\.js/);
});

// #1586: a near-miss typo of a real verb gets a "did you mean" suggestion
// naming the actual verb, not just a bare "unrecognized" message.
test('#1586: an unrecognized subcommand close to a known verb suggests it', () => {
  const r = runHook(['close-ru'], { input: '{}' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /did you mean 'close-run'\?/);
});

test('record-worktree writes run-state, prints a confirmation line, and close-run marks clean', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const recorded = runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project });
  assert.strictEqual(recorded.code, 0);
  assert.match(recorded.stdout, /claude-tweaks: worktree recorded for 2026-07-01T090000-spec-1/);
  let state = readRunState(run);
  assert.strictEqual(state.worktree, path.resolve('/tmp/wt-1'));
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(runHook(['close-run'], { cwd: project }).code, 0);
  state = readRunState(run);
  assert.strictEqual(state.status, 'clean');
});

test('close-run on a run dir with no pre-existing run-state.json creates one and stamps it clean (#743 — refine standalone runs, which never call record-worktree)', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const statePath = path.join(run, 'run-state.json');
  // No record-worktree call, no prior writeRunState — mirrors a backlog refine
  // standalone run dir today: decisions.md gets written, run-state.json never does.
  assert.strictEqual(fs.existsSync(statePath), false,
    'precondition: run dir must start with no run-state.json at all');
  assert.strictEqual(runHook(['close-run', '--run', run], { cwd: project }).code, 0);
  assert.strictEqual(fs.existsSync(statePath), true,
    'close-run must create run-state.json when the run dir never had one — the premise refine-mode.md Step 5 now relies on');
  assert.strictEqual(readRunState(run).status, 'clean');
});

test('close-run warns when the run dir still holds un-archived work/ content (#1103)', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(path.join(run, 'work'), { recursive: true });
  fs.writeFileSync(path.join(run, 'work', '1-spec.md'), '# 1\n');
  const result = runHook(['close-run', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /still holds un-archived work\/ content/,
    'expected close-run to note the pending archival as a routine informational reminder (#1103)');
  assert.match(result.stdout, /archive-run --run/);
});

test('close-run does NOT warn about un-archived work/ when no work/ content exists', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const result = runHook(['close-run', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /still holds un-archived work\/ content/);
});

// #1124: record-worktree without --run used to fall through to
// resolveRunDir's "newest non-terminal run" GUESS and could silently clobber
// a DIFFERENT live session's run-state.json — reproduced 3x independently on
// 2026-08-20, across three different dispatched subagents, each time hitting
// a different live sibling run's run-state.json. This is the regression
// test: two concurrent run directories, each already carrying its own
// run-state.json (representing two genuinely live sibling sessions, neither
// of which this invocation is scoped to), and a bare invocation omitting
// --run must leave BOTH byte-unchanged and exit non-zero — never guess which
// one to write into. #1143 adds a dedicated, verb-agnostic --help/-h
// intercept ahead of this whole branch (exit 0, usage text, no resolveRunArg
// call at all) — a --help probe is exercised below too, but now as that
// earlier, distinct no-op path rather than this "missing --run" refusal.
test('record-worktree without --run is a true no-op against two concurrent run directories, and exits non-zero; --help is a separate, earlier no-op (#1143)', () => {
  const project = gitRepo(); // #790: --run must resolve under a real git checkout
  const staleDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-15T090000-record-19');
  const ownDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  // Both run dirs are already-adopted, non-terminal, live sibling runs —
  // exactly the shape resolveRunDir's fallback (listRunDirs[0], newest
  // non-terminal by name) used to guess between with no --run override, and
  // exactly #19/#36's cross-contamination shape this record closes off.
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, 'run-state.json'), JSON.stringify({ status: 'interrupted' }));
  fs.mkdirSync(ownDir, { recursive: true });
  fs.writeFileSync(path.join(ownDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const staleStateBefore = readRunState(staleDir);
  const ownStateBefore = readRunState(ownDir);

  const bare = runHook(['record-worktree', '/tmp/wt-fallback'], { cwd: project });
  assert.notStrictEqual(bare.code, 0, 'record-worktree without --run must exit non-zero, not silently guess a target run');
  assert.match(bare.stdout, /record-worktree requires --run/);
  assert.doesNotMatch(bare.stdout, /worktree recorded/);

  // #1143: --help must never be treated as an implicit-resolution
  // invocation — it's intercepted before resolveRunArg ever runs, so it
  // gets its own dedicated no-op path (usage text, exit 0), not the
  // "requires --run" refusal above (which stays non-zero on genuinely
  // missing --run).
  const help = runHook(['record-worktree', '--help'], { cwd: project });
  assert.strictEqual(help.code, 0, '#1143: --help is a dedicated no-op path, distinct from the missing-args refusal');
  assert.match(help.stdout, /usage: record-worktree --run <dir> <worktree-path>/);
  assert.doesNotMatch(help.stdout, /worktree recorded/);

  assert.deepStrictEqual(readRunState(staleDir), staleStateBefore, 'staleDir must be byte-unchanged');
  assert.deepStrictEqual(readRunState(ownDir), ownStateBefore, 'ownDir must be byte-unchanged');

  // The FIX still works correctly when the caller names its own run
  // explicitly — proves this isn't a blanket regression, only the implicit
  // guess is closed off.
  const withFlag = runHook(['record-worktree', '--run', ownDir, '/tmp/wt-correct'], { cwd: project });
  assert.strictEqual(withFlag.code, 0);
  assert.match(withFlag.stdout, /worktree recorded for 2026-07-01T090000-spec-1/);
  const ownState = readRunState(ownDir);
  assert.strictEqual(ownState.worktree, path.resolve('/tmp/wt-correct'));
  assert.strictEqual(ownState.status, 'active');
  assert.deepStrictEqual(readRunState(staleDir), staleStateBefore,
    'an explicitly-targeted --run call must not touch a different run dir at all');
});

test('record-worktree accepts --run before or after the worktree positional', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const result = runHook(['record-worktree', '/tmp/wt-2', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  const state = readRunState(run);
  assert.strictEqual(state.worktree, path.resolve('/tmp/wt-2'));
});

// #1124 review finding: the fix's OTHER guard — rejecting a flag-shaped
// worktree positional — had no regression test, even though it's the exact
// shape every observed pre-fix incident hit (originally reproduced with a
// stray `--help`) and the code's own comment calls out. Discrimination
// check: reverting just the `worktreeArg.startsWith('-')` branch (hooks.js's
// "unrecognized argument" guard) would let this test's run-state.json end up
// with a literal `worktree: "-x"` value and exit 0 — this assertion set
// fails in that case, not just on the guard's total absence.
//
// #1012 note: a `--`-prefixed positional (the original `--bogus-flag`) is
// now intercepted even earlier, by the KNOWN_FLAGS unknown-flag guard shared
// by all five mutating verbs (any undeclared `--*` argument prints usage and
// exits 0, before this branch — or resolveRunArg itself — ever runs; see
// tests/hooks-help-guard.test.js and the KNOWN_FLAGS-specific cases below).
// This test now uses a single-dash shape (`-x`), which that scan does not
// classify (it only recognizes `--`-prefixed tokens), so it still reaches
// and exercises this deeper, single-dash-specific safety net.
test('record-worktree with an explicit --run still rejects a flag-shaped worktree positional (e.g. -x)', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const before = readRunState(run);

  const result = runHook(['record-worktree', '--run', run, '-x'], { cwd: project });
  assert.notStrictEqual(result.code, 0, 'a flag-shaped worktree positional must exit non-zero, not be treated as a literal path');
  assert.match(result.stdout, /unrecognized argument -x/);
  assert.doesNotMatch(result.stdout, /worktree recorded/);
  assert.deepStrictEqual(readRunState(run), before, 'run-state.json must be byte-unchanged — no "worktree: \\"-x\\"" write');
});

// #1012: the new, broader guard's own coverage of the `--`-prefixed shape —
// any undeclared `--*` argument anywhere in a KNOWN_FLAGS verb's arguments
// (including one that LOOKS like it could be a worktree-path positional)
// prints usage and exits 0 before resolveRunArg or any write ever runs.
test('#1012: record-worktree rejects an undeclared --* argument (e.g. --bogus-flag) via the KNOWN_FLAGS guard, before any write', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const before = readRunState(run);

  const result = runHook(['record-worktree', '--run', run, '--bogus-flag'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stdout, 'claude-tweaks: usage: record-worktree --run <dir> <worktree-path>\n');
  assert.deepStrictEqual(readRunState(run), before, 'run-state.json must be byte-unchanged');
});

// #1124: --run is now required unconditionally — a call that omits it exits
// non-zero with "requires --run" regardless of whether any run dir exists to
// guess at, so this no-run-dir-at-all case hits the same guard as every other
// omitted---run invocation, not a distinct "nothing found" message.
test('record-worktree without --run and with no resolvable run dir anywhere still refuses (not "no pipeline run dir found")', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bare-'));
  const result = runHook(['record-worktree', '/tmp/wt'], { cwd: bare });
  assert.notStrictEqual(result.code, 0);
  assert.match(result.stdout, /record-worktree requires --run/);
});

test('record-worktree with a non-existent --run path fails loudly instead of falling back or claiming success', () => {
  const project = tmpProject(); // has a real run dir the fallback WOULD find if we silently fell through
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const bogus = path.join(project, 'does-not-exist');
  const result = runHook(['record-worktree', '--run', bogus, '/tmp/wt'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
  assert.doesNotMatch(result.stdout, /worktree recorded/);
  assert.strictEqual(fs.existsSync(path.join(run, 'run-state.json')), false,
    'an invalid --run must not silently fall back to a different run dir');
});

test('record-worktree --run with no following value fails loudly instead of falling back or claiming success', () => {
  const project = tmpProject(); // has a real run dir the fallback WOULD find if we silently fell through
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  // '--run' as the trailing token — flag present, no path follows it. Keep
  // the worktree positional present (before --run) so this isolates the
  // missing-value case from the separate "no worktree given" branch.
  const result = runHook(['record-worktree', '/tmp/wt-2', '--run'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /claude-tweaks: --run path rejected: \(missing value\) — worktree not recorded/);
  assert.doesNotMatch(result.stdout, /worktree recorded/);
  assert.strictEqual(fs.existsSync(path.join(run, 'run-state.json')), false,
    '--run with a missing value must not silently fall back to a different run dir');
});

test('record-worktree reports a distinct failure when the run-state write itself fails', skipUnderRoot('root ignores directory permissions'), () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.chmodSync(run, 0o500); // read+execute only — fs.writeFileSync inside it must throw
  try {
    const result = runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project });
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /failed to record worktree/);
    assert.doesNotMatch(result.stdout, /worktree recorded for/);
  } finally {
    fs.chmodSync(run, 0o700);
  }
});

// #1566: resolveRunArg's plain anchored branch used to accept ANY real
// anchored directory as --run, never checking it was actually an
// initialized run dir (decisions.md/run-state.json/config.yml) — a
// malformed-but-real --run (a stray `--run .`, a caller bug interpolating
// $RUN_ROOT) was silently accepted and written to. record-worktree is the
// one deliberate exception: it's the sole first-writer in the dispatch
// mint-then-claim handoff (dispatch/SKILL.md Step 4 mkdir-only mints a run
// dir, flow/steps-and-gates.md case 2 adopts it with no config.yml yet,
// worktree-setup.md Step 4.5's record-worktree call is what performs the
// actual first write) — so it alone may target a freshly-minted,
// completely uninitialized run-id-shaped directory.
test('record-worktree accepts a freshly-minted, completely uninitialized --run dir (dispatch mint-then-claim pattern)', () => {
  const project = gitRepo();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true }); // bare mkdir only — no decisions.md/run-state.json/config.yml
  const result = runHook(['record-worktree', '--run', run, '/tmp/wt-mint'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /worktree recorded for 2026-07-01T090000-spec-1/);
  assert.strictEqual(readRunState(run).worktree, path.resolve('/tmp/wt-mint'));
});

// The exact reproduction from #1566's Current State: `--run .` from a bare
// git repo root wrote run-state.json directly into the repo root, with a
// false-success message and exit 0. The repo root carries none of the three
// markers, so it's rejected the same as any other uninitialized target —
// record-worktree's mint exception (above) only ever fires for a
// genuinely-empty directory, and this repo root has real content (.git) but
// no run markers, so it fails both the record-worktree exception and every
// other verb's default gate.
test('record-worktree rejects the main checkout root itself as --run when it carries no run markers (#1566 repro)', () => {
  const project = gitRepo();
  const result = runHook(['record-worktree', '--run', '.', '/tmp/wt-evil'], { cwd: project });
  assert.strictEqual(result.code, 0, 'record-worktree always exits 0, even on a rejected --run — see the other --run-rejection tests above');
  assert.match(result.stdout, /--run path rejected/);
  assert.doesNotMatch(result.stdout, /worktree recorded/);
  assert.strictEqual(fs.existsSync(path.join(project, 'run-state.json')), false,
    'a rejected --run must never write run-state.json into the repo root');
});

// The other 7 verbs sharing resolveRunArg have no legitimate "first write to
// a fresh dir" pattern of their own — by the time any of them runs in a real
// pipeline, record-worktree (or the Manifesto) has already initialized the
// target. Each must reject a freshly-minted, uninitialized --run target
// (record-worktree's own exception does not extend to them) rather than
// silently accepting a malformed or wrong-but-real path. archive-run is
// deliberately excluded from this list — see archive-run-verb.test.js's
// "refuses a run dir with no run-state.json, naming archiveOrphanedMint",
// its own documented exception for reporting a stale, never-claimed mint.
test('record-pr, spec-status, close-run, teardown-run, check-resume-freshness, and check-staged-inventory each reject an uninitialized --run target', () => {
  const verbs = [
    ['record-pr', '7', 'https://github.com/o/r/pull/7'],
    ['spec-status', '--spec', '1', '--status', 'running', '--phase', 'build'],
    ['close-run'],
    ['teardown-run'],
    ['check-resume-freshness'],
    ['check-staged-inventory'],
  ];
  for (const [verb, ...rest] of verbs) {
    const project = gitRepo();
    const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
    fs.mkdirSync(run, { recursive: true }); // bare mkdir only — no markers at all
    const result = runHook([verb, '--run', run, ...rest], { cwd: project });
    assert.strictEqual(result.code, 0, `${verb}: unexpected exit code`);
    assert.match(result.stdout, /--run path rejected/, `${verb}: expected a rejected---run diagnostic, got: ${result.stdout}`);
  }
});

test('close-run with a non-existent --run path fails loudly instead of falling back', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project });
  const bogus = path.join(project, 'does-not-exist');
  const result = runHook(['close-run', '--run', bogus], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
  const state = readRunState(run);
  assert.strictEqual(state.status, 'active', 'an invalid --run must not touch a different run dir at all');
});

test('close-run --run with no following value fails loudly instead of falling back to the newest non-terminal run', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  // Prove the fallback WOULD find and close this run if --run's missing
  // value were silently ignored: record a worktree so it's active and
  // non-terminal — exactly what resolveRunDir's "newest non-terminal run"
  // scan picks up (see the #19/#36 cross-contamination shape above).
  assert.strictEqual(runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project }).code, 0);
  assert.strictEqual(readRunState(run).status, 'active');

  const result = runHook(['close-run', '--run'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /claude-tweaks: --run path rejected: \(missing value\) — run not closed/);
  assert.strictEqual(readRunState(run).status, 'active',
    '--run with a missing value must not fall back to closing the newest non-terminal run');
});

// Regression: record-worktree's if/else-if chain had no branch for "a run
// dir was resolved but no worktree argument was given" — that case printed
// nothing and exited 0, indistinguishable from success.
test('record-worktree with a resolvable run dir but no worktree argument prints a not-recorded notice instead of silent success', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const result = runHook(['record-worktree', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.trim().length > 0, 'expected a diagnostic message, not silent success');
  assert.doesNotMatch(result.stdout, /worktree recorded/);
  assert.strictEqual(fs.existsSync(path.join(run, 'run-state.json')), false,
    'no worktree path was given — nothing should be recorded');
});

// Regression: close-run's analogous chain had no branch for "no run dir
// could be resolved and --run wasn't invalid" (i.e. --run omitted entirely
// and resolveRunDir's own fallback also found nothing) — that case also
// printed nothing and exited 0.
test('close-run with no resolvable run dir and no --run given prints a not-closed notice instead of silent success', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bare-'));
  const result = runHook(['close-run'], { cwd: bare });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.trim().length > 0, 'expected a diagnostic message, not silent success');
});

test('record-worktree stamps the owning session from CLAUDE_CODE_SESSION_ID and preserves it on env-less re-record', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'sess-owner' } });
  let state = readRunState(run);
  assert.strictEqual(state.sessionId, 'sess-owner');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: '' } });
  state = readRunState(run);
  assert.strictEqual(state.sessionId, 'sess-owner', 'env-less re-record must not clobber the stamp');
});

test('record-worktree without CLAUDE_CODE_SESSION_ID records no owner', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-2'], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: '' } });
  const state = readRunState(run);
  assert.ok(!('sessionId' in state), 'no env var -> no sessionId field');
});

test('close-run without --run REFUSES to close a run recorded by another (still-active) session, stays silent for the owner (finding regression)', () => {
  // Previously, a cross-session mismatch reached via the implicit fallback
  // (no --run) was only ever NOTED via a printed message but still
  // unconditionally closed — silently disarming the OTHER session's E1/E2/E3
  // enforcement with no way for it to know.
  const foreignProject = tmpProject();
  const foreignRun = path.join(foreignProject, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', foreignRun, '/tmp/wt'], { cwd: foreignProject, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });
  const foreign = runHook(['close-run'], { cwd: foreignProject, env: { CLAUDE_CODE_SESSION_ID: 'bystander' } });
  assert.strictEqual(foreign.code, 0);
  assert.match(foreign.stdout, /recorded by another session/);
  // #1012: the implicit-resolution refusal is now the shared candidate-list
  // card (renderCandidateRefusal) rather than close-run's own bespoke
  // "refusing to close" sentence — the outcome (nothing written, run stays
  // active) is unchanged; only the message shape is.
  assert.match(foreign.stdout, /pass --run explicitly/);
  assert.match(foreign.stdout, /Run not closed/);
  const foreignState = readRunState(foreignRun);
  assert.strictEqual(foreignState.status, 'active', 'the foreign session\'s run must remain active, not be silently closed');
  assert.strictEqual(foreignState.worktree, path.resolve('/tmp/wt'), 'the foreign session\'s worktree assignment must survive');

  const ownProject = tmpProject();
  const ownRun = path.join(ownProject, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', ownRun, '/tmp/wt'], { cwd: ownProject, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });
  const own = runHook(['close-run'], { cwd: ownProject, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });
  assert.strictEqual(own.code, 0);
  assert.match(own.stdout, /no recorded wrap-up/,
    'the fixture has no wrap-up event, so close-run\'s new warn-tier check (#373) fires');
});

test('close-run WITH an explicit --run still closes a run recorded by another session — the refusal only applies to the implicit fallback', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt'], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });
  const result = runHook(['close-run', '--run', run], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'bystander' } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /recorded by another session/);
  assert.doesNotMatch(result.stdout, /refusing to close/);
  assert.strictEqual(readRunState(run).status, 'clean', 'an explicitly-targeted --run intentionally overrides the cross-session refusal');
});

test("close-run without --run still detects and refuses a run bound to a different, still-live worktree — not just a different session (whole-branch review finding, pre-v6.110.0)", () => {
  // #1410's worktree-foreign filter (added to resolveRun's shared fallback
  // helper for post-tool-use.js's event attribution) also silently applied to
  // close-run's implicit fallback, which needs the opposite behavior: it must
  // still FIND a worktree-foreign run so closeRunState's own sessionId check
  // can report it, rather than resolveRunDir hiding it and close-run printing
  // "no pipeline run dir found" as if nothing were there at all.
  const project = tmpProject();
  execFileSync('git', ['-C', project, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const otherWt = linkedWorktreeOf(project);
  const callerWt = linkedWorktreeOf(project);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, otherWt], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });

  const result = runHook(['close-run'], { cwd: callerWt, env: { CLAUDE_CODE_SESSION_ID: 'bystander' } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /recorded by another session/);
  // #1012: see the identical message-shape note on the session-mismatch test
  // above — classifyOwnership now proves this candidate foreign via the
  // worktree-binding axis (caller in callerWt, run bound to otherWt) rather
  // than session id, and the refusal renders through the same shared card.
  assert.match(result.stdout, /pass --run explicitly/);
  assert.strictEqual(readRunState(run).status, 'active', "the foreign worktree's run must remain active — found and refused, not silently invisible");
});

test('e2e: foreign-session commit in the main checkout is allowed with a systemMessage, not denied', () => {
  const project = tmpProject(); // already a git repo (tmpProject inits one) — the "main checkout" this test's title refers to
  // #861: `worktree` must be a REAL linked worktree of `project` (not an
  // independent gitRepo()) — pre-tool-use.js now tells "wrong location WITHIN
  // this project" apart from "an entirely unrelated repo" via each target's
  // own main-checkout root, so an unrelated worktree fixture would read as a
  // foreign repo and short-circuit to a bare allow with no systemMessage.
  execFileSync('git', ['-C', project, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const worktree = linkedWorktreeOf(project);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, worktree], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'owner' } });

  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: project, session_id: 'bystander' }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.ok(!result.stdout.includes('permissionDecision'), `expected allow, got: ${result.stdout}`);
  assert.match(result.stdout, /"systemMessage"/);
  assert.match(result.stdout, /allowing this commit/);
});

test('close-run lifts E1 enforcement: pre-tool-use allows a commit outside the old worktree', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const worktree = gitRepo();
  const otherRepo = gitRepo();

  assert.strictEqual(runHook(['record-worktree', '--run', run, worktree], { cwd: project }).code, 0);
  assert.strictEqual(runHook(['close-run'], { cwd: project }).code, 0);

  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: otherRepo }),
    env: { PIPELINE_RUN_DIR: run },
  });
  assert.strictEqual(result.code, 0);
  assert.ok(
    !result.stdout.includes('permissionDecision'),
    `expected close-run to lift E1 enforcement (no permissionDecision), got: ${result.stdout}`
  );
});

test('hooks.json registers PreToolUse matchers for Edit, Write, and NotebookEdit', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const matchers = config.hooks.PreToolUse.map((entry) => entry.matcher);
  assert.ok(matchers.includes('Edit'), 'expected an Edit matcher');
  assert.ok(matchers.includes('Write'), 'expected a Write matcher');
  assert.ok(matchers.includes('NotebookEdit'), 'expected a NotebookEdit matcher');
});

test('hooks.json registers a PreToolUse matcher for ExitWorktree (unfiltered, literal tool-name match)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const entry = config.hooks.PreToolUse.find((e) => e.matcher === 'ExitWorktree');
  assert.ok(entry, 'expected a PreToolUse ExitWorktree matcher entry');
  assert.strictEqual(entry.hooks.length, 1);
  assert.strictEqual(entry.hooks[0].type, 'command');
  assert.ok(!('if' in entry.hooks[0]), 'ExitWorktree matcher must be a literal tool-name match, not pattern-filtered');
  assert.match(entry.hooks[0].command, /bin\/hooks\.js" pre-tool-use$/);
});

test("hooks.json's PreToolUse Bash `if` patterns include Bash(git worktree *)", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bashEntry = config.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  const ifs = bashEntry.hooks.map((h) => h.if);
  assert.ok(ifs.includes('Bash(git worktree *)'), 'expected PreToolUse\'s Bash matcher to include an "if": "Bash(git worktree *)" entry');
});

test('hooks.json registers a PostToolUse matcher for Skill (unfiltered, literal tool-name match)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const skillEntry = config.hooks.PostToolUse.find((e) => e.matcher === 'Skill');
  assert.ok(skillEntry, 'expected a PostToolUse Skill matcher entry');
  assert.strictEqual(skillEntry.hooks.length, 1);
  assert.strictEqual(skillEntry.hooks[0].type, 'command');
  assert.ok(!('if' in skillEntry.hooks[0]), 'Skill matcher must be a literal tool-name match, not pattern-filtered');
  assert.match(skillEntry.hooks[0].command, /bin\/hooks\.js" post-tool-use$/);
});

test('hooks.json registers a PostToolUse matcher for AskUserQuestion (unfiltered, literal tool-name match)', () => {
  // Pinning test for a real gap: post-tool-use.js's run() has had an
  // `if (ctx.input.tool_name === 'AskUserQuestion') return logAskUserQuestion(ctx);`
  // branch since #452, but with no matcher entry here the hook was never
  // spawned for that tool at all — the branch was dead code in production.
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const askEntry = config.hooks.PostToolUse.find((e) => e.matcher === 'AskUserQuestion');
  assert.ok(askEntry, 'expected a PostToolUse AskUserQuestion matcher entry');
  assert.strictEqual(askEntry.hooks.length, 1);
  assert.strictEqual(askEntry.hooks[0].type, 'command');
  assert.ok(!('if' in askEntry.hooks[0]), 'AskUserQuestion matcher must be a literal tool-name match, not pattern-filtered');
  assert.match(askEntry.hooks[0].command, /bin\/hooks\.js" post-tool-use$/);
});

// #457: audit of every tool_name checked in post-tool-use.js's run() and its
// dispatched handlers against hooks.json's PostToolUse matcher array — the
// same defect class #452's AskUserQuestion gap and #307/#500's EnterWorktree
// gap (pinned in tests/hooks-gate-coverage.test.js) both found. 'Write' and
// 'Bash' are the two remaining tool_name values checked in post-tool-use.js
// with no dedicated PostToolUse-matcher-presence pinning test of their own —
// closing that gap here.
test('hooks.json registers a PostToolUse matcher for Write (unfiltered, literal tool-name match)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const writeEntry = config.hooks.PostToolUse.find((e) => e.matcher === 'Write');
  assert.ok(writeEntry, 'expected a PostToolUse Write matcher entry');
  assert.strictEqual(writeEntry.hooks.length, 1);
  assert.strictEqual(writeEntry.hooks[0].type, 'command');
  assert.ok(!('if' in writeEntry.hooks[0]), 'Write matcher must be a literal tool-name match, not pattern-filtered');
  assert.match(writeEntry.hooks[0].command, /bin\/hooks\.js" post-tool-use$/);
});

test('hooks.json registers a PostToolUse matcher for Bash (pattern-filtered via `if`)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bashEntry = config.hooks.PostToolUse.find((e) => e.matcher === 'Bash');
  assert.ok(bashEntry, 'expected a PostToolUse Bash matcher entry');
  assert.ok(bashEntry.hooks.length > 0, 'expected at least one Bash `if`-filtered hook entry');
  for (const hook of bashEntry.hooks) {
    assert.strictEqual(hook.type, 'command');
    assert.ok('if' in hook, 'PostToolUse Bash matcher hooks must be pattern-filtered via "if"');
    assert.match(hook.command, /bin\/hooks\.js" post-tool-use$/);
  }
});

test("hooks.json's PreToolUse/PostToolUse Bash `if` patterns cover every VALUE_FLAGS entry git-command.js's gitTargets() resolves (finding regression)", () => {
  // git-command.js's gitTargets() is written and unit-tested to correctly
  // resolve a commit/push target through `-c`, `--exec-path`, and
  // `--namespace` (VALUE_FLAGS), not just `-C` — but the parser is only ever
  // invoked at all if one of hooks.json's own `if` matchers first recognizes
  // the command shape enough to spawn bin/hooks.js. A commit issued as
  // `git -c user.name=x commit -m y` previously never even reached the
  // parser: no registered `if` pattern matched its literal text, so both
  // the worktree-always deny and the E1 wrong-checkout deny silently never
  // fired for this shape.
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const requiredPatterns = ['Bash(git -c *)', 'Bash(git --exec-path=*)', 'Bash(git --namespace=*)'];
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const bashEntry = config.hooks[event].find((e) => e.matcher === 'Bash');
    const ifs = bashEntry.hooks.map((h) => h.if);
    for (const pattern of requiredPatterns) {
      assert.ok(ifs.includes(pattern), `expected ${event}'s Bash matcher to include an "if": "${pattern}" entry`);
    }
  }
});

test('e2e: pre-tool-use CLI denies an Edit when worktree-always policy is set in the main checkout', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(project, 'a.txt') } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
});

function policyRepoWithRun() {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  // #721: touch decisions.md so this run dir is adopted and reachable by
  // resolveRun's fallback (see tmpProject() above for the full rationale).
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  return { project, run };
}

test('a resolved deny appends a gate-denial event', () => {
  const { project, run } = policyRepoWithRun();
  const target = path.join(project, 'a.txt');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1, 'expected exactly one event appended');
  assert.strictEqual(events[0].type, 'gate-denial');
  assert.strictEqual(events[0].tool, 'Write');
  assert.strictEqual(events[0].path, target);
  // #1337: runHook's default env carries CT_HOOKS_TEST_MODE=1, so this
  // suite-produced denial is tagged — friction-events.js's readEvents
  // excludes it from aggregation on that basis.
  assert.strictEqual(events[0].test, true);
});

// #1337: a call site that overrides CT_HOOKS_TEST_MODE off (simulating a
// real, non-test invocation of the hook) must NOT tag its gate-denial event —
// the regression guard for "a real operator denial still logs and is still
// returned" (issue's Acceptance Criteria).
test('#1337: a gate-denial event is untagged when CT_HOOKS_TEST_MODE is not set', () => {
  const { project, run } = policyRepoWithRun();
  const target = path.join(project, 'a.txt');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
    cwd: project,
    env: { CT_HOOKS_TEST_MODE: '' },
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'gate-denial');
  assert.strictEqual('test' in events[0], false, 'a real denial must not carry the test-mode tag');
});

// #750 deliverable 1: hooks.json registers checkWorktreeRequired's pre-tool-use
// dispatch under MANY separate "if": "Bash(<shape> *)" entries on the SAME
// Bash matcher (git commit/push/-C/-c/--exec-path/--namespace, cp, mv,
// mkdir, tee, sed, perl, install, ln, truncate, dd, git worktree, ...) — the
// harness independently evaluates each "if" against a real compound Bash
// command and can spawn `pre-tool-use.js` once per matching entry for what
// is, from the operator's perspective, ONE tool call. This reproduces that
// shape directly (looping every registered "if" pattern's underlying command
// shape against the SAME compound command, exactly as N separate harness
// dispatches would) in a project with NO worktree-always policy — i.e. a
// command that genuinely executes successfully, no actual denial anywhere.
// checkWorktreeRequired's own fast-reject (`wtDetect.findPolicyFile` finds
// nothing) means every one of those N invocations returns `{}` before ever
// reaching the gate-denial write — so the burst reported in #750 cannot be
// per-segment/per-matching-hook duplicate logging of a non-denial: this
// invariant already holds structurally. (The reported burst's actual cause —
// a genuinely-denied SIBLING session's events landing in the WRONG run's
// events.jsonl via fallback attribution — is a `resolveRun` cross-worktree
// misattribution bug tracked separately: #721 fixed the narrower
// unadopted-mint case, and the broader cross-worktree case is #1402/PR #1577,
// already built+tested+reviewed and awaiting merge as of this writing — not
// re-implemented here to avoid duplicating that in-flight fix.)
test('#750: a compound Bash command with no policy violation never logs a gate-denial event, no matter how many registered "if" hook entries would independently fire on it', () => {
  const project = gitRepo(); // no writeWorktreeAlwaysPolicy(project) -- nothing to enforce
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  const compoundCommand = [
    'git commit -m "x"', 'git push', 'git -C . status', 'git -c user.name=t status',
    'cp a b', 'mv a b', 'mkdir -p scratch', 'tee out.txt', 'sed -i "" -e s/a/b/ f',
    'perl -e 1', 'install -m 644 a b', 'ln -s a b', 'truncate -s 0 f', 'dd if=a of=b',
    'git worktree list',
  ].join(' && ');
  const hooksConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bashEntry = hooksConfig.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  assert.ok(bashEntry.hooks.length > 10, 'expected many registered "if" entries under the Bash matcher (the mechanism under test)');
  for (const { if: ifPattern } of bashEntry.hooks) {
    const result = runHook(['pre-tool-use'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: compoundCommand } }),
      cwd: project,
    });
    assert.strictEqual(result.code, 0, `invocation simulating "if": "${ifPattern}" should not error`);
    assert.doesNotMatch(result.stdout, /"permissionDecision":"deny"/, `invocation simulating "if": "${ifPattern}" must not deny — no policy is set`);
  }
  assert.ok(!fs.existsSync(path.join(run, 'events.jsonl')), 'no gate-denial (or any) event should ever have been written across all simulated invocations');
});

// #1395: the gitignored-target exemption's own allow breadcrumb — unlike
// the two pre-existing path exemptions (pipeline bookkeeping, policy.yml),
// which leave no event at all, this one records a `gate-exempt-gitignored`
// event so an operator can audit which writes it let through. (The issue
// also asked for a standalone "untracked, not gitignored" branch — deliberately
// not implemented; see isUntrackedOrIgnored's header comment in
// pre-tool-use.js for the concrete regression evidence that made it unsafe.)
test('an allowed gitignored write appends a gate-exempt-gitignored event', () => {
  const { project, run } = policyRepoWithRun();
  fs.writeFileSync(path.join(project, '.gitignore'), '*.env\n');
  const target = path.join(project, 'deploy.env');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /"permissionDecision":"deny"/, 'a gitignored write target must be allowed');
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1, 'expected exactly one breadcrumb event');
  assert.strictEqual(events[0].type, 'gate-exempt-gitignored');
  assert.strictEqual(events[0].tool, 'Write');
  assert.strictEqual(events[0].path, target);
});

// Regression guard for the reverted branch above: an EXISTING, never-`git
// add`ed file that is NOT gitignored must stay denied — proving the
// exemption really is gitignored-only, not untracked-status-only.
test('an existing, never-added file that is NOT gitignored stays denied (no gate-exempt-gitignored event)', () => {
  const { project, run } = policyRepoWithRun();
  const target = path.join(project, 'scratch.txt');
  fs.writeFileSync(target, 'pre-existing, never git-added, not ignored');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `cp source.txt ${target}` } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/, 'an untracked-but-not-ignored write target must stay denied');
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'gate-denial', 'must be the ordinary deny breadcrumb, not a gitignored-exemption allow');
});

// #1270 regression: the #1130 fix (`PIPELINE_RUN_DIR: ''` in runHook's spread,
// proven above at 'record-pr does not resolve against an ambient
// PIPELINE_RUN_DIR...') guards run-state.json field writes. This is the sibling
// proof for events.jsonl specifically — the artifact #1270's own Current State
// named (`gate-denial`/`wd-foreign-session`/`close-without-wrapup` entries
// landing in a REAL run's events.jsonl). Ambient PIPELINE_RUN_DIR is set on
// THIS test runner's own process.env — exactly the shape a /flow-dispatched
// shell running `npm test` carries — pointed at a decoy "real" run dir
// entirely separate from the fixture project below, so if runHook's guard
// ever regressed, the gate-denial event triggered here would land in the
// decoy instead of (or in addition to) the correctly cwd-resolved run.
test('#1270: a gate-denial event never lands in an ambient PIPELINE_RUN_DIR the call site never passed', () => {
  const decoyRepo = gitRepo();
  const decoyRun = path.join(decoyRepo, '.claude-tweaks', 'pipelines', '2026-08-02T090000-record-9');
  fs.mkdirSync(decoyRun, { recursive: true });
  fs.writeFileSync(path.join(decoyRun, 'decisions.md'), '');
  const decoyEventsPath = path.join(decoyRun, 'events.jsonl');

  const { project, run } = policyRepoWithRun();
  const target = path.join(project, 'a.txt');

  const savedAmbient = process.env.PIPELINE_RUN_DIR;
  process.env.PIPELINE_RUN_DIR = decoyRun;
  let result;
  try {
    result = runHook(['pre-tool-use'], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
      cwd: project,
    });
  } finally {
    if (savedAmbient === undefined) delete process.env.PIPELINE_RUN_DIR;
    else process.env.PIPELINE_RUN_DIR = savedAmbient;
  }

  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
  assert.strictEqual(fs.existsSync(decoyEventsPath), false,
    'ambient PIPELINE_RUN_DIR must receive no events.jsonl entries from a call site that never passed it');
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1, 'the real (cwd-resolved) run dir must still receive its own event');
  assert.strictEqual(events[0].type, 'gate-denial');
});

test('a deny with no resolved run dir and no session_id writes nothing and still denies', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  // Deliberately no .claude-tweaks/pipelines/ run dir at all, so
  // ctxLib.resolveRun finds nothing and ownedRun.dir is null. Also
  // deliberately no session_id in the payload below — #2351's
  // stampAdHocRunDirForDenial requires one to stamp ownership against
  // (context.js), so this specific shape still records nothing; see
  // "#2351: a main-checkout gate denial with no owned run dir gets an
  // ad-hoc run dir stamped" below for the shape that now DOES stamp one.
  const target = path.join(project, 'a.txt');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
  assert.strictEqual(fs.existsSync(path.join(project, '.claude-tweaks', 'pipelines')), false,
    'no run dir existed before the call and no session_id was given, so appending a breadcrumb must not create one');
});

// #2351: previously, a gate denial with no owned run dir recorded nothing —
// appendEvent's own null-runDir no-op silently dropped it, which meant a
// standalone /claude-tweaks:wrap-up doing cleanup directly in the main
// checkout (no worktree, no formal run dir yet) lost every gate-denial event
// it hit. context.js's stampAdHocRunDirForDenial now mints an ad-hoc run dir
// the moment a real denial needs one, keyed on whatever `git worktree list`
// resolves cwd to (main checkout included) — as long as the payload carries
// a session_id to stamp ownership against.
test('#2351: a main-checkout gate denial with no owned run dir gets an ad-hoc run dir stamped', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  const target = path.join(project, 'a.txt');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target }, session_id: 'main-checkout-session' }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
  const pipelinesDir = path.join(project, '.claude-tweaks', 'pipelines');
  assert.strictEqual(fs.existsSync(pipelinesDir), true, 'an ad-hoc run dir must now be minted for this denial');
  const runDirs = fs.readdirSync(pipelinesDir);
  assert.strictEqual(runDirs.length, 1, 'exactly one ad-hoc run dir should be minted');
  const stampedRun = path.join(pipelinesDir, runDirs[0]);
  const events = fs.readFileSync(path.join(stampedRun, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(events.length, 1, 'expected exactly one event appended to the newly stamped run dir');
  assert.strictEqual(events[0].type, 'gate-denial');
  assert.strictEqual(events[0].tool, 'Write');
  assert.strictEqual(events[0].path, target);
  const state = JSON.parse(fs.readFileSync(path.join(stampedRun, 'run-state.json'), 'utf8'));
  assert.strictEqual(state.worktree, project, 'the stamped run must be keyed on the main checkout itself, not excluded as "main"');
});

// #2351 companion: the new trigger must stay keyed on an actual denial, never
// on ordinary main-checkout activity — an allowed (non-denied) call must not
// mint anything, or every ad hoc `git status`/read in the main checkout would
// start minting run dirs.
test('#2351: an ordinary allowed call in the main checkout does not stamp an ad-hoc run dir', () => {
  const project = gitRepo();
  // No worktree-always policy at all -> nothing is denied.
  const target = path.join(project, 'a.txt');
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target }, session_id: 'main-checkout-session' }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /"permissionDecision":"deny"/);
  assert.strictEqual(fs.existsSync(path.join(project, '.claude-tweaks', 'pipelines')), false,
    'an allowed call must never mint an ad-hoc run dir — only an actual denial does');
});

test('a gate denial with an unwritable run dir still denies and exits 0', skipUnderRoot('root ignores directory permissions'), () => {
  const { project, run } = policyRepoWithRun();
  fs.chmodSync(run, 0o500); // read+execute only — fs.appendFileSync inside it must throw
  try {
    const target = path.join(project, 'a.txt');
    const result = runHook(['pre-tool-use'], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
      cwd: project,
    });
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /"permissionDecision":"deny"/);
    assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false);
  } finally {
    fs.chmodSync(run, 0o700);
  }
});

test('e2e: pre-tool-use CLI allows an Edit when worktree-always policy is not set', () => {
  const project = gitRepo();
  const result = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(project, 'a.txt') } }),
    cwd: project,
  });
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stdout, '');
});

// #409: record-pr writes run-state.json's pr:{number,url} field — same shape
// and precedent as record-worktree/close-run (CLAUDE.md's write-ownership rule).
test('record-pr writes run-state.pr and prints a confirmation line', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const result = runHook(['record-pr', '42', 'https://github.com/o/r/pull/42'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /claude-tweaks: PR #42 recorded for 2026-07-01T090000-spec-1/);
  const state = readRunState(run);
  assert.deepStrictEqual(state.pr, { number: 42, url: 'https://github.com/o/r/pull/42' });
});

test('record-pr --run pins the target run dir, same as record-worktree', () => {
  const project = gitRepo(); // #790: --run must resolve under a real git checkout
  const staleDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-15T090000-record-19');
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const ownDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(ownDir, { recursive: true });
  // #1566: record-pr has no first-write exception the way record-worktree
  // does — its own target must already be an initialized run dir. This test
  // is about --run PINNING (own dir vs. a stale sibling), not about
  // uninitialized-dir acceptance, so seed the one marker record-worktree
  // would already have written in a real pipeline.
  fs.writeFileSync(path.join(ownDir, 'decisions.md'), '');

  const result = runHook(['record-pr', '--run', ownDir, '7', 'https://github.com/o/r/pull/7'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.deepStrictEqual(readRunState(ownDir).pr, { number: 7, url: 'https://github.com/o/r/pull/7' });
  assert.strictEqual(readRunState(staleDir).pr, undefined, 'the stale run must not have been written to');
});

test('record-pr with a non-existent --run path fails loudly instead of falling back or claiming success', () => {
  const project = tmpProject();
  const bogus = path.join(project, 'nope');
  const result = runHook(['record-pr', '--run', bogus, '7', 'https://github.com/o/r/pull/7'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
});

test('record-pr with no resolvable run dir prints a not-recorded notice instead of silent success', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bare-'));
  const result = runHook(['record-pr', '7', 'https://github.com/o/r/pull/7'], { cwd: bare });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.trim().length > 0, 'expected a diagnostic message, not silent success');
  assert.doesNotMatch(result.stdout, /PR #7 recorded/);
});

test('record-pr with a non-numeric or missing number/url prints a usage notice instead of writing garbage state', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  for (const args of [['record-pr'], ['record-pr', 'not-a-number', 'https://x'], ['record-pr', '7']]) {
    const result = runHook(args, { cwd: project });
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /usage: record-pr/);
    assert.strictEqual(fs.existsSync(path.join(run, 'run-state.json')), false);
  }
});

// #1672: the branch is only reliably knowable while the worktree is still
// live, so record-pr stamps it into pr.branch at that moment — the
// torn-down-worktree fallback in run-integrity.js reads it back later, once
// `git worktree list` no longer has an entry to derive it from.
test('record-pr records the branch alongside the PR — deriveBranch() run while the worktree is still live', () => {
  const project = tmpProject();
  execFileSync('git', ['-C', project, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const worktree = linkedWorktreeOf(project);
  const branch = execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, worktree], { cwd: project });

  const result = runHook(['record-pr', '--run', run, '7', 'https://github.com/o/r/pull/7'], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.deepStrictEqual(readRunState(run).pr, { number: 7, url: 'https://github.com/o/r/pull/7', branch });
});

test('check-resume-freshness: reports OK when the run is not interrupted', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: 'other' }));
  const result = runHook(['check-resume-freshness', '--run', run], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'me' } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /freshness OK for 2026-08-01T000000-record-1 \(not-interrupted\)/);
});

test('check-resume-freshness: reports BLOCKED with a reason when the run is interrupted and the recorded worktree has a fresh commit', () => {
  const project = tmpProject();
  const wt = gitRepo();
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-m', 'recent', '-q']);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-2');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'interrupted', sessionId: 'other', worktree: wt }));
  const result = runHook(['check-resume-freshness', '--run', run], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'me' } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /freshness BLOCKED for 2026-08-01T000000-record-2 — run appears actively owned \(worktree committed to within the last \d+ minutes\)/);
});

test('check-resume-freshness: no resolvable --run path reports the not-found line', () => {
  const project = tmpProject();
  const result = runHook(['check-resume-freshness', '--run', path.join(project, 'nope')], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
});

test('check-staged-inventory: reports OK when decisions.md has no STAGED entries', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-3');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), 'AUTO 14:32:14 — Step 1.5: scope-creep applied. Reversibility: high.');
  const result = runHook(['check-staged-inventory', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /staged inventory OK for 2026-08-01T000000-record-3 \(0 STAGED entries\)/);
});

test('check-staged-inventory: reports OK when every STAGED entry has a backing file', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-4');
  fs.mkdirSync(path.join(run, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(run, 'staged', 'review-1.patch'), 'diff');
  fs.writeFileSync(path.join(run, 'decisions.md'), 'STAGED 14:41:15 — Step 3 Routing: finding. Stage path: staged/review-1.patch.');
  const result = runHook(['check-staged-inventory', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /staged inventory OK for 2026-08-01T000000-record-4 \(1 STAGED entries\)/);
});

test('check-staged-inventory: reports MISMATCH naming the missing path when a STAGED entry has no backing file', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-5');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), 'STAGED 08:22:19 — Step 3 lens dispatch: deferred finding. Stage path: staged/review-defer-1.md.');
  const result = runHook(['check-staged-inventory', '--run', run], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /staged inventory MISMATCH for 2026-08-01T000000-record-5 — 1 of 1 STAGED entries missing from staged\/: staged\/review-defer-1\.md/);
});

test('check-staged-inventory: no resolvable --run path reports the not-found line', () => {
  const project = tmpProject();
  const result = runHook(['check-staged-inventory', '--run', path.join(project, 'nope')], { cwd: project });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
});

// #1130: a runHook call that omits cwd BOTH in execFileSync's options and in
// the JSON payload used to fall through to the spawned subprocess's own
// process.cwd() — the test runner's real working directory. When that
// directory sits inside a real checkout, iterRunDirsWithState walked the
// REAL .claude-tweaks/pipelines/ and appendEvent wrote fixture literals into
// a real run's events.jsonl (the #657 incident's pollution mechanism). The
// hardened helper defaults to an isolated sandbox dir instead, so the decoy
// "real" run dir below must stay byte-untouched.
//
// Note (verified during Step 3): the brief's original Bash/`git commit`
// payload never reaches appendEvent, pre- or post-fix — E1's wd-deny path
// requires `safeReal(ctx.runState.worktree)` to resolve, and the decoy
// `/tmp/wt-decoy` doesn't exist on disk, so runInner returns early before
// ever writing. Per Step 3's fallback instruction, this uses a Write-tool
// payload targeting a path inside the decoy repo instead (mirroring 'a
// resolved deny appends a gate-denial event' above) — checkWorktreeRequired's
// gate-denial write depends on `ownedRun`, which IS resolved from `ctx.cwd`
// (via resolveRun's iterRunDirsWithState(cwd) scan), so this payload
// discriminates pre/post-fix correctly: pre-fix, cwd falls through to the
// decoy repo and ownedRun resolves to the decoy run; post-fix, cwd is the
// isolated sandbox, which has no `.claude-tweaks/pipelines/` at all, so
// ownedRun.dir is null and appendEvent no-ops.
test('a hook spawned with no cwd anywhere cannot write into a real run dir reachable from the test runner process.cwd()', () => {
  const decoyRepo = gitRepo();
  writeWorktreeAlwaysPolicy(decoyRepo);
  const decoyRun = path.join(decoyRepo, '.claude-tweaks', 'pipelines', '2026-08-01T090000-record-9');
  fs.mkdirSync(decoyRun, { recursive: true });
  fs.writeFileSync(path.join(decoyRun, 'run-state.json'), JSON.stringify({ status: 'active', worktree: '/tmp/wt-decoy', sessionId: 'decoy-owner' }));
  const eventsPath = path.join(decoyRun, 'events.jsonl');

  const realCwd = process.cwd();
  process.chdir(decoyRepo);
  try {
    // Write-shaped payload with NO cwd field, NO options.cwd, NO
    // PIPELINE_RUN_DIR, NO session_id: pre-fix, this resolves cwd to
    // process.cwd() (= decoyRepo) and can append a gate-denial event to the
    // decoy run via ownedRun's unfiltered fallback resolution.
    runHook(['pre-tool-use'], {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: path.join(decoyRepo, 'a.txt') },
      }),
    });
  } finally {
    process.chdir(realCwd);
  }

  assert.strictEqual(fs.existsSync(eventsPath), false,
    'decoy run dir must receive no events from a cwd-omitting hook spawn');
  const state = JSON.parse(fs.readFileSync(path.join(decoyRun, 'run-state.json'), 'utf8'));
  assert.strictEqual(state.status, 'active', 'decoy run-state.json must be untouched');
});

// #1130 (env leak): resolveRun checks env.PIPELINE_RUN_DIR BEFORE any cwd
// scan (plugin/bin/lib/hooks/context.js's resolveRun). Every /flow-dispatched
// shell carries an ambient PIPELINE_RUN_DIR pointed at that run's own
// directory. runHook's `{ ...process.env, ...env }` spread forwards that
// ambient value to every spawned hooks.js call whose own `env` option doesn't
// override it — so a call site that never mentions PIPELINE_RUN_DIR at all
// still resolves against whatever real run dir happens to be ambient in the
// TEST RUNNER's own process.env when `npm test` itself runs inside a
// /flow-dispatched shell. Reproduced live by the reviewer: record-pr fixture
// calls wrote `pr:{number:7,url:"..."}` into a stand-in foreign run dir this
// way. The guard (`PIPELINE_RUN_DIR: ''` between the process.env spread and
// the caller's env) neutralizes the ambient value so only an explicit
// call-site `env.PIPELINE_RUN_DIR` can select a run dir.
test('record-pr does not resolve against an ambient PIPELINE_RUN_DIR the call site never passed', () => {
  const decoyRepo = gitRepo();
  const decoyRun = path.join(decoyRepo, '.claude-tweaks', 'pipelines', '2026-08-02T090000-record-9');
  fs.mkdirSync(decoyRun, { recursive: true });
  fs.writeFileSync(path.join(decoyRun, 'run-state.json'), JSON.stringify({ status: 'active' }));

  // Simulate a /flow-dispatched shell: PIPELINE_RUN_DIR ambient in the test
  // runner's OWN process.env, pointed at the decoy run — NOT passed via this
  // call's `env` option.
  const savedAmbient = process.env.PIPELINE_RUN_DIR;
  process.env.PIPELINE_RUN_DIR = decoyRun;
  let result;
  try {
    result = runHook(['record-pr', '7', 'https://github.com/o/r/pull/7']);
  } finally {
    if (savedAmbient === undefined) delete process.env.PIPELINE_RUN_DIR;
    else process.env.PIPELINE_RUN_DIR = savedAmbient;
  }

  assert.match(result.stdout, /no pipeline run dir found/,
    'a call site that never passed PIPELINE_RUN_DIR must not resolve one from the test runner\'s ambient env');
  const state = JSON.parse(fs.readFileSync(path.join(decoyRun, 'run-state.json'), 'utf8'));
  assert.strictEqual(state.pr, undefined, 'decoy run-state.json must gain no pr field from the ambient env leak');
});

// ─── #1012: unambiguous-only implicit resolution, named regression fixture ─
//
// Pinned exactly per the record's Deliverables: four non-terminal run dirs
// under one main checkout, callers A/B/C each cwd'd in their own worktree
// with their own run bound to it, run D bound to a fourth worktree whose
// agent is absent — all four runs record the SAME sessionId (the #965
// shared-id shape). Each of A/B/C invokes `close-run --help` (must hit the
// unknown-flag usage path — zero state reads/writes) and bare `close-run`
// (must hit resolution step 2 — its own cwd-bound run, never step 3's
// multi-candidate scan). All spawns clear PIPELINE_RUN_DIR explicitly via
// runHook's own baked-in default (#1038's hermeticity fix, applied here from
// the start).
function mkBoundRun(project, name, state) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return run;
}

test('#1012 named regression: A/B/C each act only on their own cwd-bound run via --help and bare close-run; run D (agent absent) stays byte-identical throughout', () => {
  const main = gitRepo();
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  const wtC = linkedWorktreeOf(main);
  const wtD = linkedWorktreeOf(main); // run D's binding — its own agent is absent (nobody cwd's here)
  const SESSION = 'shared-session'; // #965: identical across every caller below, by design
  const runA = mkBoundRun(main, '2026-07-01T090000-a', { status: 'active', sessionId: SESSION, worktree: wtA });
  const runB = mkBoundRun(main, '2026-07-01T090001-b', { status: 'active', sessionId: SESSION, worktree: wtB });
  const runC = mkBoundRun(main, '2026-07-01T090002-c', { status: 'active', sessionId: SESSION, worktree: wtC });
  const runD = mkBoundRun(main, '2026-07-01T090003-d', { status: 'active', sessionId: SESSION, worktree: wtD });
  const runDBefore = readRunState(runD);

  for (const [label, wt, run] of [['A', wtA, runA], ['B', wtB, runB], ['C', wtC, runC]]) {
    const help = runHook(['close-run', '--help'], { cwd: wt, env: { CLAUDE_CODE_SESSION_ID: SESSION } });
    assert.strictEqual(help.code, 0, `caller ${label}: close-run --help must exit 0`);
    assert.strictEqual(help.stdout, 'claude-tweaks: usage: close-run [--run <dir>]\n', `caller ${label}: --help must print exactly the usage line, no lib call`);
    assert.strictEqual(readRunState(run).status, 'active', `caller ${label}: --help must leave its own run untouched`);
    assert.deepStrictEqual(readRunState(runD), runDBefore, `caller ${label}: --help must never touch run D`);

    const bare = runHook(['close-run'], { cwd: wt, env: { CLAUDE_CODE_SESSION_ID: SESSION } });
    assert.strictEqual(bare.code, 0, `caller ${label}: bare close-run must exit 0`);
    assert.strictEqual(readRunState(run).status, 'clean', `caller ${label}: bare close-run must close its own cwd-bound run (resolution step 2)`);
    assert.deepStrictEqual(readRunState(runD), runDBefore, `caller ${label}: bare close-run must never touch run D — it has no cwd-binding hit here and step 2 alone resolves the caller's own run`);
  }
});

// Unbound-caller variant (the #860/#758 incident shape): a fourth caller of
// the SAME session, cwd'd in a worktree with NO run bound to it, invokes
// bare close-run. Resolution step 2 misses (no run recorded this worktree);
// step 3 excludes every one of A/B/C/D as 'foreign' (classifyOwnership's
// worktree-binding proof: same or missing session id, but each run's
// recorded binding is a different live worktree than this caller's own) ->
// zero candidates survive -> refusal (step 4), and no run-state file changes.
test('#1012 unbound-caller variant: a same-session caller with no bound run of its own is refused (step 4) rather than resolving into any of A/B/C/D', () => {
  const main = gitRepo();
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  const wtC = linkedWorktreeOf(main);
  const wtD = linkedWorktreeOf(main);
  const wtStray = linkedWorktreeOf(main); // the unbound caller's own worktree — no run recorded here
  const SESSION = 'shared-session';
  const runA = mkBoundRun(main, '2026-07-01T090000-a', { status: 'active', sessionId: SESSION, worktree: wtA });
  const runB = mkBoundRun(main, '2026-07-01T090001-b', { status: 'active', sessionId: SESSION, worktree: wtB });
  const runC = mkBoundRun(main, '2026-07-01T090002-c', { status: 'active', sessionId: SESSION, worktree: wtC });
  const runD = mkBoundRun(main, '2026-07-01T090003-d', { status: 'active', sessionId: SESSION, worktree: wtD });
  const before = [runA, runB, runC, runD].map(readRunState);

  const result = runHook(['close-run'], { cwd: wtStray, env: { CLAUDE_CODE_SESSION_ID: SESSION } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /pass --run explicitly/, 'zero survivors among four candidates must refuse, not silently pick one');
  assert.match(result.stdout, /Run not closed/);

  const after = [runA, runB, runC, runD].map(readRunState);
  assert.deepStrictEqual(after, before, 'no run-state.json file changes when every candidate is excluded as foreign');
});
