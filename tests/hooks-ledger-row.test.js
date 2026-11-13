'use strict';
// tests/hooks-ledger-row.test.js — #4439: `hooks.js ledger-row`, the sanctioned
// writer for a plain open-items ledger row (append, or settle by row number).
// Every test spawns the real CLI and asserts stdout, stderr and the exit code
// separately; a refusal also asserts the ledger's bytes did not move.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLedger } = require('../plugin/bin/lib/wrap-up/pack');
const { fixtureGit } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SESSION = 'ledger-row-test';
const HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const ROW_RE = /^\|\s*\d+\s*\|/;

const tmpDirs = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function git(args, cwd) {
  return fixtureGit(args, { cwd, encoding: 'utf8' });
}

function hookEnv(env = {}) {
  return {
    ...process.env, PIPELINE_RUN_DIR: '', CLAUDE_CODE_SESSION_ID: SESSION, ...env,
  };
}

function runHook(args, { cwd, env } = {}) {
  const r = spawnSync(process.execPath, [HOOKS, ...args], { cwd, encoding: 'utf8', env: hookEnv(env) });
  assert.ifError(r.error);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function seedRepo(prefix) {
  const root = tmp(prefix);
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

// A run dir under `root` stamped by the real record-worktree writer for `session`, bound to `worktree`.
function stampedRun(root, id, worktree, session = SESSION) {
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const r = runHook(['record-worktree', '--run', runDir, worktree], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: session } });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return runDir;
}

// A repo, a linked worktree `wt`, the run `record-1` stamped for this test's session and bound to `wt`,
// its materialized header `work/1-spec.md`, and a ledger in the worktree holding the table head. `snapshot` is
// the ledger's starting bytes, which `refused` compares against; a test that writes first re-stamps it.
function fixture({ header = true, rows = '' } = {}) {
  const root = seedRepo('ct-ledgerrow-');
  const wt = path.join(tmp('ct-ledgerrow-wt-'), 'wt');
  git(['worktree', 'add', '-q', wt, '-b', 'feat'], root);
  const runDir = stampedRun(root, '2026-11-03T000000-record-1', wt);
  if (header) {
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '1-spec.md'), '---\nrecord: 1\n---\n');
  }
  const ledger = path.join(wt, 'docs', 'plans', '2026-11-03-x-ledger.md');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, HEAD + rows);
  return {
    root, wt, runDir, ledger, snapshot: HEAD + rows, before: () => fs.readFileSync(ledger, 'utf8'),
  };
}

// Runs the verb from inside the linked worktree. The explicit run is the default; `implicit` drops it.
function ledgerRow(f, args, { implicit = false, env } = {}) {
  const runArgs = implicit ? [] : ['--run', f.runDir];
  return runHook(['ledger-row', ...runArgs, '--ledger', f.ledger, ...args], { cwd: f.wt, env });
}

const ledgerRows = (f) => f.before().split('\n').filter((l) => ROW_RE.test(l));

function refused(f, result, pattern, { code = 1, before } = {}) {
  const text = before === undefined ? f.snapshot : before;
  assert.equal(result.code, code, result.stderr);
  assert.equal(result.stdout, '', 'a refusal writes nothing to stdout');
  assert.match(result.stderr, pattern);
  assert.match(result.stderr, / — nothing written\n$/);
  assert.equal(f.before(), text, 'a refusal leaves the ledger byte-identical');
}

const APPEND = ['--phase', 'build', '--item', 'item', '--status', 'open'];

test('AC1.1: from a linked worktree, ledger-row appends one row keeping the escaped pipe', () => {
  const f = fixture();
  const r = runHook(['ledger-row', '--ledger', f.ledger, '--phase', 'build', '--item', 'a | b', '--status', 'open'], { cwd: f.wt });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.endsWith('\n') && r.stdout.trim().split('\n').length === 1, 'exactly one JSON line');
  assert.deepEqual(JSON.parse(r.stdout), {
    action: 'appended', row: 1, status: 'open', ledger: f.ledger,
  });
  assert.deepEqual(ledgerRows(f), ['| 1 | build | a \\| b | open | — |']);
});

test('AC1.1 lock: a held ledger lock refuses and writes nothing', () => {
  const f = fixture();
  const lock = path.join(f.runDir, '.ledger.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, '.owner'), `${process.pid}-held`);
  const r = ledgerRow(f, APPEND, { env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '30' } });
  refused(f, r, /lock/);
  assert.match(r.stderr, /LOCK_TIMEOUT/);
  assert.match(r.stderr, /retry once/);
});

test('AC2.1: --row 3 --status fixed --resolution abc123 rewrites only row 3\'s Status and Resolution', () => {
  const f = fixture({ rows: '| 1 | build | one | open | — |\n| 2 | build | two | open | — |\n| 3 | build | three | open | — |\n' });
  const before = f.before().split('\n');
  const r = ledgerRow(f, ['--row', '3', '--status', 'fixed', '--resolution', 'abc123']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  const out = JSON.parse(r.stdout);
  assert.equal(out.action, 'settled');
  assert.equal(out.row, 3);
  assert.equal(out.status, 'fixed');
  const after = f.before().split('\n');
  assert.equal(after.length, before.length);
  after.forEach((line, i) => {
    assert.equal(line, before[i] === '| 3 | build | three | open | — |' ? '| 3 | build | three | fixed | abc123 |' : before[i]);
  });
});

test('AC2.2: --status resolved exits non-zero naming the enum', () => {
  const f = fixture({ rows: '| 1 | build | one | open | — |\n' });
  refused(f, ledgerRow(f, ['--row', '1', '--status', 'resolved', '--resolution', 'x']), /open, fixed, deferred, accepted, acknowledged, observation/);
  refused(f, ledgerRow(f, ['--row', '1', '--status', 'resolved']), /open, fixed, deferred, accepted, acknowledged, observation/);
});

test('AC3.1: two concurrent appends from two child processes take distinct row numbers', async () => {
  const f = fixture();
  const children = [0, 1].map((i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOKS, 'ledger-row', '--run', f.runDir, '--ledger', f.ledger, '--phase', 'build', '--item', `item-${i}`, '--status', 'open'], {
      cwd: f.wt, env: hookEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  }));
  const results = await Promise.all(children);
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results.map((r) => JSON.parse(r.stdout).row).sort(), [1, 2]);
  const rows = ledgerRows(f);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((l) => l.split('|')[1].trim()).sort(), ['1', '2']);
  for (const i of [0, 1]) assert.equal(rows.filter((l) => l.includes(`| item-${i} |`)).length, 1);
});

test('Q1: a Defer-reason alone writes the row and flags incompleteDeferral', () => {
  const f = fixture();
  const r = ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'Defer-reason: tangential']);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.incompleteDeferral, true);
  assert.deepEqual(parseLedger(f.before()).deferredUnstagedItems, [String(out.row)]);
});

test('Q1: a staged path writes the row with no flag', () => {
  const f = fixture();
  const r = ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'staged/ledger-record-a.md']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!('incompleteDeferral' in JSON.parse(r.stdout)));
  assert.deepEqual(parseLedger(f.before()).deferredUnstagedItems, []);
});

test('Q1: neither is refused, naming the rule', () => {
  const f = fixture();
  refused(f, ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'later']), /staged\//);
  const r = ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'later']);
  assert.match(r.stderr, /Defer-reason:/);
});

test('own record is not a record reference', () => {
  const f = fixture();
  refused(f, ledgerRow(f, ['--phase', 'build', '--item', 'x', '--status', 'deferred', '--resolution', 'see #1']), /staged\/.*Defer-reason:/);
  const other = ledgerRow(f, ['--phase', 'build', '--item', 'x', '--status', 'deferred', '--resolution', 'see #2']);
  assert.equal(other.code, 0, other.stderr);
});

test('amendment 2: a deferred row naming only the run\'s own record settles through the CLI', () => {
  const f = fixture({ rows: '| 1 | build | x | deferred | see #1 |\n' });
  const r = ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'superseded by the build']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), ['| 1 | build | x | accepted | superseded by the build |']);

  // Go-red: with no materialized header the run owns no record, so `#1` reads as a record reference.
  const bare = fixture({ header: false, rows: '| 1 | build | x | deferred | see #1 |\n' });
  refused(bare, ledgerRow(bare, ['--row', '1', '--status', 'accepted', '--resolution', 'superseded by the build']), /row #1/);
});

test('amendment 1: an implicit run owned by another session is refused', () => {
  const f = fixture();
  const elsewhere = tmp('ct-ledgerrow-other-');
  const runDir2 = stampedRun(f.root, '2026-11-03T000001-record-9', elsewhere, 'someone-else');
  const ledger2 = path.join(runDir2, 'ledger.md');
  fs.writeFileSync(ledger2, HEAD);
  const before2 = fs.readFileSync(ledger2, 'utf8');

  const r = runHook(['ledger-row', ...APPEND], { cwd: f.wt, env: { PIPELINE_RUN_DIR: runDir2 } });
  refused(f, r, /recorded by another session\/worktree/);
  assert.equal(fs.readFileSync(ledger2, 'utf8'), before2);

  // The bypass: an explicit --run on the same run dir writes.
  const explicit = runHook(['ledger-row', '--run', runDir2, ...APPEND], { cwd: f.wt });
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.equal(explicit.stderr, '');
  assert.equal(JSON.parse(explicit.stdout).ledger, ledger2);
  assert.equal(fs.readFileSync(ledger2, 'utf8'), `${before2}| 1 | build | item | open | — |\n`);
  assert.equal(f.before(), f.snapshot);
});

test('Q2: settling a terminal row exits 1 naming the row and status', () => {
  const f = fixture({ rows: '| 1 | build | x | fixed | abc123 |\n' });
  const r = ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'changed my mind']);
  refused(f, r, /row #1/);
  assert.match(r.stderr, /fixed/);
});

test('answer 1: the refused-proposal reopen through the CLI', () => {
  const f = fixture({ rows: '| 1 | build | x | deferred | staged/ledger-record-a.md |\n' });
  refused(f, ledgerRow(f, ['--row', '1', '--status', 'open', '--resolution', 'reopened']), /proposal refused — no defer reason/);
  const r = ledgerRow(f, ['--row', '1', '--status', 'open', '--resolution', 'staged/ledger-record-a.md refused — proposal refused — no defer reason']);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.action, 'settled');
  assert.equal(out.row, 1);
  assert.equal(out.status, 'open');
  assert.deepEqual(ledgerRows(f), ['| 1 | build | x | open | staged/ledger-record-a.md refused — proposal refused — no defer reason |']);
});

const PIPE_TEXT = 'a | `b` $c';
const PIPE_CELL = 'a \\| `b` $c';

function textFile(name, content) {
  const file = path.join(tmp('ct-ledgerrow-file-'), name);
  fs.writeFileSync(file, content);
  return file;
}

test('answer 5: --item-file carries a pipe, a backtick and $ intact', () => {
  const f = fixture();
  const r = ledgerRow(f, ['--phase', 'build', '--item-file', textFile('item.txt', `${PIPE_TEXT}\n`), '--status', 'open']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), [`| 1 | build | ${PIPE_CELL} | open | — |`]);
});

test('answer 5: --resolution-file carries a pipe, a backtick and $ intact', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  const r = ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution-file', textFile('res.txt', `${PIPE_TEXT}\r\n`)]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), [`| 1 | build | x | accepted | ${PIPE_CELL} |`]);
});

test('answer 5: a file flag with its argv twin exits 2', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  const file = textFile('t.txt', 'text\n');
  const item = ledgerRow(f, ['--phase', 'build', '--item', 'x', '--item-file', file, '--status', 'open']);
  refused(f, item, /--item and --item-file/, { code: 2 });
  const resolution = ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'x', '--resolution-file', file]);
  refused(f, resolution, /--resolution and --resolution-file/, { code: 2 });
});

const FILE_CASES = [
  ['--item-file', (file) => ['--phase', 'build', '--item-file', file, '--status', 'open']],
  ['--resolution-file', (file) => ['--row', '1', '--status', 'accepted', '--resolution-file', file]],
];

test('answer 5: an empty file exits 2', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  for (const [flag, args] of FILE_CASES) {
    for (const content of ['', '\n\n']) {
      refused(f, ledgerRow(f, args(textFile('empty.txt', content))), new RegExp(`${flag}.*empty`), { code: 2 });
    }
  }
});

test('answer 5: an unreadable file and an interior newline exit 2', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  for (const [flag, args] of FILE_CASES) {
    const missing = path.join(tmp('ct-ledgerrow-missing-'), 'nope.txt');
    const r = ledgerRow(f, args(missing));
    refused(f, r, new RegExp(flag), { code: 2 });
    assert.ok(r.stderr.includes(missing), 'names the path');
    refused(f, ledgerRow(f, args(textFile('two.txt', 'a\nb'))), /one table line/, { code: 2 });
  }
});

test('answer 6: fixed with this repo\'s /pull/N URL through the CLI', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n| 2 | build | y | open | — |\n' });
  git(['remote', 'add', 'origin', 'https://github.com/o/r.git'], f.root);
  const ok = ledgerRow(f, ['--row', '1', '--status', 'fixed', '--resolution', 'https://github.com/o/r/pull/7']);
  assert.equal(ok.code, 0, ok.stderr);
  f.snapshot = f.before();
  refused(f, ledgerRow(f, ['--row', '2', '--status', 'fixed', '--resolution', 'https://github.com/o/r/issues/7']), /needs a commit sha, file reference, or resolving PR/);
});

test('answer 6: fixed with this repo\'s /pull/N URL reads an ssh:// or credentialed-https origin the way the gate does (#4794)', () => {
  for (const origin of ['ssh://git@github.com/o/r.git', 'https://x:tok@github.com/o/r.git']) {
    const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
    git(['remote', 'add', 'origin', origin], f.root);
    const ok = ledgerRow(f, ['--row', '1', '--status', 'fixed', '--resolution', 'https://github.com/o/r/pull/7']);
    assert.equal(ok.code, 0, `${origin}: ${ok.stderr}`);
  }
});

test('rejects a --ledger outside the run and worktree', () => {
  const f = fixture();
  const outside = path.join(tmp('ct-ledgerrow-out-'), 'x-ledger.md');
  fs.writeFileSync(outside, HEAD);
  const r = runHook(['ledger-row', '--run', f.runDir, '--ledger', outside, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /outside the run directory and worktree/);
  assert.equal(fs.readFileSync(outside, 'utf8'), HEAD);
});

test('a --ledger that does not exist is refused, without a hint to pass the flag it already carries', () => {
  const f = fixture();
  const r = runHook(['ledger-row', '--run', f.runDir, '--ledger', path.join(f.wt, 'docs', 'plans', 'missing-ledger.md'), ...APPEND], { cwd: f.wt });
  refused(f, r, /not-found/);
  assert.doesNotMatch(r.stderr, /pass --ledger/);
});

test('an implicit resolution that finds no ledger keeps the hint to pass --ledger', () => {
  const f = fixture();
  fs.rmSync(f.ledger);
  const r = runHook(['ledger-row', '--run', f.runDir, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /ledger not-found — pass --ledger <path> to name one — nothing written\n$/);
});

test('refuses an empty --ledger value', () => {
  const f = fixture();
  refused(f, runHook(['ledger-row', '--run', f.runDir, '--ledger', '', ...APPEND], { cwd: f.wt }), /--ledger needs a path/);
});

test('a ledger that exists only in the worktree copy is written through an explicit --ledger', () => {
  // The parallel-wave member shape: its run dir carries decisions.md and work/ but no run-state.json,
  // so no worktree is recorded and no ledger lives under it.
  const f = fixture();
  const runDir3 = path.join(f.root, '.claude-tweaks', 'pipelines', '2026-11-03T000002-record-3');
  fs.mkdirSync(path.join(runDir3, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir3, 'work', '3-spec.md'), '---\nrecord: 3\n---\n');
  fs.writeFileSync(path.join(runDir3, 'decisions.md'), '# decisions\n');
  // A second ledger this branch owns makes implicit resolution ambiguous, so only the explicit --ledger can pick the target.
  const sibling = path.join(f.wt, 'docs', 'plans', '2026-11-03-y-ledger.md');
  fs.writeFileSync(sibling, HEAD);
  const r = runHook(['ledger-row', '--run', runDir3, '--ledger', f.ledger, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(sibling, 'utf8'), HEAD);
  assert.deepEqual(ledgerRows(f), ['| 1 | build | item | open | — |']);
  // Nothing new under the run dir, and the lock dir the write took is gone.
  assert.deepEqual(fs.readdirSync(runDir3, { recursive: true }).sort(), ['decisions.md', 'work', path.join('work', '3-spec.md')]);
});

test('run resolution: no run dir, an unusable --run and ambiguous candidates each refuse', () => {
  const bare = seedRepo('ct-ledgerrow-bare-');
  const none = runHook(['ledger-row', ...APPEND], { cwd: bare });
  assert.equal(none.code, 1);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /no pipeline run dir found — nothing written/);

  const f = fixture();
  const bad = runHook(['ledger-row', '--run', path.join(f.root, 'nope'), '--ledger', f.ledger, ...APPEND], { cwd: f.wt });
  refused(f, bad, /--run path rejected/);

  stampedRun(f.root, '2026-11-03T000009-record-9', tmp('ct-ledgerrow-nine-'));
  const many = runHook(['ledger-row', '--ledger', f.ledger, ...APPEND], { cwd: f.root });
  assert.equal(many.code, 1);
  assert.equal(many.stdout, '');
  assert.match(many.stderr, /multiple candidate runs — pass --run explicitly:/);
  assert.match(many.stderr, /ledger-row --run /);
  assert.equal(f.before(), f.snapshot);
});

test('refuses --row together with --item, --item-file or --phase', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  const file = textFile('i.txt', 'text\n');
  for (const extra of [['--item', 'y'], ['--item-file', file], ['--phase', 'build']]) {
    refused(f, ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'z', ...extra]), /--row/);
  }
});

test('refuses --row with no --resolution, and a non-numeric --row', () => {
  const f = fixture({ rows: '| 1 | build | x | open | — |\n' });
  refused(f, ledgerRow(f, ['--row', '1', '--status', 'accepted']), /resolution/);
  // `open` passes checkLedgerStatus with no resolution, so only the verb's own settle guard refuses it.
  refused(f, ledgerRow(f, ['--row', '1', '--status', 'open']), /settling row #1 to 'open' needs --resolution or --resolution-file/);
  refused(f, ledgerRow(f, ['--row', 'one', '--status', 'accepted', '--resolution', 'z']), /--row/);
  const observation = ledgerRow(f, ['--row', '1', '--status', 'observation']);
  assert.equal(observation.code, 0, observation.stderr);
});

test('refuses an append with no --phase, no item or no --status', () => {
  const f = fixture();
  refused(f, ledgerRow(f, ['--item', 'x', '--status', 'open']), /--phase/);
  refused(f, ledgerRow(f, ['--phase', 'build', '--status', 'open']), /--item/);
  refused(f, ledgerRow(f, ['--phase', 'build', '--item', 'x']), /--status/);
});

test('refuses a stray positional argument instead of truncating an unquoted value', () => {
  const f = fixture();
  refused(f, ledgerRow(f, ['--phase', 'build', '--item', 'a', 'b', '--status', 'open']), /unexpected argument 'b'/);
});

test('refuses an undeclared flag in both orders', () => {
  const f = fixture();
  for (const args of [['--bogus', ...APPEND], [...APPEND, '--bogus']]) {
    const r = ledgerRow(f, args);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    // The dispatcher's two-line refusal: the reason, then the verb's usage line.
    const lines = r.stderr.split('\n');
    assert.equal(lines[0], "claude-tweaks: ledger-row: unknown flag '--bogus'");
    assert.ok(lines[1].startsWith('claude-tweaks: usage: ledger-row [--run <dir>]'), lines[1]);
    assert.equal(lines.length, 3, 'two lines and the trailing newline');
    assert.equal(f.before(), f.snapshot);
  }
});

test('--help prints the usage line', () => {
  const r = runHook(['ledger-row', '--help'], { cwd: tmp('ct-ledgerrow-help-') });
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('ledger-row [--run <dir>]'));
  assert.equal(r.stderr, '');
});
