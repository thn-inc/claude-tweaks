// tests/hooks-help-guard.test.js
//
// #1143: bin/hooks.js's subcommands treated `--help`/`-h` as an ordinary
// argument and ran the verb for real — several fell through to
// resolveRunArg's implicit "newest non-terminal run" GUESS, which could
// stamp a sibling session's run-state.json (observed 2026-08-20, run
// spec-1071 → backlog-standalone; the bridging docs/donts.md rule this
// record removes). This suite pins the fix: a `--help`/`-h` anywhere in a
// documented subcommand's argument list must intercept before any lib call
// or write, print that verb's usage, and exit 0 — for every verb in
// hooks.js's own USAGE table, not just record-worktree (#1124 already
// covered that one narrowly; tests/hooks-dispatcher.test.js pins its
// specific stdout/exit-code shape).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRunState } = require('../plugin/bin/lib/hooks/context');
const { USAGE, VERBS } = require('../plugin/bin/hooks.js');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// Mirrors tests/hooks-dispatcher.test.js's own sandbox/runHook convention
// (#1130: never let an omitted cwd fall through to the test runner's real
// cwd — a real checkout's .claude-tweaks/pipelines/ must never be touched).
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-help-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  const r = spawnSync('node', [HOOKS, ...args], {
    input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// A real, initialized run dir under a real git checkout — every --run-
// accepting verb's "no side effects" claim is checked against this fixture
// so a regression that starts writing again shows up as a byte diff, not
// just a missing stdout line.
function projectWithRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-help-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return { dir, run };
}

const VERB_NAMES = Object.keys(USAGE);

test('#1143: every USAGE-table verb honors --help — usage text, exit 0, no lib call', () => {
  for (const verb of VERB_NAMES) {
    const result = runHook([verb, '--help']);
    assert.strictEqual(result.code, 0, `${verb} --help must exit 0`);
    assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, `${verb} --help stdout must be exactly the usage line, nothing else`);
  }
});

test('#1143: every USAGE-table verb honors -h identically to --help', () => {
  for (const verb of VERB_NAMES) {
    const result = runHook([verb, '-h']);
    assert.strictEqual(result.code, 0, `${verb} -h must exit 0`);
    assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, `${verb} -h stdout must match --help's`);
  }
});

test('#1143: --help anywhere in the argument list intercepts, not just as the first arg', () => {
  // record-pr's real shape is `record-pr [--run <dir>] <number> <url>` — a
  // --help buried after other-looking positionals must still intercept
  // before record-pr's own numberArg/urlArg validation ever runs.
  const result = runHook(['record-pr', '--run', '/does/not/exist', '123', '--help']);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE['record-pr']}\n`);
  assert.doesNotMatch(result.stdout, /PR not recorded/, 'must never fall through to record-pr\'s own --run-rejection message');
});

test('#1143: --help on every --run-accepting verb writes nothing to run-state.json (AC1)', () => {
  const runAccepting = ['record-worktree', 'record-pr', 'spec-status', 'manifest-init', 'close-run', 'teardown-run', 'archive-run', 'check-resume-freshness', 'check-staged-inventory', 'check-session-residue', 'check-pass-reentry', 'sweep-shadow', 'resolve-ledger'];
  for (const verb of runAccepting) {
    const { dir, run } = projectWithRun();
    const before = readRunState(run);
    const result = runHook([verb, '--run', run, '--help'], { cwd: dir });
    assert.strictEqual(result.code, 0, `${verb} --run <dir> --help must exit 0`);
    assert.deepStrictEqual(readRunState(run), before, `${verb} --help must leave run-state.json byte-unchanged`);
  }
});

// A verb absent from the USAGE table (an EVENTS name, or plain garbage) gets
// no guard by design — the guard's membership check is USAGE[cmd], not a
// blanket "any --help anywhere" rule, so this must NOT print a usage line.
test('#1143: --help on a non-USAGE-table command is not intercepted (guard is table-scoped, not global)', () => {
  const result = runHook(['session-start', '--help'], { input: '{}' });
  assert.strictEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /usage:/);
});

test('#1143: AC2 — the documented state-mutating verbs named in the issue each have a usage entry', () => {
  for (const verb of ['record-worktree', 'record-pr', 'close-run', 'resolve-run-dir', 'spec-status']) {
    assert.ok(USAGE[verb], `${verb} must have a USAGE entry`);
  }
});

test('AC3.1: every VERBS entry carries its own usage line and a run handler, and USAGE is derived from it', () => {
  assert.ok(Object.keys(VERBS).length >= 21, 'expected at least the 21 documented verbs');
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.strictEqual(typeof entry.usage, 'string', `${verb} usage must be a string`);
    assert.ok(entry.usage === verb || entry.usage.startsWith(`${verb} `), `${verb}'s usage line must start with its own key`);
    assert.strictEqual(typeof entry.run, 'function', `${verb} must carry a run handler`);
  }
  assert.deepStrictEqual(USAGE, Object.fromEntries(Object.entries(VERBS).map(([v, e]) => [v, e.usage])));
});

test('AC3.1: every table key appears in the unknown-verb usage output', () => {
  const r = runHook(['no-such-verb'], { input: '{}' });
  assert.strictEqual(r.code, 1);
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.ok(r.stderr.includes(`\n  ${entry.usage}\n`), `usage output must list ${verb}: ${entry.usage}`);
  }
  assert.ok(r.stderr.includes('\n  <event>  (harness hook events, JSON on stdin: session-start, '), 'usage output must end with the hook-events line');
});

test('AC2.1: an unknown or missing verb prints the table-derived usage text after its error line', () => {
  for (const args of [['no-such-verb'], []]) {
    const r = runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /^claude-tweaks: (unrecognized hooks\.js subcommand 'no-such-verb'|no hooks\.js subcommand given)[^\n]*\nclaude-tweaks: hooks\.js usage:\n/);
  }
});

test('prototype-chain names are unrecognized verbs, never dispatched', () => {
  for (const args of [['constructor'], ['toString', '--help'], ['__proto__']]) {
    const r = runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1, `${args.join(' ')} must exit 1`);
    assert.match(r.stderr, /unrecognized hooks\.js subcommand/);
  }
});
