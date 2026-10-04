'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/set-verify-expectations');
const { runVerify } = require('../../../plugin/bin/lib/wrap-up/engine-verify');

const RUN_ID = '2026-09-21T213441-spec-2697-2757-2758-2759';
const DEFERRED = 'design-caches,worktree,ephemeral-server,claim-release,run-dir-archival';

// Same anchoring fixture shape as tests/bin-lib/set-config/cli.test.js: a
// fake main checkout (.git directory) holding the real run dirs, plus a
// linked worktree (.git FILE) carrying a worktree-local shadow that must be
// refused. `worktree` doubles as the cwd of the simulated worktree-isolated
// session. Both real locations of the file are present: a single-spec run
// dir and a multi-spec run's per-spec `spec-{n}/` subdirectory.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vexpcli-'));
  const main = path.join(root, 'main');
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const singleDir = path.join(pipelines, '2026-08-20T090000-spec-12');
  const specDir = path.join(pipelines, RUN_ID, 'spec-2758');
  const worktree = path.join(main, '.claude', 'worktrees', 'flow-spec-2758');
  const shadow = path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID, 'spec-2758');
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-2758\n');
  return { root, main, singleDir, specDir, worktree, shadow };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: { cwd: () => cwd, readFile: (p) => fs.readFileSync(p), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

const readJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verify-expectations.json'), 'utf8'));
const exists = (dir) => fs.existsSync(path.join(dir, 'verify-expectations.json'));

test('cli: a worktree-isolated session (cwd inside the linked worktree) writes spec-{n}/verify-expectations.json into the anchored main-checkout run dir', () => {
  const { specDir, worktree, shadow } = fixture();
  const { deps, out } = fakeDeps(worktree);
  const code = run(['--run', specDir, '--deferred', DEFERRED], deps);
  assert.equal(code, 0);
  assert.deepEqual(readJson(specDir), { version: 1, memory: [], upstream: [], deferred: DEFERRED.split(',') });
  assert.ok(out.join('').includes(path.join(fs.realpathSync(specDir), 'verify-expectations.json')), 'the written path is echoed');
  assert.ok(!exists(shadow), 'nothing is written into the worktree-local shadow');
});

test('cli: a worktree-local shadow run dir is refused (exit 3) and its existing file is byte-unchanged', () => {
  const { worktree, shadow } = fixture();
  const before = '{"version":1,"memory":[],"upstream":[],"sentinel":true}';
  fs.writeFileSync(path.join(shadow, 'verify-expectations.json'), before);
  const { deps, err } = fakeDeps(worktree);
  const code = run(['--run', shadow, '--deferred', DEFERRED], deps);
  assert.equal(code, 3);
  assert.ok(/not anchored/.test(err.join('')));
  assert.equal(fs.readFileSync(path.join(shadow, 'verify-expectations.json'), 'utf8'), before);
});

test('cli: a path outside the main checkout is refused (exit 3), nothing written', () => {
  const { root, worktree } = fixture();
  const outside = path.join(root, 'elsewhere', '.claude-tweaks', 'pipelines', 'run-x');
  fs.mkdirSync(outside, { recursive: true });
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', outside], deps), 3);
  assert.ok(/not anchored/.test(err.join('')));
  assert.ok(!exists(outside));
});

test('cli: a missing run dir is exit 3 and names it', () => {
  const { main, worktree } = fixture();
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', path.join(main, 'nope')], deps), 3);
  assert.ok(/does not exist/.test(err.join('')));
});

test('cli: after the deferred write, the per-spec verify probe reads skip (nothing recorded), not unknown (expectations file missing)', () => {
  const { specDir, worktree } = fixture();
  const probe = () => {
    const { rows } = runVerify({ runDir: specDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    return ['memory-updates', 'upstream-feedback'].map((check) => rows.find((r) => r.check === check));
  };
  for (const row of probe()) {
    assert.equal(row.result, 'unknown');
    assert.match(row.detail, /expectations file missing/);
  }
  assert.equal(run(['--run', specDir, '--deferred', DEFERRED], fakeDeps(worktree).deps), 0);
  for (const row of probe()) {
    assert.equal(row.result, 'skip');
    assert.match(row.detail, /nothing recorded/);
  }
});

test('cli: no field flags creates the empty file in a single-spec run dir, and a re-run leaves recorded fields intact', () => {
  const { singleDir, worktree } = fixture();
  assert.equal(run(['--run', singleDir], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), { version: 1, memory: [], upstream: [] });
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '41'], fakeDeps(worktree).deps), 0);
  assert.equal(run(['--run', singleDir], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), { version: 1, memory: [], upstream: [], oversightExempt: [41] });
});

test('cli: --oversight-exempt appends to the existing array (deduplicated, sorted) and preserves every other field', () => {
  const { singleDir, worktree } = fixture();
  fs.writeFileSync(path.join(singleDir, 'verify-expectations.json'), JSON.stringify({ version: 1, memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [], oversightExempt: [90] }));
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '12'], fakeDeps(worktree).deps), 0);
  assert.equal(run(['--run', singleDir, '--oversight-exempt', '12,90'], fakeDeps(worktree).deps), 0);
  const data = readJson(singleDir);
  assert.deepEqual(data.oversightExempt, [12, 90]);
  assert.deepEqual(data.memory, [{ file: 'a.md', indexFile: 'M.md' }]);
});

test('cli: --issues and --file compose in one call', () => {
  const { root, singleDir, worktree } = fixture();
  const payload = path.join(root, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({ memory: [{ file: 'm.md', indexFile: 'MEMORY.md' }], upstream: [{ url: 'https://github.com/o/r/issues/3' }] }));
  assert.equal(run(['--run', singleDir, '--issues', '2764,2765', '--file', payload], fakeDeps(worktree).deps), 0);
  assert.deepEqual(readJson(singleDir), {
    version: 1,
    memory: [{ file: 'm.md', indexFile: 'MEMORY.md' }],
    upstream: [{ url: 'https://github.com/o/r/issues/3' }],
    issues: [2764, 2765],
  });
});

test('cli: a malformed --file payload is exit 2 and nothing is written', () => {
  const { root, singleDir, worktree } = fixture();
  const write = (name, body) => { const p = path.join(root, name); fs.writeFileSync(p, body); return p; };
  const cases = [
    [['--file', path.join(root, 'absent.json')], /could not read --file/],
    [['--file', write('bad.json', 'not json')], /not valid JSON/],
    [['--file', write('arr.json', '[]')], /must contain a JSON object/],
    [['--file', write('unknown.json', '{"version":1}')], /unknown field "version"/],
    [['--file', write('entry.json', '{"memory":[{"file":"m.md"}]}')], /memory\[0\]/],
    [['--file', write('dup.json', '{"issues":[1]}'), '--issues', '2'], /given by both --file and --issues/],
    [['--file'], /--file requires a path/],
  ];
  for (const [args, pattern] of cases) {
    const { deps, err } = fakeDeps(worktree);
    assert.equal(run(['--run', singleDir, ...args], deps), 2, args.join(' '));
    assert.match(err.join(''), pattern);
  }
  assert.ok(!exists(singleDir));
});

test('cli: malformed invocations are exit 2 and nothing is written', () => {
  const { singleDir, worktree } = fixture();
  const cases = [
    [['--deferred', DEFERRED], /--run <run-dir> is required/],
    [['--run', singleDir, '--bogus'], /unknown argument: --bogus/],
    [['--run', singleDir, '--deferred'], /--deferred requires a comma-separated value/],
    [['--run', singleDir, '--deferred', 'worktree,,claim-release'], /--deferred has an empty entry/],
    [['--run', singleDir, '--deferred', 'Not A Token'], /deferred\[0\]/],
    [['--run', singleDir, '--issues', '12,abc'], /--issues entries must be record numbers/],
    [['--run', singleDir, '--oversight-exempt', '0'], /oversightExempt\[0\] must be a positive integer/],
  ];
  for (const [args, pattern] of cases) {
    const { deps, err } = fakeDeps(worktree);
    assert.equal(run(args, deps), 2, args.join(' '));
    assert.match(err.join(''), pattern);
  }
  assert.ok(!exists(singleDir));
});

test('cli: --help prints usage, exit 0, before any run-dir resolution', () => {
  const { worktree } = fixture();
  const { deps, out } = fakeDeps(worktree);
  assert.equal(run(['--help'], deps), 0);
  assert.ok(out.join('').includes('usage: set-verify-expectations.js'));
});
