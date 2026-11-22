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
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { readRunState } = require('../plugin/bin/lib/hooks/context');
const { USAGE, VERBS } = require('../plugin/bin/hooks.js');
const { runCli, spawnCli } = require('./helpers/run-cli');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// Mirrors tests/hooks-dispatcher.test.js's own sandbox/runHook convention
// (#1130: never let an omitted cwd fall through to the test runner's real
// cwd — a real checkout's .claude-tweaks/pipelines/ must never be touched).
const HOOK_SANDBOX = scratchDir('ct-help-sandbox-');

// In-process (#5375): the call goes through hooks.js's run(argv, deps); the env below is the
// complete environment the verb sees. Real-process coverage is the spawnCli smoke tests further down.
function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  return runCli(HOOKS, args, {
    stdin: input, cwd, env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
  });
}

// The bytes `node hooks.js no-such-verb` wrote to stderr at 6a43cd434, before hooks.js had
// run(argv, deps): the error line, then the table-derived usage text (USAGE, in table order),
// then the hook-events line. EVENTS is not exported, so that last line is spelled out.
const NO_SUCH_VERB_STDERR = "claude-tweaks: unrecognized hooks.js subcommand 'no-such-verb'\n"
  + 'claude-tweaks: hooks.js usage:\n'
  + Object.values(USAGE).map((usage) => `  ${usage}\n`).join('')
  + '  <event>  (harness hook events, JSON on stdin: session-start, session-end, pre-compact, pre-tool-use, post-tool-use, post-tool-use-failure, subagent-stop, user-prompt-submit)\n';

// A real, initialized run dir under a real git checkout — every --run-
// accepting verb's "no side effects" claim is checked against this fixture
// so a regression that starts writing again shows up as a byte diff, not
// just a missing stdout line.
function projectWithRun() {
  const dir = scratchDir('ct-help-proj-');
  execFileSync('git', ['-C', dir, 'init', '-q']);
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return { dir, run };
}

const VERB_NAMES = Object.keys(USAGE);

test('#1143: every USAGE-table verb honors --help — usage text, exit 0, no lib call', async () => {
  for (const verb of VERB_NAMES) {
    const result = await runHook([verb, '--help']);
    assert.strictEqual(result.code, 0, `${verb} --help must exit 0`);
    assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, `${verb} --help stdout must be exactly the usage line, nothing else`);
  }
});

test('#1143: every USAGE-table verb honors -h identically to --help', async () => {
  for (const verb of VERB_NAMES) {
    const result = await runHook([verb, '-h']);
    assert.strictEqual(result.code, 0, `${verb} -h must exit 0`);
    assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, `${verb} -h stdout must match --help's`);
  }
});

test('AC2.1 AC4.1: runCli(hooks, [verb, "--help"]) resolves to the usage line for every VERBS verb', async () => {
  for (const verb of Object.keys(VERBS)) {
    const r = await runHook([verb, '--help']);
    assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: usage: ${VERBS[verb].usage}\n`, stderr: '' }, verb);
  }
});

test('#5375: realDeps.stderr writes every byte, retries EAGAIN and never throws on another error', () => {
  const { realDeps } = require('../plugin/bin/hooks.js');
  const text = 'claude-tweaks: ledger-row: refused — nothing written\n';
  const original = fs.writeSync;
  const delivered = [];
  let call = 0;
  fs.writeSync = (fd, buf, off) => {
    call += 1;
    assert.strictEqual(fd, 2);
    if (call === 1) { delivered.push(buf.subarray(off, off + 10)); return 10; } // short write
    if (call === 2) { const e = new Error('full'); e.code = 'EAGAIN'; throw e; }
    if (call === 3) { delivered.push(buf.subarray(off, off + 5)); return 5; }
    const e = new Error('closed'); e.code = 'EBADF'; throw e; // unusable from here on
  };
  try {
    assert.doesNotThrow(() => realDeps.stderr(text));
  } finally {
    fs.writeSync = original;
  }
  assert.strictEqual(call, 4, 'short write, EAGAIN retry, second short write, then the EBADF stops it');
  assert.strictEqual(Buffer.concat(delivered).toString(), text.slice(0, 15));
});

test('#1143: --help anywhere in the argument list intercepts, not just as the first arg', async () => {
  // record-pr's real shape is `record-pr [--run <dir>] <number> <url>` — a
  // --help buried after other-looking positionals must still intercept
  // before record-pr's own numberArg/urlArg validation ever runs.
  const result = await runHook(['record-pr', '--run', '/does/not/exist', '123', '--help']);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stdout, `claude-tweaks: usage: ${USAGE['record-pr']}\n`);
  assert.doesNotMatch(result.stdout, /PR not recorded/, 'must never fall through to record-pr\'s own --run-rejection message');
});

test('#1143: --help on every --run-accepting verb writes nothing to run-state.json (AC1)', async () => {
  const runAccepting = ['record-worktree', 'record-pr', 'spec-status', 'manifest-init', 'close-run', 'teardown-run', 'archive-run', 'check-resume-freshness', 'check-staged-inventory', 'check-session-residue', 'check-pass-reentry', 'sweep-shadow', 'resolve-ledger', 'ledger-row'];
  for (const verb of runAccepting) {
    const { dir, run } = projectWithRun();
    const before = readRunState(run);
    const result = await runHook([verb, '--run', run, '--help'], { cwd: dir });
    assert.strictEqual(result.code, 0, `${verb} --run <dir> --help must exit 0`);
    assert.deepStrictEqual(readRunState(run), before, `${verb} --help must leave run-state.json byte-unchanged`);
  }
});

// A verb absent from the USAGE table (an EVENTS name, or plain garbage) gets
// no guard by design — the guard's membership check is USAGE[cmd], not a
// blanket "any --help anywhere" rule, so this must NOT print a usage line.
test('#1143: --help on a non-USAGE-table command is not intercepted (guard is table-scoped, not global)', () => {
  // real process: an event reads process globals until #5377, so it cannot run in-process
  const result = spawnCli(HOOKS, ['session-start', '--help'], {
    cwd: HOOK_SANDBOX, stdin: '{}', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
  });
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

test('AC3.1: every table key appears in the unknown-verb usage output', async () => {
  const r = await runHook(['no-such-verb'], { input: '{}' });
  assert.strictEqual(r.code, 1);
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.ok(r.stderr.includes(`\n  ${entry.usage}\n`), `usage output must list ${verb}: ${entry.usage}`);
  }
  assert.ok(r.stderr.includes('\n  <event>  (harness hook events, JSON on stdin: session-start, '), 'usage output must end with the hook-events line');
});

test('AC2.1: an unknown or missing verb prints the table-derived usage text after its error line', async () => {
  for (const args of [['no-such-verb'], []]) {
    const r = await runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /^claude-tweaks: (unrecognized hooks\.js subcommand 'no-such-verb'|no hooks\.js subcommand given)[^\n]*\nclaude-tweaks: hooks\.js usage:\n/);
  }
});

test('prototype-chain names are unrecognized verbs, never dispatched', async () => {
  for (const args of [['constructor'], ['toString', '--help'], ['__proto__']]) {
    const r = await runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1, `${args.join(' ')} must exit 1`);
    assert.match(r.stderr, /unrecognized hooks\.js subcommand/);
  }
});

// Real-process smoke tests (#5375, AC5.1 / AC7.1): the script entry itself — the shebang file,
// the exit code and the bytes of a real process — which run(argv, deps) cannot show.
// script entry: a verb's --help through the real file
test('AC5.1: node hooks.js ledger-row --help prints the usage line and exits 0', () => {
  const r = spawnCli(HOOKS, ['ledger-row', '--help'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: usage: ${VERBS['ledger-row'].usage}\n`, stderr: '' });
});

// script entry: an unknown verb's exit 1 through process.exit
test('AC5.1: node hooks.js no-such-verb exits 1 with the unrecognized line and the usage text', () => {
  const r = spawnCli(HOOKS, ['no-such-verb'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.deepStrictEqual(r, { code: 1, stdout: '', stderr: NO_SUCH_VERB_STDERR });
});

// hook event: the event path still exits 0 through the entry catch
test('AC7.1: echo {} | node hooks.js session-end exits 0 with empty stdout', () => {
  const r = spawnCli(HOOKS, ['session-end'], { cwd: HOOK_SANDBOX, stdin: '{}', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' } });
  assert.deepStrictEqual({ code: r.code, stdout: r.stdout }, { code: 0, stdout: '' });
});

test('AC10.1: log-decision names the injected CLAUDE_PLUGIN_ROOT, not the runner\'s', async () => {
  const r = await runCli(HOOKS, ['log-decision'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '', CLAUDE_PLUGIN_ROOT: '/ct-injected-plugin-root' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /node "\/ct-injected-plugin-root\/bin\/log-decision\.js"/);
});
