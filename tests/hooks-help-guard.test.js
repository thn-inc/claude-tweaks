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
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRunState } = require('../plugin/bin/lib/hooks/context');
const { USAGE } = require('../plugin/bin/hooks.js');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// Mirrors tests/hooks-dispatcher.test.js's own sandbox/runHook convention
// (#1130: never let an omitted cwd fall through to the test runner's real
// cwd — a real checkout's .claude-tweaks/pipelines/ must never be touched).
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-help-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
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

const VERBS = Object.keys(USAGE);

test('#1143: every USAGE-table verb honors --help — usage text, exit 0, no lib call', () => {
  for (const verb of VERBS) {
    const result = runHook([verb, '--help']);
    assert.strictEqual(result.code, 0, `${verb} --help must exit 0`);
    assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, `${verb} --help stdout must be exactly the usage line, nothing else`);
  }
});

test('#1143: every USAGE-table verb honors -h identically to --help', () => {
  for (const verb of VERBS) {
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
  const runAccepting = ['record-worktree', 'record-pr', 'spec-status', 'close-run', 'teardown-run', 'archive-run', 'check-resume-freshness', 'check-staged-inventory', 'check-session-residue', 'sweep-shadow'];
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

// review 3c (medium, direct-verification-confirmed): the tests above only
// prove every USAGE-table key gets a guard — none of them prove the reverse,
// that every argv-dispatched verb IN hooks.js's main() has a USAGE entry. A
// future subcommand added to main()'s `cmd === '...'` chain without a
// matching USAGE entry would silently ship with no --help guard at all,
// reintroducing the exact hazard this record exists to close, and none of
// the tests above would catch it (they only ever iterate Object.keys(USAGE),
// never hooks.js's actual dispatch branches). This test closes that gap by
// scanning main()'s own source text for every `cmd === '...'` branch and
// asserting each one is a USAGE key — EVENTS names are dispatched via a
// separate `EVENTS.includes(cmd)` check (line ~818), never a `cmd === 'x'`
// branch, so they're correctly excluded by construction, not by an allowlist
// that could itself drift.
test('#1143: every cmd === \'...\' dispatch branch in main() has a matching USAGE entry (guard coverage cannot silently regress)', () => {
  const source = fs.readFileSync(HOOKS, 'utf8');
  const mainStart = source.indexOf('async function main(');
  assert.ok(mainStart !== -1, 'main() not found in hooks.js — has it been renamed?');
  const mainEnd = source.indexOf('\nif (require.main === module)', mainStart);
  assert.ok(mainEnd !== -1, 'end-of-main marker not found in hooks.js — has the require.main guard moved?');
  const mainBody = source.slice(mainStart, mainEnd);
  const dispatchedVerbs = [...mainBody.matchAll(/cmd === '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(dispatchedVerbs.length >= 14, `expected at least the 14 documented verbs, found ${dispatchedVerbs.length} — has the extraction regex broken?`);
  for (const verb of dispatchedVerbs) {
    assert.ok(USAGE[verb], `main() dispatches '${verb}' via cmd === '${verb}' but USAGE has no entry for it — that verb gets no --help guard`);
  }
});
