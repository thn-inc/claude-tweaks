// tests/test-impact-cli.test.js
//
// #4024: tools/test-impact.js turns a traced full-suite run into a test-impact map (`trace`) and
// downloads a CI-built one (`fetch`); tools/test-impact/build-map.js folds the tracer's JSON-line
// trace files into the map. The unit tests drive `run({ argv, deps })` with fake git/gh/spawn; the
// end-to-end test runs the real CLI over a temp fixture root whose path holds a space.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'test-impact.js');
const { buildMap } = require(path.join(ROOT, 'tools', 'test-impact', 'build-map.js'));
const { run } = require(CLI);
const { parseImpactMap, encodeImpactMap } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'impact.js'));
const { readText } = require('./helpers/read-skill');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

function withTempDir(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct impact-cli-')));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const traceText = (lines) => lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';

// ---- buildMap ----

test('buildMap merges two processes of one test, skips a header-less file and fails a corrupt line closed', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/x.js'], ['s', 'docs/p.md']]));
    fs.writeFileSync(path.join(dir, '2-1-b.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/y.js'], ['d', 'docs']]));
    fs.writeFileSync(path.join(dir, '3-1-c.trace'), traceText([['f', 'lib/orphan.js']]));
    fs.writeFileSync(path.join(dir, '4-1-d.trace'), traceText([['T', 'tests/b.test.js'], ['f', 'lib/z.js'], '["f", "lib/tru']));
    fs.writeFileSync(path.join(dir, 'not-a-trace.txt'), traceText([['T', 'tests/c.test.js'], ['f', 'lib/c.js']]));
    const { map, skipped } = buildMap({ traceDir: dir, commit: SHA_A, exitCode: 0, node: 'v22.0.0', now: () => 0 });
    assert.strictEqual(skipped, 1);
    const parsed = parseImpactMap(JSON.stringify(map));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepStrictEqual(Object.keys(parsed.map.tests).sort(), ['tests/a.test.js', 'tests/b.test.js']);
    assert.deepStrictEqual(parsed.map.tests['tests/a.test.js'], { f: ['lib/x.js', 'lib/y.js'], s: ['docs/p.md'], d: ['docs'], c: [] });
    // The corrupt line could have named anything: the test is kept for every change.
    assert.deepStrictEqual(parsed.map.tests['tests/b.test.js'], { f: ['lib/z.js'], s: [], d: [], c: [''] });
    assert.ok(!parsed.map.paths.includes('lib/orphan.js'));
    assert.strictEqual(parsed.map.commit, SHA_A);
    assert.strictEqual(parsed.map.exitCode, 0);
    assert.strictEqual(parsed.map.node, 'v22.0.0');
    assert.strictEqual(parsed.map.tracedAt, new Date(0).toISOString());
  });
});

test("buildMap keeps the tracer's fail-closed whole-repo marker", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['c', ''], ['f', 'lib/x.js']]));
    const { map, skipped } = buildMap({ traceDir: dir, commit: SHA_A, exitCode: 1, node: 'v22.0.0', now: () => 0 });
    assert.strictEqual(skipped, 0);
    const parsed = parseImpactMap(JSON.stringify(map));
    assert.deepStrictEqual(parsed.map.tests['tests/a.test.js'].c, ['']);
    assert.strictEqual(parsed.map.exitCode, 1);
  });
});

test('buildMap counts a well-formed JSON line that is not a [kind, path] record as skipped', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['x', 'lib/x.js'], ['f', 3], ['T', 'tests/b.test.js']]));
    const { map, skipped } = buildMap({ traceDir: dir, commit: SHA_A, exitCode: 0, node: 'v22.0.0', now: () => 0 });
    assert.strictEqual(skipped, 3);
    assert.deepStrictEqual(Object.keys(map.tests), ['tests/a.test.js']);
    assert.deepStrictEqual(parseImpactMap(JSON.stringify(map)).map.tests['tests/a.test.js'].c, ['']);
  });
});

test('buildMap counts a .lost marker and names its test, and still counts one whose header does not parse', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/x.js']]));
    fs.writeFileSync(path.join(dir, '1-1-a.lost'), traceText([['T', 'tests/a.test.js']]));
    const first = buildMap({ traceDir: dir, commit: SHA_A, exitCode: 0, node: 'v22.0.0', now: () => 0 });
    assert.strictEqual(first.lost, 1);
    assert.deepStrictEqual(first.lostTests, ['tests/a.test.js']);
    fs.writeFileSync(path.join(dir, '2-1-b.lost'), '["T"');
    const second = buildMap({ traceDir: dir, commit: SHA_A, exitCode: 0, node: 'v22.0.0', now: () => 0 });
    assert.strictEqual(second.lost, 2);
    assert.deepStrictEqual(second.lostTests, ['tests/a.test.js']);
  });
});

// ---- fakes ----

// A fake git answering the calls the CLI makes from `root`; `ancestors` are the shas that are
// ancestors of HEAD, `status` is `git status --porcelain` output. Records every call.
function fakeGit({ root, commonDir = path.join(root, '.git'), head = SHA_C, ancestors = [], status = '' }) {
  const calls = [];
  const git = (args, opts) => {
    calls.push({ args, cwd: opts && opts.cwd });
    const a = args.join(' ');
    if (a === 'rev-parse --show-toplevel') return `${root}\n`;
    if (a === 'rev-parse --git-common-dir') return `${commonDir}\n`;
    if (a === 'rev-parse --verify HEAD^{commit}') return `${head}\n`;
    if (args.includes('status')) return status;
    if (args[0] === 'merge-base') {
      if (ancestors.includes(args[args.length - 2])) return '';
      throw Object.assign(new Error('not an ancestor'), { status: 1 });
    }
    throw new Error(`unexpected git ${a}`);
  };
  git.calls = calls;
  return git;
}

function makeDeps(over) {
  const out = [];
  const errs = [];
  const deps = {
    fs,
    now: () => 0,
    env: {},
    execPath: process.execPath,
    log: (s) => out.push(s),
    err: (s) => errs.push(s),
    spawn: () => { throw new Error('spawn must not be called'); },
    gh: () => { throw new Error('gh must not be called'); },
    ...over,
  };
  return { deps, out, errs };
}

const mapText = (commit, exitCode = 0) => `${JSON.stringify(encodeImpactMap({
  commit, tracedAt: '2026-10-24T00:00:00.000Z', exitCode, node: 'v22.0.0', tests: { 'tests/a.test.js': { f: ['lib/x.js'] } },
}))}\n`;

// ---- trace ----

test('trace refuses a dirty tree (exit 2) and runs nothing', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, status: ' M lib/x.js\n' });
    const { deps, errs } = makeDeps({ git, cwd: dir });
    assert.strictEqual(run({ argv: ['trace'], deps }), 2);
    assert.match(errs.join('\n'), /dirty/);
    const statusCall = git.calls.find((c) => c.args.includes('status'));
    assert.ok(statusCall.args.includes('--untracked-files=no'), 'untracked files never count as dirty');
    assert.ok(statusCall.args.includes('--no-optional-locks'));
  });
});

test('trace runs the suite under the tracer env and writes the map, recording a failing suite', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.git'));
    const git = fakeGit({ root: dir, status: ' M lib/x.js\n' });
    let seen = null;
    const spawn = (cmd, args, opts) => {
      seen = { cmd, args, opts };
      fs.writeFileSync(path.join(opts.env.CT_TRACE_DIR, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/x.js']]));
      return { status: 1, signal: null };
    };
    const env = { NODE_OPTIONS: '--max-old-space-size=4096', CT_TRACE_TEST: 'stale.test.js', KEEP: '1' };
    const { deps, out } = makeDeps({ git, spawn, env, cwd: dir });
    assert.strictEqual(run({ argv: ['trace', '--allow-dirty'], deps }), 0);
    const req = `--require "${path.join(dir, 'tools', 'test-impact', 'tracer.js')}"`;
    assert.strictEqual(seen.cmd, process.execPath);
    assert.deepStrictEqual(seen.args, [path.join(dir, 'tools', 'run-tests.js')]);
    assert.strictEqual(seen.opts.cwd, dir);
    assert.strictEqual(seen.opts.env.NODE_OPTIONS, `--max-old-space-size=4096 ${req}`);
    assert.strictEqual(seen.opts.env.CT_TRACE_REQUIRE, req);
    assert.strictEqual(seen.opts.env.CT_TRACE_ROOT, fs.realpathSync(dir));
    assert.strictEqual(seen.opts.env.CT_TRACE_TEST, undefined, 'an inherited attribution is dropped');
    assert.strictEqual(seen.opts.env.KEEP, '1');
    assert.strictEqual(fs.existsSync(seen.opts.env.CT_TRACE_DIR), false, 'the trace dir is removed');
    const mapPath = path.join(dir, '.git', 'claude-tweaks-test-impact.json');
    const text = fs.readFileSync(mapPath, 'utf8');
    const parsed = parseImpactMap(text);
    assert.ok(parsed.ok);
    assert.strictEqual(parsed.map.commit, SHA_C);
    assert.strictEqual(parsed.map.exitCode, 1);
    assert.deepStrictEqual(out, [`trace: 1 test file(s), 1 path(s), suite exit 1 → ${mapPath} (${Buffer.byteLength(text)} bytes)`]);
  });
});

test('trace exits 1 when the run left no parseable trace file', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir });
    const spawn = (cmd, args, opts) => {
      fs.writeFileSync(path.join(opts.env.CT_TRACE_DIR, '1-1-a.trace'), traceText([['f', 'lib/x.js']]));
      return { status: 0, signal: null };
    };
    const out = path.join(dir, 'map.json');
    const { deps, errs } = makeDeps({ git, spawn, cwd: dir });
    assert.strictEqual(run({ argv: ['trace', '--out', out], deps }), 1);
    assert.match(errs.join('\n'), /no parseable trace/);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

test('trace refuses the map and exits 1 when a traced process lost a read, naming its test', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir });
    const spawn = (cmd, args, opts) => {
      fs.writeFileSync(path.join(opts.env.CT_TRACE_DIR, '1-1-a.trace'), traceText([['T', 'tests/a.test.js'], ['f', 'lib/x.js']]));
      fs.writeFileSync(path.join(opts.env.CT_TRACE_DIR, '1-1-a.lost'), traceText([['T', 'tests/a.test.js']]));
      return { status: 0, signal: null };
    };
    const out = path.join(dir, 'map.json');
    const { deps, out: lines, errs } = makeDeps({ git, spawn, cwd: dir });
    assert.strictEqual(run({ argv: ['trace', '--out', out], deps }), 1);
    assert.strictEqual(fs.existsSync(out), false);
    assert.deepStrictEqual(errs, ['test-impact.js trace: 1 traced process(es) could not record a read (tests: tests/a.test.js) — no map written']);
    assert.deepStrictEqual(lines, []);
  });
});

test('trace names every test that lost a read, sorted and unique, past an unparseable marker, and writes no map', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir });
    const spawn = (cmd, args, opts) => {
      const td = opts.env.CT_TRACE_DIR;
      fs.writeFileSync(path.join(td, '1-1-a.lost'), traceText([['T', 'tests/z.test.js']]));
      fs.writeFileSync(path.join(td, '2-1-b.lost'), traceText([['T', 'tests/a.test.js']]));
      fs.writeFileSync(path.join(td, '3-1-c.lost'), '["T"');
      fs.writeFileSync(path.join(td, '4-1-d.lost'), traceText([['T', 'tests/a.test.js']]));
      return { status: 0, signal: null };
    };
    const out = path.join(dir, 'map.json');
    const { deps, errs } = makeDeps({ git, spawn, cwd: dir });
    assert.strictEqual(run({ argv: ['trace', '--out', out], deps }), 1);
    assert.strictEqual(fs.existsSync(out), false);
    assert.deepStrictEqual(errs, ['test-impact.js trace: 4 traced process(es) could not record a read (tests: tests/a.test.js, tests/z.test.js) — no map written']);
  });
});

test('trace says "tests: unknown" when every lost marker header is unparseable', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir });
    const spawn = (cmd, args, opts) => {
      fs.writeFileSync(path.join(opts.env.CT_TRACE_DIR, '1-1-a.lost'), '["T"');
      return { status: 0, signal: null };
    };
    const { deps, errs } = makeDeps({ git, spawn, cwd: dir });
    assert.strictEqual(run({ argv: ['trace', '--out', path.join(dir, 'map.json')], deps }), 1);
    assert.deepStrictEqual(errs, ['test-impact.js trace: 1 traced process(es) could not record a read (tests: unknown) — no map written']);
  });
});

test('trace and fetch reject unknown arguments with exit 2', () => {
  const { deps } = makeDeps({ git: () => { throw new Error('git must not be called'); }, cwd: os.tmpdir() });
  assert.strictEqual(run({ argv: ['trace', '--bogus'], deps }), 2);
  assert.strictEqual(run({ argv: ['fetch', '--repo'], deps }), 2);
  assert.strictEqual(run({ argv: ['fetch', '--repo', '-x'], deps }), 2);
  assert.strictEqual(run({ argv: ['nope'], deps }), 2);
  assert.strictEqual(run({ argv: [], deps }), 2);
});

// ---- fetch ----

// A fake gh: `runs` answers `run list` (each run is a push run unless it names its own `event`);
// `download` maps a run id to the map text it extracts.
function fakeGh({ runs, download = {} }) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs.map((r) => ({ event: 'push', ...r })));
    if (args[0] === 'run' && args[1] === 'download') {
      const dir = args[args.indexOf('--dir') + 1];
      fs.writeFileSync(path.join(dir, 'claude-tweaks-test-impact.json'), download[args[2]]);
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  gh.calls = calls;
  return gh;
}

test('fetch downloads the newest successful main map that is an ancestor of HEAD, passing --repo through', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const gh = fakeGh({ runs: [{ databaseId: 7, headSha: SHA_B }, { databaseId: 6, headSha: SHA_A }], download: { 6: mapText(SHA_A) } });
    const out = path.join(dir, 'map.json');
    const { deps, out: lines } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--repo', 'o/r', '--out', out], deps }), 0);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), mapText(SHA_A));
    assert.deepStrictEqual(gh.calls[0], ['run', 'list', '--workflow', 'test-impact-map.yml', '--branch', 'main', '--status', 'success',
      '--limit', '30', '--json', 'databaseId,headSha,event', '--repo', 'o/r']);
    assert.strictEqual(gh.calls[1][2], '6');
    assert.deepStrictEqual(gh.calls[1].slice(3, 5), ['--name', 'test-impact-map']);
    assert.deepStrictEqual(gh.calls[1].slice(-2), ['--repo', 'o/r']);
    assert.deepStrictEqual(git.calls.filter((c) => c.args[0] === 'merge-base').map((c) => c.args),
      [['merge-base', '--is-ancestor', '--end-of-options', SHA_B, 'HEAD'], ['merge-base', '--is-ancestor', '--end-of-options', SHA_A, 'HEAD']]);
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /^fetch: /);
    assert.deepStrictEqual(fs.readdirSync(dir), ['map.json'], 'no temp file is left beside the map');
  });
});

test('fetch skips a pull_request run even when its head branch is named main and it is an ancestor of HEAD', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A, SHA_B] });
    const gh = fakeGh({
      runs: [{ databaseId: 7, headSha: SHA_B, event: 'pull_request' }, { databaseId: 6, headSha: SHA_A, event: 'workflow_dispatch' }],
      download: { 6: mapText(SHA_A), 7: mapText(SHA_B) },
    });
    const out = path.join(dir, 'map.json');
    const { deps } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 0);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), mapText(SHA_A), 'the dispatch run is chosen over the newer pull_request run');
    assert.strictEqual(gh.calls[1][2], '6');
  });
});

test('fetch is a no-op when the cached map already has the chosen commit', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const gh = fakeGh({ runs: [{ databaseId: 6, headSha: SHA_A }] });
    const out = path.join(dir, 'map.json');
    fs.writeFileSync(out, mapText(SHA_A));
    const { deps } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 0);
    assert.strictEqual(gh.calls.length, 1, 'no download');
    assert.ok(!gh.calls[0].includes('--repo'));
  });
});

test('fetch exits 1 on a downloaded map whose commit is not the run headSha, leaving the cache alone', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const gh = fakeGh({ runs: [{ databaseId: 6, headSha: SHA_A }], download: { 6: mapText(SHA_B) } });
    const out = path.join(dir, 'map.json');
    fs.writeFileSync(out, mapText(SHA_C));
    const { deps, errs } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 1);
    assert.match(errs.join('\n'), /commit/);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), mapText(SHA_C));
  });
});

test('fetch exits 1 on a downloaded map from a failing suite', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const gh = fakeGh({ runs: [{ databaseId: 6, headSha: SHA_A }], download: { 6: mapText(SHA_A, 1) } });
    const out = path.join(dir, 'map.json');
    const { deps } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 1);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

// A gh whose chosen run's download extracts exactly `files` ({name: text}) into --dir.
function ghDownloading(files) {
  return (args) => {
    if (args[1] === 'list') return JSON.stringify([{ databaseId: 6, headSha: SHA_A, event: 'push' }]);
    const dir = args[args.indexOf('--dir') + 1];
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return '';
  };
}

test('fetch exits 1, leaving the cache alone, when the artifact holds no .json file or two', () => {
  withTempDir((dir) => {
    const out = path.join(dir, 'map.json');
    fs.writeFileSync(out, mapText(SHA_C));
    for (const [files, count] of [[{ 'notes.txt': 'x' }, 0], [{ 'a.json': mapText(SHA_A), 'b.json': mapText(SHA_A) }, 2]]) {
      const git = fakeGit({ root: dir, ancestors: [SHA_A] });
      const { deps, errs } = makeDeps({ git, gh: ghDownloading(files), cwd: dir });
      assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 1);
      assert.match(errs.join('\n'), new RegExp(`holds ${count} \\.json file\\(s\\), want exactly 1`));
      assert.strictEqual(fs.readFileSync(out, 'utf8'), mapText(SHA_C));
    }
  });
});

test('fetch exits 1, leaving the cache alone, on an artifact that does not parse as a map', () => {
  withTempDir((dir) => {
    const out = path.join(dir, 'map.json');
    fs.writeFileSync(out, mapText(SHA_C));
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const { deps, errs } = makeDeps({ git, gh: ghDownloading({ 'claude-tweaks-test-impact.json': '{"commit":' }), cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', out], deps }), 1);
    assert.match(errs.join('\n'), /map is invalid/);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), mapText(SHA_C));
  });
});

test('fetch exits 1 when no successful main map is an ancestor of HEAD', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [] });
    const gh = fakeGh({ runs: [{ databaseId: 7, headSha: SHA_B }] });
    const { deps, errs } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', path.join(dir, 'map.json')], deps }), 1);
    assert.match(errs.join('\n'), /ancestor of HEAD/);
  });
});

test('fetch exits 1 when gh fails', () => {
  withTempDir((dir) => {
    const git = fakeGit({ root: dir, ancestors: [SHA_A] });
    const gh = () => { throw new Error('gh: not logged in'); };
    const { deps, errs } = makeDeps({ git, gh, cwd: dir });
    assert.strictEqual(run({ argv: ['fetch', '--out', path.join(dir, 'map.json')], deps }), 1);
    assert.match(errs.join('\n'), /not logged in/);
  });
});

// ---- end to end ----

// The space-path fixture root under `tmp`: tools/run-tests.js and the tracer, lib/x.js and lib/y.js, and two
// tests (x loads lib/x.js, y reads lib/y.js), committed to a git repo. Returns the root, the env its runs take
// and HEAD.
function traceFixture(tmp) {
  const root = path.join(tmp, 'fixture root');
  for (const dir of ['tests', 'lib', path.join('tools', 'test-impact')]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const dir of ['slots', 'tmp']) fs.mkdirSync(path.join(tmp, dir));
  fs.copyFileSync(path.join(ROOT, 'tools', 'run-tests.js'), path.join(root, 'tools', 'run-tests.js'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'test-impact', 'tracer.js'), path.join(root, 'tools', 'test-impact', 'tracer.js'));
  const fixture = path.join(ROOT, 'tests', 'fixtures', 'test-impact');
  for (const f of ['x.js', 'y.js']) fs.copyFileSync(path.join(fixture, 'lib', f), path.join(root, 'lib', f));
  fs.writeFileSync(path.join(root, 'tests', 'x.test.js'),
    "'use strict';\nconst { test } = require('node:test');\ntest('loads x', () => { require('../lib/x'); });\n");
  fs.writeFileSync(path.join(root, 'tests', 'y.test.js'),
    "'use strict';\nconst { test } = require('node:test');\nconst fs = require('fs');\n" +
    "test('reads y', () => { fs.readFileSync('lib/y.js', 'utf8'); });\n");

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CT_TRACE_') || /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key)) delete env[key];
  }
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.CT_TEST_SUITE_SLOT_HELD;
  Object.assign(env, {
    CT_TEST_SUITE_SLOT_DIR: path.join(tmp, 'slots'), TMPDIR: path.join(tmp, 'tmp'), TMP: path.join(tmp, 'tmp'), TEMP: path.join(tmp, 'tmp'),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  });
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'fixture']);
  return { root, env, head: git(['rev-parse', 'HEAD']) };
}

// Tracing is POSIX-only (plugin/skills/test/impact-selection.md, Known limits): on win32 the quoted
// NODE_OPTIONS `--require` path loses its backslashes, so the traced children never load the tracer.
test('trace under a path with a space: the real CLI maps lib/x.js to the test that loads it', { skip: process.platform === 'win32' && 'tracing is POSIX-only' }, () => {
  withTempDir((tmp) => {
    const { root, env, head } = traceFixture(tmp);
    const out = path.join(tmp, 'map.json');
    const r = spawnSync(process.execPath, [CLI, 'trace', '--allow-dirty', '--out', out], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.stderr, '', 'a clean trace run says nothing on stderr: no skipped line, no header-less file');
    assert.match(r.stdout, /^trace: 2 test file\(s\), \d+ path\(s\), suite exit 0 → .*map\.json \(\d+ bytes\)$/m);
    const parsed = parseImpactMap(fs.readFileSync(out, 'utf8'));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.strictEqual(parsed.map.commit, head);
    assert.strictEqual(parsed.map.exitCode, 0);
    assert.ok(parsed.map.tests['tests/x.test.js'].f.includes('lib/x.js'), JSON.stringify(parsed.map.tests['tests/x.test.js']));
    assert.ok(parsed.map.tests['tests/y.test.js'].f.includes('lib/y.js'));
    assert.ok(!parsed.map.tests['tests/y.test.js'].f.includes('lib/x.js'));
  });
});

// A preload (tests/fixtures/test-impact/fail-trace-append.js) loaded before the tracer makes the trace write of
// the read of lib/y.js fail, so the real CLI must refuse the map rather than record an under-recorded one (#4158).
test('a trace whose write fails exits 1, writes no map and names the test that lost a read', { skip: process.platform === 'win32' && 'tracing is POSIX-only' }, () => {
  withTempDir((tmp) => {
    const { root, env } = traceFixture(tmp);
    const out = path.join(tmp, 'map.json');
    const fail = path.join(ROOT, 'tests', 'fixtures', 'test-impact', 'fail-trace-append.js');
    const r = spawnSync(process.execPath, [CLI, 'trace', '--allow-dirty', '--out', out], {
      cwd: root, env: { ...env, NODE_OPTIONS: `--require "${fail}"` }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.strictEqual(fs.existsSync(out), false, 'no map is written');
    assert.match(r.stderr, /could not record a read \(tests: tests\/y\.test\.js\) — no map written/);
  });
});

// Workflow shape — .github/workflows/test-impact-map.yml builds the map `fetch` downloads (the
// workflow and artifact names fetch passes to gh are pinned above): main and PR triggers, one run
// per commit (per ref for PRs), a clean-tree trace, an upload that survives a red suite, and a red
// suite failing the run so fetch's `--status success` listing skips it. Read through readText,
// as tests/windows-regression-file-issue.test.js does, so a CRLF checkout parses like CI's LF one.
const WORKFLOW_FACTS = {
  'push to main': /^on:\n {2}push:\n {4}branches: \[main\]\n/m,
  'workflow_dispatch': /^ {2}workflow_dispatch: \{\}\n/m,
  'pull_request on the tracer paths': /^ {2}pull_request:\n {4}paths:\n {6}- tools\/test-impact\/\*\*\n/m,
  'one run per commit, PR runs per ref': new RegExp('^concurrency:\\n {2}group: test-impact-map-\\$\\{\\{ github\\.event_name == \'pull_request\' && github\\.ref \\|\\| github\\.sha \\}\\}\\n'
    + ' {2}cancel-in-progress: \\$\\{\\{ github\\.event_name == \'pull_request\' \\}\\}\\n', 'm'),
  'a red suite fails the run': /^ {6}- name: Fail the run when the traced suite failed\n {8}run: \|\n {10}node -e "const m = require\(process\.argv\[1\]\); if \(m\.exitCode !== 0\) \{ [^\n]*process\.exit\(1\); \}" "\$RUNNER_TEMP\/test-impact-map\.json"\n/m,
  'read-only token': /^permissions:\n {2}contents: read\n/m,
  'clean-tree trace': /^ {8}run: node tools\/test-impact\.js trace --out "\$RUNNER_TEMP\/test-impact-map\.json"\n/m,
  'upload even on failure': /^ {8}if: always\(\)\n {8}with:\n {10}name: test-impact-map\n {10}path: \$\{\{ runner\.temp \}\}\/test-impact-map\.json\n/m,
};
const missingWorkflowFacts = (text) => Object.keys(WORKFLOW_FACTS).filter((k) => !WORKFLOW_FACTS[k].test(text));

test('the test-impact-map workflow uploads the artifact fetch downloads, traced on a clean tree', () => {
  const text = readText(path.join(ROOT, '.github', 'workflows', 'test-impact-map.yml'));
  assert.deepStrictEqual(missingWorkflowFacts(text), []);
  assert.doesNotMatch(text, /^\s*run:.*--allow-dirty/m, 'CI traces a fresh checkout; --allow-dirty would hide a dirtied tree');
  // The exit-code check runs after the upload, so a red-suite map is still uploaded for inspection.
  assert.ok(text.indexOf('uses: actions/upload-artifact@v4') < text.indexOf('- name: Fail the run when the traced suite failed'),
    'the exit-code check must follow the upload');
  // Run the check's own command line: exit 0 for a green map, 1 for a red one.
  const line = text.split('\n').find((l) => /^ {10}node -e "const m = require/.test(l)).trim();
  if (process.platform !== 'win32') {
    withTempDir((tmp) => {
      for (const [exitCode, want] of [[0, 0], [1, 1]]) {
        fs.writeFileSync(path.join(tmp, 'test-impact-map.json'), JSON.stringify({ exitCode }));
        const r = spawnSync('sh', ['-c', line], { env: { ...process.env, RUNNER_TEMP: tmp }, encoding: 'utf8' });
        assert.strictEqual(r.status, want, `exitCode ${exitCode}: ${r.stderr}`);
      }
    });
  }
  // Each fact goes red on its own: strip only its match and the predicate names exactly it.
  for (const [fact, re] of Object.entries(WORKFLOW_FACTS)) {
    const doctored = text.replace(re, '');
    assert.notStrictEqual(doctored, text, fact);
    assert.deepStrictEqual(missingWorkflowFacts(doctored), [fact]);
  }
});
