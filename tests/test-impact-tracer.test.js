// tests/test-impact-tracer.test.js
//
// #4024: tools/test-impact/tracer.js is a `--require` preload, carried by NODE_OPTIONS into every node
// process of a traced `node --test` run, that records which repo paths each test file reads. This copies
// the fixture project (tests/fixtures/test-impact/, `*.fixture.js` renamed to `*.test.js`) into a temp
// root whose path holds a space, runs `node --test` there once under the tracer, and checks the JSON-line
// trace files it leaves: `["T", test]` first, then one `[kind, relPath]` per unique read.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TRACER = path.join(ROOT, 'tools', 'test-impact', 'tracer.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'test-impact');
const TEST_FILES = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js', 'f.test.js'];

function copyFixture(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    if (entry.isDirectory()) copyFixture(from, path.join(dest, entry.name));
    else fs.copyFileSync(from, path.join(dest, entry.name.replace(/\.fixture\.js$/, '.test.js')));
  }
}

// The trace env for a run rooted at `root`, writing into `dir`: any trace or test-runner state this
// process inherited is dropped first, so the run is traced only by this configuration.
function traceEnv(root, dir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CT_TRACE_') || /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key)) delete env[key];
  }
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const req = `--require "${TRACER}"`;
  return { ...env, NODE_OPTIONS: req, CT_TRACE_REQUIRE: req, CT_TRACE_ROOT: root, CT_TRACE_DIR: dir };
}

// Map of test path -> Set of JSON-encoded [kind, path] records, unioned over every trace file
// (a test's child processes write files of their own under the same header).
function readTraces(dir) {
  const byTest = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.trace')) continue;
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(lines[0][0], 'T', `${name} must open with its test header`);
    const set = byTest.get(lines[0][1]) || new Set();
    for (const rec of lines.slice(1)) set.add(JSON.stringify(rec));
    byTest.set(lines[0][1], set);
  }
  return byTest;
}

let tmp;
let root;
let run;

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct trace-')));
  root = path.join(tmp, 'fixture root');
  copyFixture(FIXTURE, root);
  // A newline or tab cannot be in a Windows file name, so the two odd-name files exist only elsewhere.
  if (process.platform !== 'win32') {
    fs.writeFileSync(path.join(root, 'docs', 'we\nird.md'), 'newline\n');
    fs.writeFileSync(path.join(root, 'docs', 'ta\tb.md'), 'tab\n');
  }
  const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', env: traceEnv(root, tmp) });
  assert.strictEqual(init.status, 0, init.stderr);
  const dir = path.join(tmp, 'traces');
  fs.mkdirSync(dir);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...TEST_FILES], {
    cwd: root, env: traceEnv(root, dir), encoding: 'utf8', timeout: 120000,
  });
  run = { dir, result };
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// The traced run passed and its traces parse; returns the records of `testFile`.
function recordsOf(testFile) {
  assert.strictEqual(run.result.status, 0, run.result.stdout + run.result.stderr);
  return readTraces(run.dir).get(testFile) || new Set();
}
const rec = (kind, p) => JSON.stringify([kind, p]);
function assertPassed(name) {
  assert.match(run.result.stdout, new RegExp(`^\\s*ok \\d+ - ${name}\\s*$`, 'm'), run.result.stdout);
}

test('module loads and reads are attributed', () => {
  const a = recordsOf('a.test.js');
  const b = recordsOf('b.test.js');
  for (const r of [rec('f', 'lib/x.js'), rec('f', 'docs/note.md'), rec('f', 'a.test.js')]) {
    assert.ok(a.has(r), `a must record ${r}`);
    assert.ok(!b.has(r), `b must not record ${r}`);
  }
});

test('readdir records a d entry', () => {
  assert.ok(recordsOf('a.test.js').has(rec('d', 'docs/listed')));
});

test('a recursive directory copy records a c prefix, so a file inside the copied tree selects the test', () => {
  const a = recordsOf('a.test.js');
  assert.ok(a.has(rec('c', 'docs/copied')), 'cpSync of docs/copied records c docs/copied');
  // Whether a `d docs/copied` record also appears depends on the Node version (20 lists the directory
  // through the patched readdirSync, 22 copies it natively), so only the `c` record is pinned.
});

test('existsSync records s', () => {
  const a = recordsOf('a.test.js');
  assert.ok(a.has(rec('s', 'docs/probe.md')));
  assert.ok(!a.has(rec('f', 'docs/probe.md')), 'an existence probe is not a content read');
  for (const r of a) assert.doesNotMatch(JSON.parse(r)[1], /^\.git(\/|$)/, '.git/ paths are dropped');
});

test('statSync records f', () => {
  assert.ok(recordsOf('a.test.js').has(rec('f', 'docs/stat.md')));
});

test('child with explicit env is traced (AC2.1 spawn half)', () => {
  const b = recordsOf('b.test.js');
  assert.ok(b.has(rec('f', 'lib/y.js')), 'the child read lib/y.js under b');
  assert.ok(b.has(rec('f', 'bin/child.js')), 'the child loaded bin/child.js under b');
});

test('fork with explicit env is traced', () => {
  assert.ok(recordsOf('b.test.js').has(rec('f', 'docs/forked.md')));
});

test('git content command in the repo records c', () => {
  const a = recordsOf('a.test.js');
  const b = recordsOf('b.test.js');
  assert.ok(a.has(rec('c', '')), 'git ls-files at the root records the root prefix');
  assert.ok(b.has(rec('c', 'lib')), 'git ls-files lib records the lib prefix');
  assert.ok(!b.has(rec('c', '')), 'a path argument replaces the cwd-wide prefix');
});

test('non-node child records its in-repo path arguments', { skip: process.platform === 'win32' && 'win32: no ls' }, () => {
  const b = recordsOf('b.test.js');
  assert.ok(b.has(rec('c', 'docs/listed')), 'a directory argument records c');
  assert.ok(b.has(rec('f', 'docs/ls-target.md')), 'a file argument records f');
});

test('callback and fs.promises read and readdir are traced like the sync forms', () => {
  const f = recordsOf('f.test.js');
  for (const r of [rec('f', 'docs/async-read.md'), rec('d', 'docs/async-list'), rec('f', 'docs/async-promise.md'), rec('d', 'docs/promise-list')]) {
    assert.ok(f.has(r), `f must record ${r}`);
  }
});

test('async spawn and callback exec record their in-repo path arguments', { skip: process.platform === 'win32' && 'win32: no cat' }, () => {
  const f = recordsOf('f.test.js');
  assert.ok(f.has(rec('f', 'docs/async-spawn.md')), 'spawn of a non-node child');
  assert.ok(f.has(rec('f', 'docs/async-exec.md')), 'callback exec of a shell command line');
});

test('wrapped execFile keeps promisify.custom', () => {
  const c = recordsOf('c.test.js');
  assertPassed('promisified execFile resolves stdout');
  assert.ok(c.has(rec('f', 'docs/promisified.md')), 'a promisified execFile child with an explicit env is traced');
  assert.ok(c.has(rec('c', 'docs')), 'a promisified git content call records c');
});

test('a relative require records its resolution candidates as s', () => {
  const a = recordsOf('a.test.js');
  for (const p of ['lib/x', 'lib/x.js', 'lib/x.json', 'lib/x/index.js', 'lib/x/package.json']) {
    assert.ok(a.has(rec('s', p)), `a must record s ${p}`);
  }
});

test('git glob and magic pathspecs record their literal directory prefix', () => {
  const d = recordsOf('d.test.js');
  assert.ok(d.has(rec('c', 'docs/listed')), "-- '*.md' records the git cwd's prefix");
  assert.ok(!d.has(rec('f', 'docs/listed/*.md')), 'a glob is not a literal file');
  assert.ok(d.has(rec('c', 'docs')), "-- ':(glob)docs/*/x.md' records c docs");
});

test('git option values are not path arguments', () => {
  assert.ok(!recordsOf('d.test.js').has(rec('c', '')), 'git -C <root> rev-parse records no root prefix');
});

test('git grep: the pattern is not a pathspec; paths after -- are', () => {
  const e = recordsOf('e.test.js');
  assert.ok(e.has(rec('c', '')), 'a pattern-only git grep searches the whole tree');
  assert.ok(!e.has(rec('c', 'docs')), "the pattern 'docs/.*x' is not a glob pathspec");
  assert.ok(!e.has(rec('c', 'lib')), 'the -e value lib is not a path argument');
  assert.ok(recordsOf('d.test.js').has(rec('c', 'tools')), 'git grep TODO -- tools records c tools');
});

// fs.readdirSync made non-writable by a preload loaded first: that one patch fails, the run still
// passes and stays silent, every other patch is in place, and the test is recorded as `c ''`.
test('a patch that cannot be installed fails closed with c ""', () => {
  const dir = path.join(tmp, 'fail-closed');
  fs.mkdirSync(dir);
  const env = traceEnv(root, dir);
  env.NODE_OPTIONS = `--require "${path.join(root, 'freeze-readdir.js')}" ${env.NODE_OPTIONS}`;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'd.test.js'], {
    cwd: root, env, encoding: 'utf8', timeout: 120000,
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stderr, '');
  const d = readTraces(dir).get('d.test.js') || new Set();
  assert.ok(d.has(rec('c', '')), 'the failed patch records the whole-repo prefix');
  assert.ok(d.has(rec('c', 'bin')), 'the other patches still record');
});

test('shell env prefixes and sh -c scripts are read as the command they run', () => {
  const d = recordsOf('d.test.js');
  assert.ok(d.has(rec('c', 'bin')), 'FOO=1 git ls-files is a git content command');
  if (process.platform !== 'win32') assert.ok(d.has(rec('c', 'lib')), 'sh -c "git ls-files" is a git content command');
});

test('absolute path never consults process.cwd', { skip: process.platform === 'win32' && 'win32: a process cwd cannot be removed' }, () => {
  recordsOf('c.test.js');
  assertPassed('deleted cwd still throws');
});

test('paths with newline round-trip', () => {
  const c = recordsOf('c.test.js');
  if (process.platform !== 'win32') {
    assert.ok(c.has(rec('f', 'docs/we\nird.md')));
    assert.ok(c.has(rec('f', 'docs/ta\tb.md')));
  }
  for (const set of readTraces(run.dir).values()) {
    for (const r of set) assert.doesNotMatch(JSON.parse(r)[1], /^(\/|\.\.)/, 'paths outside the root are dropped');
  }
});

test('unattributed process records nothing', () => {
  const dir = path.join(tmp, 'unattributed');
  fs.mkdirSync(dir);
  const result = spawnSync(process.execPath, ['-e', "require('fs').readFileSync('lib/x.js')"], {
    cwd: root, env: traceEnv(root, dir), encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

// A traced env whose trace writes fail through tests/fixtures/test-impact/fail-trace-append.js, preloaded
// first (#4158): the read of lib/y.js fails, and with FAIL_TRACE_APPEND=all every .trace and .lost write does.
function failingTraceEnv(dir) {
  const env = traceEnv(root, dir);
  env.CT_TRACE_TEST = 'x.test.js';
  env.NODE_OPTIONS = `--require "${path.join(root, 'fail-trace-append.js')}" ${env.NODE_OPTIONS}`;
  return env;
}

test('a traced process whose trace write fails exits 1 although its own code succeeded, and leaves no loss marker', () => {
  const dir = path.join(tmp, 'lost-all');
  fs.mkdirSync(dir);
  const env = failingTraceEnv(dir);
  env.FAIL_TRACE_APPEND = 'all';
  const result = spawnSync(process.execPath, ['-e', "require('fs').readFileSync('lib/x.js')"], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /loss marker could not be written/);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.lost')), []);
});

test('a read whose trace write fails leaves a .lost marker naming its test, and the process exits 0', () => {
  const dir = path.join(tmp, 'lost-one');
  fs.mkdirSync(dir);
  const result = spawnSync(process.execPath, ['-e', "require('fs').readFileSync('lib/y.js')"], { cwd: root, env: failingTraceEnv(dir), encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const lost = fs.readdirSync(dir).filter((n) => n.endsWith('.lost'));
  assert.strictEqual(lost.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, lost[0]), 'utf8'), '["T","x.test.js"]\n');
});
