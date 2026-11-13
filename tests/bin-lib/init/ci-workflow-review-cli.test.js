// tests/bin-lib/init/ci-workflow-review-cli.test.js — plugin/bin/ci-workflow-review.js
// (#5162), the report-only CLI over plugin/bin/lib/init/ci-workflow-review.js.
// Spawns the real binary against temp fixtures under os.tmpdir(), never this
// checkout, and calls run() in-process for the injected-fs cases. Every call
// goes through runCli / runInProcess, which snapshot the fixture before and
// after and require the two to match: AC9.1 holds for every invocation here.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO, 'plugin', 'bin', 'ci-workflow-review.js');
const { toPosix, isPathContained } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'shared-primitives.js'));
const { generateWorkflowYaml } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'issue-branch-tracking.js'));
const { chmodDenialSkip } = require('../../helpers/root');

const loadCli = () => require(CLI);
const NO_SYMLINKS = process.platform === 'win32';
// A path under a regular file is ENOTDIR on POSIX; win32 is not relied on to
// report the same code, so the real-fixture case is POSIX-only and an
// injected ENOTDIR covers every platform.
const NO_REAL_ENOTDIR = process.platform === 'win32' && 'a path under a regular file is pinned as ENOTDIR on POSIX only';
const USAGE = 'usage: ci-workflow-review.js --root <dir> [--drift] [--json]';

const CONC = 'concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n';
const draftWf = (types) => `name: CI\non:\n  pull_request:\n    types: [${types}]\n${CONC}jobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
// Valid on every check: drafts skipped, ready_for_review re-runs the job.
const CLEAN = draftWf('opened, synchronize, reopened, ready_for_review');
// One finding: draft-skip-no-ready-for-review.
const NO_READY = draftWf('opened, synchronize');
const NO_READY_DETAIL = 'job(s) test skip drafts; types: opened, synchronize';
const BAD = 'on: [push,\n  pull_request]\njobs:\n  a:\n    runs-on: x\n';
const BAD_REASON = 'on: block not read; pull_request trigger not read';
const decl = (ci) => JSON.stringify({
  checks: { tests: 'npm test' },
  rules: [{ match: '**', suites: ['tests'], static: false }],
  ...(ci ? { ci } : {}),
});
const CI_DECL = decl({ tests: { workflow: 'ci.yml', job: 'test' } });

function tmpRoot(prefix = 'cwr-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root, rel, text) {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function link(root, rel, target) {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.symlinkSync(target, p);
  return p;
}

// Recursive lstat walk keyed by toPosix relative path: a file's bytes, a
// symlink's target. A file or directory the walk cannot read (chmod 0) keeps
// its mtime (and a file its size) instead, so a write to it still shows.
function snapshot(root) {
  const out = {};
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = toPosix(path.relative(root, full));
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) out[rel] = { type: 'symlink', target: fs.readlinkSync(full) };
      else if (st.isDirectory()) {
        try {
          fs.readdirSync(full);
        } catch (err) {
          if (err.code !== 'EACCES') throw err;
          out[rel] = { type: 'directory', unlistable: true, mtimeMs: st.mtimeMs };
          continue;
        }
        out[rel] = { type: 'directory' };
        walk(full);
      } else {
        try {
          out[rel] = { type: 'file', bytes: fs.readFileSync(full).toString('base64') };
        } catch (err) {
          if (err.code !== 'EACCES') throw err;
          out[rel] = { type: 'file', unreadable: true, size: st.size, mtimeMs: st.mtimeMs };
        }
      }
    }
  })(root);
  return out;
}

function assertSameSnapshot(before, after) {
  assert.deepStrictEqual(after, before, 'the CLI changed the fixture');
}

function spawnCli(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// `afterSpawn` exists only for the AC9.1 control, which changes the fixture
// between the two snapshots to prove the comparison goes red.
function runCli(root, args = [], { afterSpawn } = {}) {
  const before = snapshot(root);
  const res = spawnCli(['--root', root, ...args]);
  if (afterSpawn) afterSpawn();
  assertSameSnapshot(before, snapshot(root));
  return res;
}

function runInProcess(root, args, deps = {}) {
  const out = [];
  const err = [];
  const before = snapshot(root);
  const status = loadCli().run(['--root', root, ...args], { stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...deps });
  assertSameSnapshot(before, snapshot(root));
  return { status, stdout: out.join(''), stderr: err.join('') };
}

const linesOf = (s) => s.trimEnd().split('\n');

// readFileSync spy over the real fs; `calls` collects every path it was given.
function spyFs() {
  const calls = [];
  const fsImpl = { ...fs, readFileSync: (p, ...rest) => { calls.push(String(p)); return fs.readFileSync(p, ...rest); } };
  return { fsImpl, calls };
}

// AC10.4: one fixture per AC10.1-10.3 outcome. Each test below builds its root
// through fixture(id), which refuses an id this table does not name.
const CASES = [
  { ac: 'AC10.1', outcome: 'missing workflows directory → reviewed: 0', fixture: 'no-workflows-dir' },
  { ac: 'AC10.1', outcome: 'missing verify-scope.json → check 2 skipped', fixture: 'no-declaration' },
  { ac: 'AC10.2', outcome: 'workflow symlinked outside → unparsed, never read', fixture: 'workflow-outside' },
  { ac: 'AC10.2', outcome: 'verify-scope.json symlinked outside → exit 1, never read', fixture: 'declaration-outside' },
  { ac: 'AC10.3', outcome: 'dangling workflow symlink → unparsed', fixture: 'workflow-dangling' },
  { ac: 'AC10.3', outcome: 'dangling verify-scope.json symlink → exit 1', fixture: 'declaration-dangling' },
];

const FIXTURES = {
  'no-workflows-dir': () => ({ root: tmpRoot() }),
  'no-declaration': () => {
    const root = tmpRoot();
    write(root, '.github/workflows/ci.yml', CLEAN);
    return { root };
  },
  'workflow-outside': () => {
    const root = tmpRoot();
    const outside = tmpRoot('cwr-outside-');
    write(root, '.github/workflows/ci.yml', CLEAN);
    link(root, '.github/workflows/out.yml', write(outside, 'out.yml', NO_READY));
    return { root, outside };
  },
  'declaration-outside': () => {
    const root = tmpRoot();
    const outside = tmpRoot('cwr-outside-');
    write(root, '.github/workflows/ci.yml', CLEAN);
    link(root, '.claude-tweaks/verify-scope.json', write(outside, 'verify-scope.json', CI_DECL));
    return { root, outside };
  },
  'workflow-dangling': () => {
    const root = tmpRoot();
    write(root, '.github/workflows/ci.yml', CLEAN);
    link(root, '.github/workflows/gone.yml', path.join(root, 'no-such-target.yml'));
    return { root };
  },
  'declaration-dangling': () => {
    const root = tmpRoot();
    write(root, '.github/workflows/ci.yml', CLEAN);
    link(root, '.claude-tweaks/verify-scope.json', path.join(root, 'no-such-target.json'));
    return { root };
  },
};

function fixture(id) {
  assert.ok(CASES.some((c) => c.fixture === id), `fixture ${id} is not named in CASES`);
  return FIXTURES[id]();
}

test('AC8.1: --drift --json prints exactly one JSON line with exactly reviewed, findings, unparsed', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', NO_READY);
  const res = runCli(root, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trimEnd().split('\n').length, 1);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(out), ['reviewed', 'findings', 'unparsed']);
  assert.deepEqual(out, {
    reviewed: 1,
    findings: [{ workflow: '.github/workflows/ci.yml', check: 'draft-skip-no-ready-for-review', remedy: 'Workflow shape', detail: NO_READY_DETAIL }],
    unparsed: [],
  });
});

test('AC8.2: no .github/workflows directory prints reviewed: 0 and no findings', () => {
  const root = tmpRoot();
  const res = runCli(root, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { reviewed: 0, findings: [], unparsed: [] });
});

test('AC8.3: an invalid verify-scope.json exits 1, error on stderr, stdout empty', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  write(root, '.claude-tweaks/verify-scope.json', '{');
  for (const args of [['--drift', '--json'], []]) {
    const res = runCli(root, args);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /^ci-workflow-review\.js: verify-scope\.json: could not parse JSON/);
  }
});

test('AC8.4: a .github/workflows that is a regular file exits 1 the same way', () => {
  const root = tmpRoot();
  write(root, '.github/workflows', 'not a directory');
  const res = runCli(root, ['--drift', '--json']);
  assert.equal(res.status, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /\.github\/workflows/);
  assert.equal(res.stderr, 'ci-workflow-review.js: .github/workflows is not a directory\n');
});

test('AC8.5: a single unreadable workflow file is an unparsed entry with exit 0 (real EACCES)', chmodDenialSkip('root reads through mode 0'), () => {
  const root = tmpRoot();
  write(root, '.github/workflows/a.yml', CLEAN);
  const locked = write(root, '.github/workflows/b.yml', CLEAN);
  fs.chmodSync(locked, 0o000);
  try {
    const res = runCli(root, ['--drift', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.unparsed.length, 1);
    assert.equal(out.unparsed[0].workflow, '.github/workflows/b.yml');
    assert.match(out.unparsed[0].reason, /^could not read: EACCES$/);
    assert.deepEqual(out.findings, []);
  } finally {
    fs.chmodSync(locked, 0o644);
  }
});

test('AC8.5: a single unreadable workflow file is an unparsed entry with exit 0 (injected EIO)', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/a.yml', CLEAN);
  write(root, '.github/workflows/b.yml', CLEAN);
  const fsImpl = {
    ...fs,
    readFileSync: (p, ...rest) => {
      if (String(p).endsWith('b.yml')) throw Object.assign(new Error('x'), { code: 'EIO' });
      return fs.readFileSync(p, ...rest);
    },
  };
  const res = runInProcess(root, ['--drift', '--json'], { fsImpl });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    reviewed: 2, findings: [], unparsed: [{ workflow: '.github/workflows/b.yml', reason: 'could not read: EIO' }],
  });
});

test('a directory named *.yml under .github/workflows is unparsed: not a regular file', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  fs.mkdirSync(path.join(root, '.github', 'workflows', 'dir.yml'));
  const res = runCli(root, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).unparsed, [{ workflow: '.github/workflows/dir.yml', reason: 'not a regular file' }]);
});

// path-guard sees `code` from both realpath and lstat for any path ending in
// `suffix`: the leaf reads as unreadable (EIO) or as missing-but-not-ENOENT
// (ENOTDIR), on every platform.
function leafError(suffix, code) {
  return pathFaults({ [suffix]: code });
}

// pathFaults({ suffix: code | 'dangling' }): each path ending in a suffix
// fails realpath and lstat with `code`; 'dangling' instead lstats as a
// symlink while realpath fails ENOENT (a dangling link, on every platform).
function pathFaults(faults) {
  const find = (p) => Object.keys(faults).find((s) => String(p).endsWith(s));
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const SYMLINK = { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
  return {
    realpath: (p) => {
      const s = find(p);
      if (s === undefined) return fs.realpathSync.native(p);
      return fail(faults[s] === 'dangling' ? 'ENOENT' : faults[s]);
    },
    fsImpl: {
      ...fs,
      lstatSync: (p, ...rest) => {
        const s = find(p);
        if (s === undefined) return fs.lstatSync(p, ...rest);
        return faults[s] === 'dangling' ? SYMLINK : fail(faults[s]);
      },
    },
  };
}

const WORKFLOWS_SUFFIX = `${path.sep}.github${path.sep}workflows`;
const DECL_SUFFIX = `${path.sep}.claude-tweaks${path.sep}verify-scope.json`;
const GITHUB_SUFFIX = `${path.sep}.github`;
const CT_SUFFIX = `${path.sep}.claude-tweaks`;

test('a dangling-symlink .claude-tweaks or .github exits 1, never absent (real symlinks)', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const decl = tmpRoot();
  write(decl, '.github/workflows/ci.yml', NO_READY);
  link(decl, '.claude-tweaks', path.join(decl, 'no-such-dir'));
  const a = runCli(decl, ['--drift', '--json']);
  assert.equal(a.status, 1, a.stdout);
  assert.equal(a.stdout, '');
  assert.equal(a.stderr, 'ci-workflow-review.js: verify-scope.json: .claude-tweaks is a dangling symlink — not read\n');

  const gh = tmpRoot();
  link(gh, '.github', path.join(gh, 'no-such-dir'));
  const b = runCli(gh, ['--drift', '--json']);
  assert.equal(b.status, 1, b.stdout);
  assert.equal(b.stdout, '');
  assert.equal(b.stderr, 'ci-workflow-review.js: .github/workflows: .github is a dangling symlink — not read\n');
});

test('a dangling or unreadable parent over an ENOENT leaf exits 1, never absent (injected, any platform)', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  const cases = [
    [{ [DECL_SUFFIX]: 'ENOENT', [CT_SUFFIX]: 'dangling' }, 'verify-scope.json: .claude-tweaks is a dangling symlink — not read'],
    [{ [DECL_SUFFIX]: 'ENOENT', [CT_SUFFIX]: 'EIO' }, 'verify-scope.json: unreadable: EIO'],
    [{ [WORKFLOWS_SUFFIX]: 'ENOENT', [GITHUB_SUFFIX]: 'dangling' }, '.github/workflows: .github is a dangling symlink — not read'],
    [{ [WORKFLOWS_SUFFIX]: 'ENOENT', [GITHUB_SUFFIX]: 'EIO' }, '.github/workflows: unreadable: EIO — not read'],
  ];
  for (const [faults, reason] of cases) {
    const res = runInProcess(root, ['--drift', '--json'], pathFaults(faults));
    assert.equal(res.status, 1, `${reason}: ${res.stdout}`);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, `ci-workflow-review.js: ${reason}\n`);
  }
  // Control: an ENOENT leaf under an ENOENT parent is the silent absent case.
  const absent = runInProcess(root, ['--drift', '--json'], pathFaults({ [DECL_SUFFIX]: 'ENOENT', [CT_SUFFIX]: 'ENOENT' }));
  assert.equal(absent.status, 0, absent.stderr);
  assert.deepEqual(JSON.parse(absent.stdout).findings, []);
});

// Every path handed to realpath, lstatSync, readdirSync or readFileSync, over
// the real fs (realpath: the real one unless given).
function traceFs(realpath = fs.realpathSync.native) {
  const calls = [];
  const rec = (fn) => (p, ...rest) => { calls.push(String(p)); return fn(p, ...rest); };
  return {
    calls,
    deps: {
      realpath: rec(realpath),
      fsImpl: { ...fs, lstatSync: rec(fs.lstatSync), readdirSync: rec(fs.readdirSync), readFileSync: rec(fs.readFileSync) },
    },
  };
}

// The traced paths strictly under the in-checkout `parent`, or at or under
// `outside` (as given or canonical): none may appear once the parent is refused.
const touchedUnder = (calls, parent, outside) => calls.filter((p) => isPathContained(p, parent)
  || [outside, fs.realpathSync.native(outside)].some((o) => isPathContained(p, o, { orEqual: true })));

const OUTSIDE_PARENT = {
  '.claude-tweaks': 'verify-scope.json: .claude-tweaks resolves outside the checkout — not read',
  '.github': '.github/workflows: .github resolves outside the checkout — not read',
};

test('a .claude-tweaks or .github that resolves outside the checkout exits 1, leaf or not, and nothing under it is touched (real symlinks)', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const cases = [
    ['.claude-tweaks', () => {}],
    ['.claude-tweaks', (out) => write(out, 'verify-scope.json', CI_DECL)],
    ['.github', () => {}],
    ['.github', (out) => write(out, 'workflows/ci.yml', NO_READY)],
  ];
  for (const [parent, populate] of cases) {
    const root = tmpRoot();
    const outside = tmpRoot('cwr-outside-');
    populate(outside);
    if (parent === '.claude-tweaks') write(root, '.github/workflows/ci.yml', NO_READY);
    link(root, parent, outside);
    const want = `ci-workflow-review.js: ${OUTSIDE_PARENT[parent]}\n`;
    const res = runCli(root, ['--drift', '--json']);
    assert.equal(res.status, 1, `${parent}: ${res.stdout}`);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, want);
    const t = traceFs();
    const inProc = runInProcess(root, ['--drift', '--json'], t.deps);
    assert.equal(inProc.status, 1, `${parent}: ${inProc.stdout}`);
    assert.equal(inProc.stdout, '');
    assert.equal(inProc.stderr, want);
    assert.deepEqual(touchedUnder(t.calls, path.join(root, parent), outside), [], `${parent}: touched under the refused parent`);
  }
});

test('a .claude-tweaks or .github that resolves outside the checkout exits 1, leaf or not (injected realpath, any platform)', () => {
  const outside = tmpRoot('cwr-outside-');
  write(outside, 'verify-scope.json', CI_DECL);
  write(outside, 'workflows/ci.yml', NO_READY);
  const outsideReal = fs.realpathSync.native(outside);
  const cases = [
    // [parent, suffix the realpath stub redirects outside, the in-checkout leaf exists]
    ['.claude-tweaks', CT_SUFFIX, false],
    ['.claude-tweaks', CT_SUFFIX, true],
    ['.github', GITHUB_SUFFIX, false],
    ['.github', GITHUB_SUFFIX, true],
  ];
  for (const [parent, suffix, withLeaf] of cases) {
    const root = tmpRoot();
    if (parent === '.claude-tweaks' || withLeaf) write(root, '.github/workflows/ci.yml', NO_READY);
    if (parent === '.claude-tweaks' && withLeaf) write(root, '.claude-tweaks/verify-scope.json', CI_DECL);
    const t = traceFs((p) => (String(p).endsWith(suffix) ? outsideReal : fs.realpathSync.native(p)));
    const res = runInProcess(root, ['--drift', '--json'], t.deps);
    const label = `${parent} (leaf ${withLeaf ? 'present' : 'absent'})`;
    assert.equal(res.status, 1, `${label}: ${res.stdout}`);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, `ci-workflow-review.js: ${OUTSIDE_PARENT[parent]}\n`);
    assert.deepEqual(touchedUnder(t.calls, path.join(root, parent), outside), [], `${label}: touched under the refused parent`);
  }
  // Control: a parent the stub resolves to a directory inside the checkout is
  // contained, so the same absent leaf stays silent.
  const inside = tmpRoot();
  write(inside, '.github/workflows/ci.yml', NO_READY);
  fs.mkdirSync(path.join(inside, 'real-ct'));
  const insideCt = fs.realpathSync.native(path.join(inside, 'real-ct'));
  const c = runInProcess(inside, ['--drift', '--json'], { realpath: (p) => (String(p).endsWith(CT_SUFFIX) ? insideCt : fs.realpathSync.native(p)) });
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(JSON.parse(c.stdout).findings.map((f) => f.check), ['draft-skip-no-ready-for-review']);
});

test('a workflow file that vanishes between listing and read is unparsed, never absent (injected)', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  write(root, '.github/workflows/late.yml', CLEAN);
  const fsImpl = {
    ...fs,
    // gone.yml is listed but never on disk: it vanished before resolve.
    readdirSync: (p, ...rest) => {
      const names = fs.readdirSync(p, ...rest);
      return String(p).endsWith(`${path.sep}workflows`) ? [...names, 'gone.yml'] : names;
    },
    // late.yml resolves, then vanishes before its read.
    readFileSync: (p, ...rest) => {
      if (String(p).endsWith(`${path.sep}late.yml`)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fs.readFileSync(p, ...rest);
    },
  };
  const res = runInProcess(root, ['--drift', '--json'], { fsImpl });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    reviewed: 3,
    findings: [],
    unparsed: [
      { workflow: '.github/workflows/gone.yml', reason: 'vanished during the review' },
      { workflow: '.github/workflows/late.yml', reason: 'could not read: ENOENT' },
    ],
  });
});

test('a .claude-tweaks or .github that is a regular file exits 1: only ENOENT is silent (real ENOTDIR)', { skip: NO_REAL_ENOTDIR }, () => {
  const decl = tmpRoot();
  write(decl, '.github/workflows/ci.yml', NO_READY);
  write(decl, '.claude-tweaks', 'not a directory');
  const a = runCli(decl, ['--drift', '--json']);
  assert.equal(a.status, 1);
  assert.equal(a.stdout, '');
  assert.equal(a.stderr, 'ci-workflow-review.js: verify-scope.json: unreadable: ENOTDIR\n');

  const gh = tmpRoot();
  write(gh, '.github', 'not a directory');
  const b = runCli(gh, ['--drift', '--json']);
  assert.equal(b.status, 1);
  assert.equal(b.stdout, '');
  assert.equal(b.stderr, 'ci-workflow-review.js: .github/workflows: unreadable: ENOTDIR — not read\n');
});

test('a non-ENOENT miss or an unreadable leaf exits 1 for the declaration and the workflows directory (injected)', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  write(root, '.claude-tweaks/verify-scope.json', CI_DECL);
  const cases = [
    [DECL_SUFFIX, 'ENOTDIR', 'verify-scope.json: unreadable: ENOTDIR'],
    [DECL_SUFFIX, 'EIO', 'verify-scope.json: unreadable: EIO'],
    [WORKFLOWS_SUFFIX, 'ENOTDIR', '.github/workflows: unreadable: ENOTDIR — not read'],
    [WORKFLOWS_SUFFIX, 'EIO', '.github/workflows: unreadable: EIO — not read'],
  ];
  for (const [suffix, code, reason] of cases) {
    const res = runInProcess(root, ['--drift', '--json'], leafError(suffix, code));
    assert.equal(res.status, 1, `${suffix} ${code}`);
    assert.equal(res.stdout, '', `${suffix} ${code}`);
    assert.equal(res.stderr, `ci-workflow-review.js: ${reason}\n`);
  }
  // Control: ENOENT on the same leaves is the silent absent case.
  const absent = runInProcess(root, ['--drift', '--json'], leafError(DECL_SUFFIX, 'ENOENT'));
  assert.equal(absent.status, 0, absent.stderr);
  assert.deepEqual(JSON.parse(absent.stdout).findings, []);
  const noDir = runInProcess(root, ['--drift', '--json'], leafError(WORKFLOWS_SUFFIX, 'ENOENT'));
  assert.equal(noDir.status, 0, noDir.stderr);
  assert.equal(JSON.parse(noDir.stdout).reviewed, 0);
});

// Where the OS reports a path under a regular file as ENOENT (not ENOTDIR),
// the leaf alone reads as absent; the parent's type decides. The injected
// ENOENT leaf stands in for that OS on every platform.
test('an ENOENT leaf under a regular-file parent exits 1 like ENOTDIR (injected, any platform)', () => {
  const decl = tmpRoot();
  write(decl, '.github/workflows/ci.yml', NO_READY);
  write(decl, '.claude-tweaks', 'not a directory');
  const a = runInProcess(decl, ['--drift', '--json'], leafError(DECL_SUFFIX, 'ENOENT'));
  assert.equal(a.status, 1, a.stdout);
  assert.equal(a.stdout, '');
  assert.equal(a.stderr, 'ci-workflow-review.js: verify-scope.json: unreadable: ENOTDIR\n');

  const gh = tmpRoot();
  write(gh, '.github', 'not a directory');
  const b = runInProcess(gh, ['--drift', '--json'], leafError(WORKFLOWS_SUFFIX, 'ENOENT'));
  assert.equal(b.status, 1, b.stdout);
  assert.equal(b.stdout, '');
  assert.equal(b.stderr, 'ci-workflow-review.js: .github/workflows: unreadable: ENOTDIR — not read\n');

  // Control: a parent that is a symlink to a directory is a directory, so the
  // ENOENT leaf under it stays the silent absent case.
  if (!NO_SYMLINKS) {
    const linked = tmpRoot();
    write(linked, '.github/workflows/ci.yml', NO_READY);
    fs.mkdirSync(path.join(linked, 'real-ct'));
    link(linked, '.claude-tweaks', path.join(linked, 'real-ct'));
    const c = runInProcess(linked, ['--drift', '--json'], leafError(DECL_SUFFIX, 'ENOENT'));
    assert.equal(c.status, 0, c.stderr);
    assert.deepEqual(JSON.parse(c.stdout).findings.map((f) => f.check), ['draft-skip-no-ready-for-review']);
  }
});

test('a workflows directory that cannot be listed exits 1 (injected readdirSync throw)', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  const fsImpl = {
    ...fs,
    readdirSync: (p, ...rest) => {
      if (String(p).endsWith(`${path.sep}workflows`)) throw Object.assign(new Error('x'), { code: 'EIO' });
      return fs.readdirSync(p, ...rest);
    },
  };
  const res = runInProcess(root, ['--drift', '--json'], { fsImpl });
  assert.equal(res.status, 1);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, 'ci-workflow-review.js: .github/workflows could not be listed: EIO\n');
});

test('a workflows directory or declaration the user cannot read exits 1 (real EACCES)', chmodDenialSkip('root reads through mode 0'), () => {
  const locked = (root, rel, fn) => {
    const p = path.join(root, ...rel.split('/'));
    fs.chmodSync(p, 0o000);
    try { fn(); } finally { fs.chmodSync(p, 0o755); }
  };
  const expectExit1 = (root, reason) => {
    const res = runCli(root, ['--drift', '--json']);
    assert.equal(res.status, 1, res.stdout);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, `ci-workflow-review.js: ${reason}\n`);
  };

  // .github mode 0: the workflows leaf can neither be resolved nor lstat'd.
  const a = tmpRoot();
  write(a, '.github/workflows/ci.yml', CLEAN);
  locked(a, '.github', () => expectExit1(a, '.github/workflows: unreadable: EACCES — not read'));

  // workflows mode 0: resolved and a directory, but cannot be listed.
  const b = tmpRoot();
  write(b, '.github/workflows/ci.yml', CLEAN);
  locked(b, '.github/workflows', () => expectExit1(b, '.github/workflows could not be listed: EACCES'));

  // .claude-tweaks mode 0: the declaration leaf can neither be resolved nor lstat'd.
  const c = tmpRoot();
  write(c, '.github/workflows/ci.yml', CLEAN);
  write(c, '.claude-tweaks/verify-scope.json', CI_DECL);
  locked(c, '.claude-tweaks', () => expectExit1(c, 'verify-scope.json: unreadable: EACCES'));

  // verify-scope.json mode 0: resolved and contained, but readDeclaration's
  // own read fails, and its error passes through.
  const d = tmpRoot();
  write(d, '.github/workflows/ci.yml', CLEAN);
  write(d, '.claude-tweaks/verify-scope.json', CI_DECL);
  locked(d, '.claude-tweaks/verify-scope.json', () => {
    const res = runCli(d, ['--drift', '--json']);
    assert.equal(res.status, 1, res.stdout);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /^ci-workflow-review\.js: verify-scope\.json: could not read .*verify-scope\.json: EACCES\b[^\n]*\n$/);
  });
});

test('discovery: .yml and .yaml in any case, sorted; every other name is ignored', () => {
  const root = tmpRoot();
  for (const name of ['x.Yaml', 'ci.yaml', 'Upper.YML', 'notes.txt', 'ci.yml.bak', 'yml', 'README.md']) {
    write(root, `.github/workflows/${name}`, BAD);
  }
  const res = runCli(root, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.reviewed, 3);
  assert.deepEqual(out.unparsed.map((u) => u.workflow), [
    '.github/workflows/Upper.YML', '.github/workflows/ci.yaml', '.github/workflows/x.Yaml',
  ]);
});

test('AC10.1: a missing workflows directory and a missing verify-scope.json are silent', () => {
  const { root: noDir } = fixture('no-workflows-dir');
  const a = runCli(noDir, ['--drift', '--json']);
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual(JSON.parse(a.stdout), { reviewed: 0, findings: [], unparsed: [] });
  assert.equal(a.stderr, '');

  const { root: noDecl } = fixture('no-declaration');
  const b = runCli(noDecl, ['--drift', '--json']);
  assert.equal(b.status, 0, b.stderr);
  assert.deepEqual(JSON.parse(b.stdout), { reviewed: 1, findings: [], unparsed: [] });
  assert.equal(b.stderr, '');

  // Control (not one of the six cases): the same workflow beside a declaration
  // that names it does produce check 2, so its absence above is the skip.
  const control = tmpRoot();
  write(control, '.github/workflows/ci.yml', CLEAN);
  write(control, '.claude-tweaks/verify-scope.json', CI_DECL);
  const c = runCli(control, ['--drift', '--json']);
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(JSON.parse(c.stdout).findings.map((f) => f.check), ['draft-skip-with-ci-source']);
});

test('AC10.2: a workflow or verify-scope.json symlinked outside the checkout is refused and never read', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const wf = fixture('workflow-outside');
  const res = runCli(wf.root, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    reviewed: 2,
    findings: [],
    unparsed: [{ workflow: '.github/workflows/out.yml', reason: 'symlink resolves outside the checkout — not read' }],
  });
  const spy = spyFs();
  const inProc = runInProcess(wf.root, ['--drift', '--json'], { fsImpl: spy.fsImpl });
  assert.equal(inProc.status, 0, inProc.stderr);
  assert.ok(spy.calls.some((p) => p.endsWith(`${path.sep}ci.yml`)), `the spy never saw the in-checkout read: ${spy.calls.join(', ')}`);
  assert.ok(!spy.calls.some((p) => p.includes(path.basename(wf.outside))), `the outside file was read: ${spy.calls.join(', ')}`);

  const dc = fixture('declaration-outside');
  const d = runCli(dc.root, ['--drift', '--json']);
  assert.equal(d.status, 1);
  assert.equal(d.stdout, '');
  assert.equal(d.stderr, 'ci-workflow-review.js: verify-scope.json: resolves outside the checkout — not read\n');
  const dSpy = spyFs();
  const dIn = runInProcess(dc.root, ['--drift', '--json'], { fsImpl: dSpy.fsImpl });
  assert.equal(dIn.status, 1);
  assert.ok(!dSpy.calls.some((p) => p.includes(path.basename(dc.outside))), `the outside declaration was read: ${dSpy.calls.join(', ')}`);
});

test('AC10.3: a dangling symlink is unparsed (workflow) or exit 1 (declaration), never absent', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const { root: wfRoot } = fixture('workflow-dangling');
  const res = runCli(wfRoot, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).unparsed, [{ workflow: '.github/workflows/gone.yml', reason: 'dangling symlink — not read' }]);

  const { root: dRoot } = fixture('declaration-dangling');
  const d = runCli(dRoot, ['--drift', '--json']);
  assert.equal(d.status, 1);
  assert.equal(d.stdout, '');
  assert.equal(d.stderr, 'ci-workflow-review.js: verify-scope.json: dangling symlink — not read\n');
});

test('AC10.4: one fixture per case', () => {
  assert.equal(CASES.length, 6);
  const ids = CASES.map((c) => c.fixture);
  assert.equal(new Set(ids).size, ids.length, 'every case names its own fixture');
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...ids].sort(), 'FIXTURES builds exactly the fixtures CASES names');
  assert.deepEqual([...new Set(CASES.map((c) => c.ac))], ['AC10.1', 'AC10.2', 'AC10.3']);
});

test('a .github/workflows directory symlinked outside the checkout, or dangling, exits 1', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const root = tmpRoot();
  const outside = tmpRoot('cwr-outside-');
  write(outside, 'workflows/ci.yml', CLEAN);
  link(root, '.github/workflows', path.join(outside, 'workflows'));
  const a = runCli(root, ['--drift', '--json']);
  assert.equal(a.status, 1);
  assert.equal(a.stdout, '');
  assert.equal(a.stderr, 'ci-workflow-review.js: .github/workflows resolves outside the checkout — not read\n');

  const dangling = tmpRoot();
  link(dangling, '.github/workflows', path.join(dangling, 'nowhere'));
  const b = runCli(dangling, ['--drift', '--json']);
  assert.equal(b.status, 1);
  assert.equal(b.stdout, '');
  assert.equal(b.stderr, 'ci-workflow-review.js: .github/workflows: dangling symlink — not read\n');
});

test('AC6.1: the CLI prints findings: 0 on a clean set', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  const res = runCli(root, []);
  assert.equal(res.status, 0, res.stderr);
  const lines = linesOf(res.stdout);
  assert.ok(lines.includes('findings: 0'), res.stdout);
  assert.ok(!lines.some((l) => l.startsWith('| `')), res.stdout);
  assert.equal(lines[0], 'ci-workflow-review: reviewed 1 workflow(s) under .github/workflows (report-only, nothing written)');
});

test('AC7.1: the report line never reads clean while any workflow is unparsed', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/bad.yml', BAD);
  for (const args of [[], ['--drift']]) {
    const res = runCli(root, args);
    assert.equal(res.status, 0, res.stderr);
    const lines = linesOf(res.stdout);
    assert.ok(!lines.some((l) => /^findings: 0$/.test(l)), res.stdout);
    assert.equal(lines.filter((l) => /^findings: 0 — not clean: 1 workflow\(s\) unparsed$/.test(l)).length, 1, res.stdout);
  }
  const json = runCli(root, ['--json']);
  assert.equal(json.status, 0, json.stderr);
  const out = JSON.parse(json.stdout);
  assert.equal(out.unparsed[0].workflow, '.github/workflows/bad.yml');
  assert.equal(out.unparsed[0].reason, BAD_REASON);
});

test('AC9.1: every invocation leaves the fixture byte-identical', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', NO_READY);
  write(root, '.github/workflows/bad.yml', BAD);
  write(root, '.claude-tweaks/verify-scope.json', CI_DECL);
  if (!NO_SYMLINKS) {
    link(root, '.github/workflows/linked.yml', path.join('..', '..', 'shared', 'linked.yml'));
    write(root, 'shared/linked.yml', CLEAN);
  }
  for (const args of [[], ['--drift'], ['--json'], ['--drift', '--json']]) {
    const res = runCli(root, args);
    assert.equal(res.status, 0, `${args.join(' ')}: ${res.stderr}`);
  }
  const out = JSON.parse(runCli(root, ['--json']).stdout);
  assert.deepEqual(out.findings.map((f) => f.check), ['draft-skip-no-ready-for-review', 'draft-skip-with-ci-source']);
  assert.equal(out.unparsed.length, 1);
  assert.equal(out.reviewed, NO_SYMLINKS ? 2 : 3);

  // Control: a change between the two snapshots fails the same comparison.
  const control = tmpRoot();
  write(control, '.github/workflows/ci.yml', CLEAN);
  assert.throws(() => runCli(control, [], { afterSpawn: () => write(control, '.github/workflows/ci.yml', `${CLEAN}# edited\n`) }), /the CLI changed the fixture/);
  assert.throws(() => runCli(control, [], { afterSpawn: () => write(control, 'new.txt', 'x') }), /the CLI changed the fixture/);
});

test('text formats: table without --drift, one line per finding with --drift', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', NO_READY);
  write(root, '.github/workflows/track-issue-fixes.yml', generateWorkflowYaml());
  // A `|` in a cell is escaped as `\|`; a POSIX file name can carry one.
  const pipeName = process.platform === 'win32' ? null : 'x|y.yml';
  if (pipeName) write(root, `.github/workflows/${pipeName}`, BAD);

  const table = runCli(root, []);
  assert.equal(table.status, 0, table.stderr);
  assert.deepEqual(linesOf(table.stdout), [
    `ci-workflow-review: reviewed ${pipeName ? 2 : 1} workflow(s) under .github/workflows (report-only, nothing written)`,
    '| Workflow | Check | Detail | Remedy |',
    '|---|---|---|---|',
    `| \`.github/workflows/ci.yml\` | \`draft-skip-no-ready-for-review\` | ${NO_READY_DETAIL} | \`_shared/ci-skips-drafts.md\` § Workflow shape |`,
    ...(pipeName ? [`| \`.github/workflows/x\\|y.yml\` | \`unparsed\` | ${BAD_REASON} | — |`] : []),
    'skipped .github/workflows/track-issue-fixes.yml — Step 16 classifies it',
    pipeName ? 'findings: 1 — not clean: 1 workflow(s) unparsed' : 'findings: 1',
  ]);

  const drift = runCli(root, ['--drift']);
  assert.equal(drift.status, 0, drift.stderr);
  assert.deepEqual(linesOf(drift.stdout), [
    `ci-workflow-review: .github/workflows/ci.yml — draft-skip-no-ready-for-review: ${NO_READY_DETAIL} (remedy: \`_shared/ci-skips-drafts.md\` § Workflow shape)`,
    ...(pipeName ? [`ci-workflow-review: .github/workflows/${pipeName} unparsed — ${BAD_REASON}`] : []),
    pipeName ? 'findings: 1 — not clean: 1 workflow(s) unparsed' : 'findings: 1',
  ]);
});

test('usage: exit 2 for an unknown flag, a missing --root, a trailing bare --root, an empty or flag-shaped --root value, and a --root that is not a directory; --help exits 0', () => {
  const root = tmpRoot();
  const file = write(root, 'plain.txt', 'x');
  const NO_VALUE = /--root requires a directory value/;
  const NOT_DIR = /--root is not a directory/;
  const cases = [
    [['--root', root, '--bogus'], /unknown flag: --bogus/],
    [[], /--root <dir> is required/],
    [['--json'], /--root <dir> is required/],
    [['--root'], NO_VALUE],
    [['--root', ''], NO_VALUE],
    [['--root', '   '], NO_VALUE],
    [['--root', '--json'], NO_VALUE],
    [['--root', '-x'], NO_VALUE],
    [['--root', file], NOT_DIR],
    [['--root', path.join(root, 'does-not-exist')], NOT_DIR],
  ];
  const before = snapshot(root);
  for (const [args, reason] of cases) {
    const res = spawnCli(args);
    assert.equal(res.status, 2, `${JSON.stringify(args)}: ${res.stderr}`);
    assert.match(res.stderr, /usage:/, JSON.stringify(args));
    assert.match(res.stderr, reason, JSON.stringify(args));
    assert.equal(res.stdout, '', JSON.stringify(args));
  }
  for (const args of [['--help'], ['--root', root, '--help']]) {
    const res = spawnCli(args);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `${USAGE}\n`);
  }
  assertSameSnapshot(before, snapshot(root));
  assert.equal(loadCli().USAGE, USAGE);
});

test('a symlinked --root is resolved first and reviewed', { skip: NO_SYMLINKS && 'symlink fixtures are POSIX-only' }, () => {
  const real = tmpRoot();
  write(real, '.github/workflows/ci.yml', NO_READY);
  const holder = tmpRoot();
  const linked = link(holder, 'root', real);
  const res = runCli(linked, ['--drift', '--json']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).findings.map((f) => f.check), ['draft-skip-no-ready-for-review']);
});

test('an injected realpath reaches path-guard, and an unexpected deps throw is exit 1 with the message on stderr', () => {
  const root = tmpRoot();
  write(root, '.github/workflows/ci.yml', CLEAN);
  const noResolve = runInProcess(root, ['--drift', '--json'], { realpath: () => { throw Object.assign(new Error('nope'), { code: 'EIO' }); } });
  assert.equal(noResolve.status, 1);
  assert.equal(noResolve.stdout, '');
  assert.equal(noResolve.stderr, 'ci-workflow-review.js: could not resolve --root\n');

  const err = [];
  const status = loadCli().run(['--root', root, '--drift', '--json'], {
    stdout: () => { throw new Error('EPIPE: broken pipe'); },
    stderr: (s) => err.push(s),
  });
  assert.equal(status, 1);
  assert.match(err.join(''), /^ci-workflow-review\.js: EPIPE: broken pipe\n$/);
});
