'use strict';
// tests/hooks-ledger-row.test.js — #4439: `hooks.js ledger-row`, the sanctioned
// writer for a plain open-items ledger row (append, or settle by row number).
// Every test asserts stdout, stderr and the exit code separately; a refusal also
// asserts the ledger's bytes did not move. In-process (#5375): the calls go
// through hooks.js's run(argv, deps) via runCli, with `record-worktree` (the
// run-dir stamp) too. Real-process coverage is the AC3.1 two-child append and the
// four AC9.1 smoke tests, each marked with its reason.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLedger } = require('../plugin/bin/lib/wrap-up/pack');
const { cleanGitEnv, fixtureGit, writeIdentity } = require('./helpers/git-fixtures');
const { runCli, spawnCli } = require('./helpers/run-cli');

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
  return fixtureGit(args, { cwd, encoding: 'utf8', env: cleanGitEnv() });
}

// The complete env a hooks.js call sees. PIPELINE_RUN_DIR: '' neutralizes any ambient run-dir env var (#1130).
function hookEnv(env = {}) {
  return {
    ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CLAUDE_CODE_SESSION_ID: SESSION, ...env,
  };
}

function runHook(args, { cwd, env } = {}) {
  return runCli(HOOKS, args, { cwd, env: hookEnv(env) });
}

function seedRepo(prefix) {
  const root = tmp(prefix);
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

// A run dir under `root` stamped by the real record-worktree writer for `session`, bound to `worktree`.
async function stampedRun(root, id, worktree, session = SESSION) {
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const r = await runHook(['record-worktree', '--run', runDir, worktree], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: session } });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return runDir;
}

// A repo, a linked worktree `wt`, the run `record-1` stamped for this test's session and bound to `wt`,
// its materialized header `work/1-spec.md`, and a ledger in the worktree holding the table head. `snapshot` is
// the ledger's starting bytes, which `refused` compares against; a test that writes first re-stamps it.
async function fixture({ header = true, rows = '' } = {}) {
  const root = seedRepo('ct-ledgerrow-');
  const wt = path.join(tmp('ct-ledgerrow-wt-'), 'wt');
  git(['worktree', 'add', '-q', wt, '-b', 'feat'], root);
  const runDir = await stampedRun(root, '2026-11-03T000000-record-1', wt);
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
function ledgerRowArgs(f, args, { implicit = false } = {}) {
  const runArgs = implicit ? [] : ['--run', f.runDir];
  return ['ledger-row', ...runArgs, '--ledger', f.ledger, ...args];
}

function ledgerRow(f, args, { implicit = false, env } = {}) {
  return runHook(ledgerRowArgs(f, args, { implicit }), { cwd: f.wt, env });
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

test('AC1.1: from a linked worktree, ledger-row appends one row keeping the escaped pipe', async () => {
  const f = await fixture();
  const r = await runHook(['ledger-row', '--ledger', f.ledger, '--phase', 'build', '--item', 'a | b', '--status', 'open'], { cwd: f.wt });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.endsWith('\n') && r.stdout.trim().split('\n').length === 1, 'exactly one JSON line');
  assert.deepEqual(JSON.parse(r.stdout), {
    action: 'appended', row: 1, status: 'open', ledger: f.ledger,
  });
  assert.deepEqual(ledgerRows(f), ['| 1 | build | a \\| b | open | — |']);
});

// In-process, with the lock wait threaded: the injected 30ms wait must be the one the lock uses. process.env
// holds a decoy wait of 0 (set outside the call's leak-guard window), and the clock advances 1ms per Date.now
// call, so the poll count depends only on the wait read: 0 polls the held lock's owner file once, 30 polls it
// on every pass until the deadline. Counting those reads keeps the check free of real time.
test('AC1.1 lock: a held ledger lock refuses and writes nothing', async () => {
  const f = await fixture();
  const lock = path.join(f.runDir, '.ledger.lock');
  const owner = path.join(lock, '.owner');
  fs.mkdirSync(lock);
  fs.writeFileSync(owner, `${process.pid}-held`);
  const prior = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  const realNow = Date.now;
  const realRead = fs.readFileSync;
  let clock = realNow();
  let ownerReads = 0;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '0';
  Date.now = () => { clock += 1; return clock; };
  fs.readFileSync = function readFileSync(p, ...rest) {
    if (p === owner) ownerReads += 1;
    return realRead.call(this, p, ...rest);
  };
  let r;
  try {
    r = await ledgerRow(f, APPEND, { env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '30' } });
  } finally {
    fs.readFileSync = realRead;
    Date.now = realNow;
    if (prior === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prior;
  }
  refused(f, r, /lock/);
  assert.match(r.stderr, /LOCK_TIMEOUT/);
  assert.match(r.stderr, /retry once/);
  assert.ok(ownerReads > 1, `the held lock was polled ${ownerReads} time(s): the wait came from process.env's 0, not the injected 30`);
});

test('AC2.1: --row 3 --status fixed --resolution abc123 rewrites only row 3\'s Status and Resolution', async () => {
  const f = await fixture({ rows: '| 1 | build | one | open | — |\n| 2 | build | two | open | — |\n| 3 | build | three | open | — |\n' });
  const before = f.before().split('\n');
  const r = await ledgerRow(f, ['--row', '3', '--status', 'fixed', '--resolution', 'abc123']);
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

test('AC2.2: --status resolved exits non-zero naming the enum', async () => {
  const f = await fixture({ rows: '| 1 | build | one | open | — |\n' });
  refused(f, await ledgerRow(f, ['--row', '1', '--status', 'resolved', '--resolution', 'x']), /open, fixed, deferred, accepted, acknowledged, observation/);
  refused(f, await ledgerRow(f, ['--row', '1', '--status', 'resolved']), /open, fixed, deferred, accepted, acknowledged, observation/);
});

// Real processes: a lock held across processes. Two children are the only shape where two writers are
// separate OS processes; tests/bin-lib/stage-item/ledger.test.js's read-seam test is what proves the lock.
test('AC3.1: two concurrent appends from two child processes take distinct row numbers', async () => {
  const f = await fixture();
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

// Real process: the ledger-row family's success smoke test (AC9.1), twinned with the same append in-process.
test('AC3.1 AC9.1: ledger-row append through runCli and spawnCli returns the same code and stdout', async () => {
  const inProcess = await fixture();
  const spawned = await fixture();
  const a = await ledgerRow(inProcess, APPEND);
  const b = spawnCli(HOOKS, ledgerRowArgs(spawned, APPEND), { cwd: spawned.wt, env: hookEnv() });
  const shape = (r, f) => ({ code: r.code, stdout: r.stdout.split(JSON.stringify(f.ledger).slice(1, -1)).join('<ledger>'), stderr: r.stderr });
  assert.deepStrictEqual(shape(a, inProcess), shape(b, spawned));
  assert.deepStrictEqual(shape(a, inProcess), {
    code: 0, stdout: '{"action":"appended","row":1,"status":"open","ledger":"<ledger>"}\n', stderr: '',
  });
  assert.deepEqual(ledgerRows(spawned), ledgerRows(inProcess));
});

// Real process: the ledger-row family's refusal smoke test (AC9.1) — exit code and stderr of the script entry.
test('AC9.1: node hooks.js ledger-row --status resolved exits 1 naming the enum', async () => {
  const f = await fixture({ rows: '| 1 | build | one | open | — |\n' });
  const r = spawnCli(HOOKS, ledgerRowArgs(f, ['--row', '1', '--status', 'resolved', '--resolution', 'x']), { cwd: f.wt, env: hookEnv() });
  refused(f, r, /open, fixed, deferred, accepted, acknowledged, observation/);
});

const RUN_ID = '2026-11-03T000000-record-1';

// A repo holding a fresh run dir `RUN_ID` (run-state.json only), and a worktree path to record.
function recordFixture() {
  const root = seedRepo('ct-recordwt-');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const state = path.join(runDir, 'run-state.json');
  fs.writeFileSync(state, JSON.stringify({ status: 'active' }));
  return { root, runDir, state, wt: tmp('ct-recordwt-wt-') };
}

// Real process: the record-worktree family's success smoke test (AC9.1), twinned with the same call in-process.
test('AC3.1 AC9.1: record-worktree through runCli and spawnCli returns the same code and stdout', async () => {
  const inProcess = recordFixture();
  const spawned = recordFixture();
  const a = await runHook(['record-worktree', '--run', inProcess.runDir, inProcess.wt], { cwd: inProcess.root });
  const b = spawnCli(HOOKS, ['record-worktree', '--run', spawned.runDir, spawned.wt], { cwd: spawned.root, env: hookEnv() });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a, { code: 0, stdout: `claude-tweaks: worktree recorded for ${RUN_ID}\n`, stderr: '' });
  for (const f of [inProcess, spawned]) {
    const state = JSON.parse(fs.readFileSync(f.state, 'utf8'));
    assert.equal(state.worktree, f.wt);
    assert.equal(state.sessionId, SESSION);
  }
});

// The verb prints this refusal on stdout, so the exact stderr is empty.
test('record-worktree without --run exits 1 on stdout and records nothing', async () => {
  const f = recordFixture();
  const before = fs.readFileSync(f.state, 'utf8');
  const r = await runHook(['record-worktree', f.wt], { cwd: f.root });
  assert.deepStrictEqual(r, { code: 1, stdout: 'claude-tweaks: record-worktree requires --run — worktree not recorded\n', stderr: '' });
  assert.equal(fs.readFileSync(f.state, 'utf8'), before);
});

// AC10.1 (#5375): a relative worktree path is recorded against the injected cwd, not the runner's.
test('AC10.1: record-worktree records a relative worktree path against the injected cwd', async () => {
  const f = recordFixture();
  const r = await runHook(['record-worktree', '--run', f.runDir, 'wt-rel'], { cwd: f.root });
  assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: worktree recorded for ${RUN_ID}\n`, stderr: '' });
  assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).worktree, path.join(f.root, 'wt-rel'));
});

// Real process: the record-worktree family's refusal smoke test (AC9.1) — the script entry's non-zero exit and stderr.
test('AC9.1: node hooks.js record-worktree --bogus exits 1 naming the unknown flag and records nothing', () => {
  const f = recordFixture();
  const before = fs.readFileSync(f.state, 'utf8');
  const r = spawnCli(HOOKS, ['record-worktree', '--run', f.runDir, f.wt, '--bogus'], { cwd: f.root, env: hookEnv() });
  assert.deepStrictEqual(r, {
    code: 1,
    stdout: '',
    stderr: "claude-tweaks: record-worktree: unknown flag '--bogus'\nclaude-tweaks: usage: record-worktree --run <dir> <worktree-path> [--dispatch]\n",
  });
  assert.equal(fs.readFileSync(f.state, 'utf8'), before);
});

test('Q1: a Defer-reason alone writes the row and flags incompleteDeferral', async () => {
  const f = await fixture();
  const r = await ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'Defer-reason: tangential']);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.incompleteDeferral, true);
  assert.deepEqual(parseLedger(f.before()).deferredUnstagedItems, [String(out.row)]);
});

test('Q1: a staged path writes the row with no flag', async () => {
  const f = await fixture();
  const r = await ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'staged/ledger-record-a.md']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!('incompleteDeferral' in JSON.parse(r.stdout)));
  assert.deepEqual(parseLedger(f.before()).deferredUnstagedItems, []);
});

test('Q1: neither is refused, naming the rule', async () => {
  const f = await fixture();
  refused(f, await ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'later']), /staged\//);
  const r = await ledgerRow(f, ['--phase', 'build', '--item', 'later', '--status', 'deferred', '--resolution', 'later']);
  assert.match(r.stderr, /Defer-reason:/);
});

test('own record is not a record reference', async () => {
  const f = await fixture();
  refused(f, await ledgerRow(f, ['--phase', 'build', '--item', 'x', '--status', 'deferred', '--resolution', 'see #1']), /staged\/.*Defer-reason:/);
  const other = await ledgerRow(f, ['--phase', 'build', '--item', 'x', '--status', 'deferred', '--resolution', 'see #2']);
  assert.equal(other.code, 0, other.stderr);
});

test('amendment 2: a deferred row naming only the run\'s own record settles through the CLI', async () => {
  const f = await fixture({ rows: '| 1 | build | x | deferred | see #1 |\n' });
  const r = await ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'superseded by the build']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), ['| 1 | build | x | accepted | superseded by the build |']);

  // Go-red: with no materialized header the run owns no record, so `#1` reads as a record reference.
  const bare = await fixture({ header: false, rows: '| 1 | build | x | deferred | see #1 |\n' });
  refused(bare, await ledgerRow(bare, ['--row', '1', '--status', 'accepted', '--resolution', 'superseded by the build']), /row #1/);
});

test('amendment 1: an implicit run owned by another session is refused', async () => {
  const f = await fixture();
  const elsewhere = tmp('ct-ledgerrow-other-');
  const runDir2 = await stampedRun(f.root, '2026-11-03T000001-record-9', elsewhere, 'someone-else');
  const ledger2 = path.join(runDir2, 'ledger.md');
  fs.writeFileSync(ledger2, HEAD);
  const before2 = fs.readFileSync(ledger2, 'utf8');

  const r = await runHook(['ledger-row', ...APPEND], { cwd: f.wt, env: { PIPELINE_RUN_DIR: runDir2 } });
  refused(f, r, /recorded by another session\/worktree/);
  assert.equal(fs.readFileSync(ledger2, 'utf8'), before2);

  // The bypass: an explicit --run on the same run dir writes.
  const explicit = await runHook(['ledger-row', '--run', runDir2, ...APPEND], { cwd: f.wt });
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.equal(explicit.stderr, '');
  assert.equal(JSON.parse(explicit.stdout).ledger, ledger2);
  assert.equal(fs.readFileSync(ledger2, 'utf8'), `${before2}| 1 | build | item | open | — |\n`);
  assert.equal(f.before(), f.snapshot);
});

test('Q2: settling a terminal row exits 1 naming the row and status', async () => {
  const f = await fixture({ rows: '| 1 | build | x | fixed | abc123 |\n' });
  const r = await ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'changed my mind']);
  refused(f, r, /row #1/);
  assert.match(r.stderr, /fixed/);
});

test('answer 1: the refused-proposal reopen through the CLI', async () => {
  const f = await fixture({ rows: '| 1 | build | x | deferred | staged/ledger-record-a.md |\n' });
  refused(f, await ledgerRow(f, ['--row', '1', '--status', 'open', '--resolution', 'reopened']), /proposal refused — no defer reason/);
  const r = await ledgerRow(f, ['--row', '1', '--status', 'open', '--resolution', 'staged/ledger-record-a.md refused — proposal refused — no defer reason']);
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

test('answer 5: --item-file carries a pipe, a backtick and $ intact', async () => {
  const f = await fixture();
  const r = await ledgerRow(f, ['--phase', 'build', '--item-file', textFile('item.txt', `${PIPE_TEXT}\n`), '--status', 'open']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), [`| 1 | build | ${PIPE_CELL} | open | — |`]);
});

test('answer 5: --resolution-file carries a pipe, a backtick and $ intact', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  const r = await ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution-file', textFile('res.txt', `${PIPE_TEXT}\r\n`)]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ledgerRows(f), [`| 1 | build | x | accepted | ${PIPE_CELL} |`]);
});

test('answer 5: a file flag with its argv twin exits 2', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  const file = textFile('t.txt', 'text\n');
  const item = await ledgerRow(f, ['--phase', 'build', '--item', 'x', '--item-file', file, '--status', 'open']);
  refused(f, item, /--item and --item-file/, { code: 2 });
  const resolution = await ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'x', '--resolution-file', file]);
  refused(f, resolution, /--resolution and --resolution-file/, { code: 2 });
});

const FILE_CASES = [
  ['--item-file', (file) => ['--phase', 'build', '--item-file', file, '--status', 'open']],
  ['--resolution-file', (file) => ['--row', '1', '--status', 'accepted', '--resolution-file', file]],
];

test('answer 5: an empty file exits 2', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  for (const [flag, args] of FILE_CASES) {
    for (const content of ['', '\n\n']) {
      refused(f, await ledgerRow(f, args(textFile('empty.txt', content))), new RegExp(`${flag}.*empty`), { code: 2 });
    }
  }
});

test('answer 5: an unreadable file and an interior newline exit 2', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  for (const [flag, args] of FILE_CASES) {
    const missing = path.join(tmp('ct-ledgerrow-missing-'), 'nope.txt');
    const r = await ledgerRow(f, args(missing));
    refused(f, r, new RegExp(flag), { code: 2 });
    assert.ok(r.stderr.includes(missing), 'names the path');
    refused(f, await ledgerRow(f, args(textFile('two.txt', 'a\nb'))), /one table line/, { code: 2 });
  }
});

// #5375: a relative path argument is joined onto the injected cwd WITHOUT normalizing (resolveAgainst),
// so the kernel sees a trailing slash exactly as a bare relative read did at base.
// The expected code is read off this platform's own fs for the same joined path (POSIX: ENOTDIR; win32 maps a
// trailing separator differently), so the pin stays exact everywhere.
test('#5375: ledger-row --item-file item.txt/ (trailing slash) still refuses with exit 2 and ENOTDIR', async () => {
  const f = await fixture();
  fs.writeFileSync(path.join(f.wt, 'item.txt'), 'a row\n');
  let code = null;
  try { fs.readFileSync(`${f.wt}${path.sep}item.txt/`, 'utf8'); } catch (err) { code = err.code; }
  const r = await runHook(['ledger-row', '--run', f.runDir, '--phase', 'build', '--status', 'observation', '--item-file', 'item.txt/'], { cwd: f.wt });
  if (code === null) {
    // A platform that reads the file through the trailing separator appends the row, as a bare read did there.
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).action, 'appended');
    return;
  }
  assert.deepStrictEqual(r, { code: 2, stdout: '', stderr: `claude-tweaks: ledger-row: --item-file item.txt/ is unreadable (${code}) — nothing written\n` });
});

test('answer 6: fixed with this repo\'s /pull/N URL through the CLI', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n| 2 | build | y | open | — |\n' });
  git(['remote', 'add', 'origin', 'https://github.com/o/r.git'], f.root);
  const ok = await ledgerRow(f, ['--row', '1', '--status', 'fixed', '--resolution', 'https://github.com/o/r/pull/7']);
  assert.equal(ok.code, 0, ok.stderr);
  f.snapshot = f.before();
  refused(f, await ledgerRow(f, ['--row', '2', '--status', 'fixed', '--resolution', 'https://github.com/o/r/issues/7']), /needs a commit sha, file reference, or resolving PR/);
});

test('answer 6: fixed with this repo\'s /pull/N URL reads an ssh:// or credentialed-https origin the way the gate does (#4794)', async () => {
  for (const origin of ['ssh://git@github.com/o/r.git', 'https://x:tok@github.com/o/r.git']) {
    const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
    git(['remote', 'add', 'origin', origin], f.root);
    const ok = await ledgerRow(f, ['--row', '1', '--status', 'fixed', '--resolution', 'https://github.com/o/r/pull/7']);
    assert.equal(ok.code, 0, `${origin}: ${ok.stderr}`);
  }
});

// The env-only A/B fixture (cli-wrapper-contract.md): A is the run's repo, with no remote, and the cwd; B has
// the origin and a recorded origin/HEAD and is reachable only through GIT_DIR in the injected env. An origin
// read that inherits the runner's environment reads A and cannot match B's /pull/N URL.
test('AC10.1: ledger-row --status fixed accepts B\'s /pull/N URL only when the git child reads the injected env', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  const b = seedRepo('ct-ledgerrow-b-');
  git(['remote', 'add', 'origin', 'https://github.com/ct-env-only/fixture.git'], b);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], b);
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], b);
  const args = ['--row', '1', '--status', 'fixed', '--resolution', 'https://github.com/ct-env-only/fixture/pull/7'];

  refused(f, await ledgerRow(f, args), /origin repo unresolvable/);
  const ok = await ledgerRow(f, args, { env: { GIT_DIR: path.join(b, '.git') } });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stderr, '');
  assert.deepEqual(ledgerRows(f), ['| 1 | build | x | fixed | https://github.com/ct-env-only/fixture/pull/7 |']);
});

// The env-only A/B fixture again, on the implicit docs/plans resolution (#5375): the run's recorded worktree W is
// not a git checkout, so ledger ownership is computable only when resolveLedgerPath's git children read the
// injected GIT_DIR (B, with a recorded origin/HEAD). gh is pointed at an unreachable host so no call leaves the machine.
test('AC10.1: ledger-row resolves an owned docs/plans ledger only when the ownership git children read the injected env', async () => {
  const root = seedRepo('ct-ledgerrow-own-');
  const w = tmp('ct-ledgerrow-nongit-');
  const ledger = path.join(w, 'docs', 'plans', '2026-11-03-x-ledger.md');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, HEAD);
  const runDir = await stampedRun(root, RUN_ID, w);
  const b = seedRepo('ct-ledgerrow-own-b-');
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], b);
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], b);
  const offline = { GH_HOST: 'localhost', GH_TOKEN: 'x' };
  const args = ['ledger-row', '--run', runDir, ...APPEND];

  const unowned = await runHook(args, { cwd: root, env: offline });
  assert.equal(unowned.code, 1, unowned.stderr);
  assert.match(unowned.stderr, /ledger unattributable/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), HEAD);
  const ok = await runHook(args, { cwd: root, env: { ...offline, GIT_DIR: path.join(b, '.git') } });
  assert.deepStrictEqual(ok, { code: 0, stdout: `${JSON.stringify({ action: 'appended', row: 1, status: 'open', ledger })}\n`, stderr: '' });
  assert.equal(fs.readFileSync(ledger, 'utf8'), `${HEAD}| 1 | build | item | open | — |\n`);
});

test('rejects a --ledger outside the run and worktree', async () => {
  const f = await fixture();
  const outside = path.join(tmp('ct-ledgerrow-out-'), 'x-ledger.md');
  fs.writeFileSync(outside, HEAD);
  const r = await runHook(['ledger-row', '--run', f.runDir, '--ledger', outside, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /outside the run directory and worktree/);
  assert.equal(fs.readFileSync(outside, 'utf8'), HEAD);
});

test('a --ledger that does not exist is refused, without a hint to pass the flag it already carries', async () => {
  const f = await fixture();
  const r = await runHook(['ledger-row', '--run', f.runDir, '--ledger', path.join(f.wt, 'docs', 'plans', 'missing-ledger.md'), ...APPEND], { cwd: f.wt });
  refused(f, r, /not-found/);
  assert.doesNotMatch(r.stderr, /pass --ledger/);
});

test('an implicit resolution that finds no ledger keeps the hint to pass --ledger', async () => {
  const f = await fixture();
  fs.rmSync(f.ledger);
  const r = await runHook(['ledger-row', '--run', f.runDir, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /ledger not-found — pass --ledger <path> to name one — nothing written\n$/);
});

test('refuses an empty --ledger value', async () => {
  const f = await fixture();
  refused(f, await runHook(['ledger-row', '--run', f.runDir, '--ledger', '', ...APPEND], { cwd: f.wt }), /--ledger needs a path/);
});

test('a ledger that exists only in the worktree copy is written through an explicit --ledger', async () => {
  // The parallel-wave member shape: its run dir carries decisions.md and work/ but no run-state.json,
  // so no worktree is recorded and no ledger lives under it.
  const f = await fixture();
  const runDir3 = path.join(f.root, '.claude-tweaks', 'pipelines', '2026-11-03T000002-record-3');
  fs.mkdirSync(path.join(runDir3, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir3, 'work', '3-spec.md'), '---\nrecord: 3\n---\n');
  fs.writeFileSync(path.join(runDir3, 'decisions.md'), '# decisions\n');
  // A second ledger this branch owns makes implicit resolution ambiguous, so only the explicit --ledger can pick the target.
  const sibling = path.join(f.wt, 'docs', 'plans', '2026-11-03-y-ledger.md');
  fs.writeFileSync(sibling, HEAD);
  const r = await runHook(['ledger-row', '--run', runDir3, '--ledger', f.ledger, ...APPEND], { cwd: f.wt });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(sibling, 'utf8'), HEAD);
  assert.deepEqual(ledgerRows(f), ['| 1 | build | item | open | — |']);
  // Nothing new under the run dir, and the lock dir the write took is gone.
  assert.deepEqual(fs.readdirSync(runDir3, { recursive: true }).sort(), ['decisions.md', 'work', path.join('work', '3-spec.md')]);
});

test('run resolution: no run dir, an unusable --run and ambiguous candidates each refuse', async () => {
  const bare = seedRepo('ct-ledgerrow-bare-');
  const none = await runHook(['ledger-row', ...APPEND], { cwd: bare });
  assert.equal(none.code, 1);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /no pipeline run dir found — nothing written/);

  const f = await fixture();
  const bad = await runHook(['ledger-row', '--run', path.join(f.root, 'nope'), '--ledger', f.ledger, ...APPEND], { cwd: f.wt });
  refused(f, bad, /--run path rejected/);

  await stampedRun(f.root, '2026-11-03T000009-record-9', tmp('ct-ledgerrow-nine-'));
  const many = await runHook(['ledger-row', '--ledger', f.ledger, ...APPEND], { cwd: f.root });
  assert.equal(many.code, 1);
  assert.equal(many.stdout, '');
  assert.match(many.stderr, /multiple candidate runs — pass --run explicitly:/);
  assert.match(many.stderr, /ledger-row --run /);
  assert.equal(f.before(), f.snapshot);
});

test('refuses --row together with --item, --item-file or --phase', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  const file = textFile('i.txt', 'text\n');
  for (const extra of [['--item', 'y'], ['--item-file', file], ['--phase', 'build']]) {
    refused(f, await ledgerRow(f, ['--row', '1', '--status', 'accepted', '--resolution', 'z', ...extra]), /--row/);
  }
});

test('refuses --row with no --resolution, and a non-numeric --row', async () => {
  const f = await fixture({ rows: '| 1 | build | x | open | — |\n' });
  refused(f, await ledgerRow(f, ['--row', '1', '--status', 'accepted']), /resolution/);
  // `open` passes checkLedgerStatus with no resolution, so only the verb's own settle guard refuses it.
  refused(f, await ledgerRow(f, ['--row', '1', '--status', 'open']), /settling row #1 to 'open' needs --resolution or --resolution-file/);
  refused(f, await ledgerRow(f, ['--row', 'one', '--status', 'accepted', '--resolution', 'z']), /--row/);
  const observation = await ledgerRow(f, ['--row', '1', '--status', 'observation']);
  assert.equal(observation.code, 0, observation.stderr);
});

test('refuses an append with no --phase, no item or no --status', async () => {
  const f = await fixture();
  refused(f, await ledgerRow(f, ['--item', 'x', '--status', 'open']), /--phase/);
  refused(f, await ledgerRow(f, ['--phase', 'build', '--status', 'open']), /--item/);
  refused(f, await ledgerRow(f, ['--phase', 'build', '--item', 'x']), /--status/);
});

test('refuses a stray positional argument instead of truncating an unquoted value', async () => {
  const f = await fixture();
  refused(f, await ledgerRow(f, ['--phase', 'build', '--item', 'a', 'b', '--status', 'open']), /unexpected argument 'b'/);
});

test('refuses an undeclared flag in both orders', async () => {
  const f = await fixture();
  for (const args of [['--bogus', ...APPEND], [...APPEND, '--bogus']]) {
    const r = await ledgerRow(f, args);
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

test('--help prints the usage line', async () => {
  const r = await runHook(['ledger-row', '--help'], { cwd: tmp('ct-ledgerrow-help-') });
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('ledger-row [--run <dir>]'));
  assert.equal(r.stderr, '');
});
