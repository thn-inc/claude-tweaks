'use strict';
// tests/count-node-procs.test.js — tools/count-node-procs.js and its NODE_OPTIONS preload (#5374).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run, analyze, formatTable } = require('../tools/count-node-procs.js');
const { requireOption } = require('../tools/test-impact/node-options.js');
const { slotEnv } = require('./helpers/suite-slot-env.js');

const repoRoot = path.resolve(__dirname, '..');
const toolPath = path.join(repoRoot, 'tools', 'count-node-procs.js');
const preloadPath = path.join(repoRoot, 'tools', 'count-node-procs-preload.js');

function start(pid, ppid, t, argv, execArgv = []) {
  return JSON.stringify({ ev: 'start', pid, ppid, t, argv, execArgv });
}
function exit(pid, t) {
  return JSON.stringify({ ev: 'exit', pid, t });
}
function chainLog(root) {
  return [
    start(10, 1, 100, [`${root}/tests/a.test.js`]),
    start(11, 10, 110, [`${root}/plugin/bin/resolve-policy.js`, '--values']),
    start(12, 11, 120, [`${root}/plugin/bin/lib/x.js`]),
    exit(12, 130),
    exit(11, 140),
    exit(10, 200),
  ].join('\n') + '\n';
}
const expectedFiles = [{ file: 'tests/a.test.js', nodeProcs: 3, cliProcs: { 'resolve-policy.js': 1 }, wallMs: 100 }];

function fakeDeps(spawn, tmp) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      spawnSync: spawn,
      env: { NODE_OPTIONS: '--max-old-space-size=64' },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
      tmpdir: () => tmp,
    },
  };
}

test('analyze attributes a CLI process to the test file at the top of its parent chain', () => {
  const result = analyze(chainLog('/r'), { repoRoot: '/r' });
  assert.deepStrictEqual(result.files, expectedFiles);
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 0, cliProcs: {} });
});

test('analyze resolves a reused pid to the most recent start at or before the child', () => {
  const log = [
    start(10, 1, 100, ['/r/tests/a.test.js']),
    exit(10, 200),
    start(10, 1, 500, ['/r/tests/b.test.js']),
    start(20, 10, 510, ['/r/plugin/bin/hooks.js', 'reconcile']),
    exit(20, 520),
    exit(10, 600),
  ].join('\n');
  const result = analyze(log, { repoRoot: '/r' });
  const b = result.files.find((f) => f.file === 'tests/b.test.js');
  const a = result.files.find((f) => f.file === 'tests/a.test.js');
  assert.deepStrictEqual(b.cliProcs, { 'hooks.js': 1 });
  assert.strictEqual(b.nodeProcs, 2);
  assert.strictEqual(a.nodeProcs, 1);
});

test('analyze counts a process with no test-file ancestor as unattributed', () => {
  const result = analyze(start(30, 999, 100, ['/r/plugin/bin/hooks.js', 'reconcile']), { repoRoot: '/r' });
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 1, cliProcs: { 'hooks.js': 1 } });
  assert.deepStrictEqual(result.files, []);
});

test('Review Focus 4: analyze skips a torn log line', () => {
  const log = [
    start(10, 1, 100, ['/r/tests/a.test.js']),
    '{"ev":"start","pid":4',
    exit(10, 150),
  ].join('\n');
  const result = analyze(log, { repoRoot: '/r' });
  assert.strictEqual(result.skippedLines, 1);
  assert.deepStrictEqual(result.files, [{ file: 'tests/a.test.js', nodeProcs: 1, cliProcs: {}, wallMs: 50 }]);
});

test('analyze never counts the node --test runner as a test-file process', () => {
  const log = [
    start(5, 1, 0, ['/r/tests/a.test.js'], ['--test']),
    chainLog('/r').replace(/"ppid":1,/, '"ppid":5,'),
    exit(5, 10000),
  ].join('\n');
  const result = analyze(log, { repoRoot: '/r' });
  assert.deepStrictEqual(result.files, expectedFiles);
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 1, cliProcs: {} });
});

test('analyze attributes a nested runner and fixture to the outermost test file, counting the nested runner', () => {
  const log = [
    start(10, 1, 100, ['/r/tests/s.test.js']),
    start(11, 10, 110, ['/r/plugin/bin/hooks.js', 'x']),
    start(12, 11, 120, ['/r/tests/fixtures/x.test.js'], ['--test']),
    start(13, 12, 130, ['/r/tests/fixtures/x.test.js']),
    start(14, 13, 140, ['/r/plugin/bin/hooks.js', 'y']),
    exit(14, 150),
    exit(13, 160),
    exit(12, 170),
    exit(11, 180),
    exit(10, 200),
  ].join('\n');
  const result = analyze(log, { repoRoot: '/r' });
  assert.deepStrictEqual(result.files, [{ file: 'tests/s.test.js', nodeProcs: 5, cliProcs: { 'hooks.js': 2 }, wallMs: 100 }]);
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 0, cliProcs: {} });
});

test('analyze treats a .test.js script outside the repo root as an ordinary process', () => {
  const result = analyze(start(10, 1, 100, ['/tmp/fx/a.test.js']), { repoRoot: '/r' });
  assert.deepStrictEqual(result.files, []);
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 1, cliProcs: {} });
});

test('analyze follows a chain of exactly 12 ancestors and drops one past it', () => {
  const chain = (depth) => {
    const lines = [start(100, 1, 100, ['/r/tests/a.test.js'])];
    for (let i = 1; i <= depth; i += 1) lines.push(start(100 + i, 99 + i, 100 + i, [`/r/plugin/bin/p${i}.js`]));
    return lines.join('\n');
  };
  const at = analyze(chain(12), { repoRoot: '/r' });
  assert.strictEqual(at.files[0].nodeProcs, 13);
  assert.strictEqual(at.unattributed.nodeProcs, 0);
  const past = analyze(chain(13), { repoRoot: '/r' });
  assert.strictEqual(past.files[0].nodeProcs, 13);
  assert.strictEqual(past.unattributed.nodeProcs, 1);
});

test('analyze counts a process started after the last logged exit in wallMs', () => {
  const log = [
    start(10, 1, 100, ['/r/tests/a.test.js']),
    start(11, 10, 150, ['/r/plugin/bin/hooks.js']), // killed before it logged an exit
    start(12, 11, 300, ['/r/plugin/bin/hooks.js']),
    exit(10, 200),
  ].join('\n');
  assert.strictEqual(analyze(log, { repoRoot: '/r' }).files[0].wallMs, 200);
});

test('analyze does not attribute a child to a parent pid that had already exited', () => {
  const log = [
    start(10, 1, 100, ['/r/tests/a.test.js']),
    exit(10, 200),
    start(20, 10, 300, ['/r/plugin/bin/hooks.js']),
  ].join('\n');
  const result = analyze(log, { repoRoot: '/r' });
  assert.strictEqual(result.files[0].nodeProcs, 1);
  assert.deepStrictEqual(result.unattributed, { nodeProcs: 1, cliProcs: { 'hooks.js': 1 } });
});

test('formatTable prints the floor note, one row per file and a total', () => {
  const text = formatTable(analyze(chainLog('/r'), { repoRoot: '/r' }));
  assert.ok(text.split('\n')[0].startsWith('# counts are a floor'));
  assert.match(text, /^tests\/a\.test\.js\s+3\s+1\s+100$/m);
  assert.match(text, /^total\s+3\s+1\b/m);
  assert.match(text, /^\(unattributed\)/m);
});

test('AC10.1: run passes the list through, returns the test run\'s exit code and writes --json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const outPath = path.join(tmp, 'out.json');
    let calls = 0;
    const { deps, out } = fakeDeps((cmd, args, options) => {
      calls += 1;
      assert.deepStrictEqual(args.slice(1), ['--files-from', 'list.txt']);
      assert.ok(options.env.NODE_OPTIONS.startsWith('--max-old-space-size=64 '));
      assert.ok(options.env.NODE_OPTIONS.endsWith('count-node-procs-preload.js"'));
      fs.writeFileSync(options.env.CT_COUNT_NODE_LOG, chainLog(repoRoot.split(path.sep).join('/')));
      return { status: 5 };
    }, tmp);
    assert.strictEqual(run(['--files-from', 'list.txt', '--json', outPath], deps), 5);
    assert.strictEqual(calls, 1);
    assert.match(out.join(''), /tests\/a\.test\.js/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')), expectedFiles);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run reports an unwritable --json path and keeps the test run\'s exit code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const bad = path.join(tmp, 'no-such-dir', 'out.json');
    for (const [status, expected] of [[0, 1], [5, 5]]) {
      const { deps, err } = fakeDeps(() => ({ status }), tmp);
      assert.strictEqual(run(['--json', bad], deps), expected);
      assert.match(err.join(''), /count-node-procs: could not write .*out\.json: /);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run with no arguments names both default roots', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const { deps } = fakeDeps((cmd, args) => {
      assert.deepStrictEqual(args.slice(1), ['tests', path.join('tools', 'upstream-drift', 'tests')]);
      return { status: 0 };
    }, tmp);
    assert.strictEqual(run([], deps), 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run rejects an unknown flag with exit 2', () => {
  let called = false;
  const { deps, err } = fakeDeps(() => { called = true; return { status: 0 }; }, os.tmpdir());
  assert.strictEqual(run(['--nope'], deps), 2);
  assert.strictEqual(called, false);
  assert.match(err.join(''), /usage:/);
});

test('the preload logs a start and an exit line and prints nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const logFile = path.join(tmp, 'log.jsonl');
    const r = spawnSync(process.execPath, ['-e', '0'], {
      env: { ...process.env, NODE_OPTIONS: requireOption(preloadPath), CT_COUNT_NODE_LOG: logFile },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, '');
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].ev, 'start');
    assert.strictEqual(lines[1].ev, 'exit');
    assert.strictEqual(lines[0].pid, lines[1].pid);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the preload logs one start and one exit line for a process that creates a worker thread', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const logFile = path.join(tmp, 'log.jsonl');
    const script = "const { Worker } = require('worker_threads'); new Worker('0', { eval: true });";
    const r = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, NODE_OPTIONS: requireOption(preloadPath), CT_COUNT_NODE_LOG: logFile },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines.map((l) => l.ev), ['start', 'exit']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC10.1: one real run prints a row for the listed test file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-test-'));
  try {
    const listFile = path.join(tmp, 'list.txt');
    const outPath = path.join(tmp, 'out.json');
    fs.writeFileSync(listFile, 'tests/helpers-git-template.test.js\n');
    const r = spawnSync(process.execPath, [toolPath, '--files-from', listFile, '--json', outPath], {
      cwd: repoRoot,
      env: slotEnv(tmp, { CT_TEST_SUITE_SLOT_HELD: '1' }),
      encoding: 'utf8',
      timeout: 120000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const rows = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].file, 'tests/helpers-git-template.test.js');
    // exactly the test file's own process: its helpers start git (not node), and the `node --test`
    // runner and tools/run-tests.js above it are unattributed
    assert.strictEqual(rows[0].nodeProcs, 1);
    assert.deepStrictEqual(rows[0].cliProcs, {});
    assert.strictEqual(typeof rows[0].wallMs, 'number');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
