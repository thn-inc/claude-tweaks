'use strict';
// tests/stash-guard.test.js -- plugin/bin/stash-guard.js (#4559): snapshot the
// repo-wide git stash stack before a dispatched agent runs, compare after, and
// optionally restore entries the agent removed. Every git call targets a temp
// repo (`git -C <dir>`), never this checkout's shared stash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitRepo } = require('./helpers/git-fixtures');
const { run, parseArgs, readStack, storeCommand, USAGE } = require('../plugin/bin/stash-guard');

// Pin identity and config for this test process: the fixture helpers, the CLI's
// real git runner and the injected runners below all inherit it.
const IDENTITY = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull,
};
Object.assign(process.env, IDENTITY);
// An inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE outranks `git -C <dir>`, which would aim the
// real `stash drop` / `clear` calls below at the checkout running this suite and its shared stash.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[name];

const roots = [];
test.after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const realGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (dir, ...args) => realGit(['-C', dir, ...args]);

let seq = 0;
function fixture() {
  const dir = gitRepo({ branch: 'main' });
  roots.push(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'add a');
  return dir;
}

// Modify the committed file and push one stash entry; returns its { sha, subject }.
function stashPush(dir, message) {
  fs.writeFileSync(path.join(dir, 'a.txt'), `change ${seq++}\n`);
  git(dir, 'stash', 'push', '-q', '-m', message);
  return stack(dir)[0];
}

function stack(dir) {
  return git(dir, 'stash', 'list', '--format=%H%x00%gs').split('\n').filter(Boolean).map((l) => {
    const [sha, subject] = l.split('\0');
    return { sha, subject };
  });
}

function invoke(dir, argv, over = {}) {
  const out = []; const err = [];
  const code = run(argv, {
    git: realGit,
    cwd: () => dir,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  });
  const text = out.join('');
  return { code, text, err: err.join(''), json: text ? JSON.parse(text) : null };
}

function snapshot(dir) {
  const file = path.join(dir, '.git', `baseline-${seq++}.json`);
  const r = invoke(dir, ['snapshot', '--repo', dir, '--out', file]);
  assert.equal(r.code, 0, r.err);
  return file;
}

const compare = (dir, baseline, extra = [], over = {}) => invoke(dir, ['compare', '--repo', dir, '--baseline', baseline, ...extra], over);

// A runner that delegates to the real one but throws for `stash store` when `trap(args)` matches.
function failingStore(trap = () => true) {
  return (args) => {
    if (args[2] === 'stash' && args[3] === 'store' && trap(args)) {
      throw Object.assign(new Error('git stash store failed'), { stderr: 'fatal: simulated store failure\n' });
    }
    return realGit(args);
  };
}

// A runner that delegates to the real one but answers `stash store` with success without
// running git: the exit-0-writes-nothing shape, whatever the stack holds.
function noopStore() {
  return (args) => (args[2] === 'stash' && args[3] === 'store' ? '' : realGit(args));
}

// A runner that delegates to the real one, but on the second `stash list` (the pre-store
// re-read) first stores `entry` itself -- a sibling guard restoring it in the race window.
// Every `stash store` call it sees is pushed to `stores`.
function racingRunner(dir, entry, stores = []) {
  let lists = 0;
  return (args) => {
    if (args[2] === 'stash' && args[3] === 'list' && ++lists === 2) {
      realGit(['-C', dir, 'stash', 'store', '-m', entry.subject, entry.sha]);
    }
    if (args[2] === 'stash' && args[3] === 'store') stores.push(args);
    return realGit(args);
  };
}

// A fake-.git anchored run dir, the shape resolveTarget accepts when mainRoot is its root
// (the pre-review-catchup suite's withRunDir).
function withRunDir() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-stashguard-run-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  return { root, runDir };
}

const decisionsOf = (runDir) => fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
const RUN_ARGS = (runDir) => ['--restore', '--run', runDir, '--task', '2'];

test('AC2.1: snapshot then compare with no stash change exits 0 with {"removed":[],"added":[]}', () => {
  const dir = fixture();
  const entry = stashPush(dir, 'keep me');
  const file = path.join(dir, '.git', 'baseline-ac21.json');
  const snap = invoke(dir, ['snapshot', '--repo', dir, '--out', file]);
  assert.equal(snap.code, 0);
  assert.equal(snap.text, `${JSON.stringify({ out: file, count: 1 })}\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [entry]);
  const r = compare(dir, file);
  assert.equal(r.code, 0);
  assert.equal(r.text, '{"removed":[],"added":[]}\n');
});

test('AC3.1: a git stash drop between snapshot and compare --restore exits 3, reports the sha, and restores the entry with its subject', () => {
  const dir = fixture();
  stashPush(dir, 'older');
  const dropped = stashPush(dir, 'newer');
  const kept = stack(dir)[1];
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  assert.equal(stack(dir).some((e) => e.sha === dropped.sha), false);
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [dropped]);
  assert.deepEqual(r.json.restored, [dropped.sha]);
  assert.deepEqual(r.json.added, []);
  assert.deepEqual(stack(dir), [dropped, kept]);
});

test('AC3.1: dropping stash@{1} (an entry under a surviving newer one) is detected and restored; the restored entry lands on top', () => {
  const dir = fixture();
  const oldest = stashPush(dir, 'oldest');
  const middle = stashPush(dir, 'middle');
  const newest = stashPush(dir, 'newest');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{1}');
  assert.deepEqual(stack(dir), [newest, oldest]);
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [middle]);
  assert.deepEqual(r.json.restored, [middle.sha]);
  // Presence only: `git stash store` always lands on stash@{0}, so the restored entry's position differs by design.
  const after = stack(dir);
  assert.equal(after.length, 3);
  for (const e of [oldest, middle, newest]) assert.ok(after.some((a) => a.sha === e.sha && a.subject === e.subject), e.subject);
  assert.deepEqual(after[0], middle);
});

// A stack holding the same sha twice, [x, y, x] newest first: `git stash store` of the
// entry already on top is a no-op, so the copies must be separated by another entry.
function doubledStack(dir) {
  const x = stashPush(dir, 'twice');
  const y = stashPush(dir, 'between');
  git(dir, 'stash', 'store', '-m', x.subject, x.sha);
  assert.deepEqual(stack(dir), [x, y, x]);
  return { x, y };
}

test('a sha stored twice: dropping one copy is detected and restored', () => {
  const dir = fixture();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  assert.deepEqual(stack(dir), [y, x]);
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [x]);
  assert.deepEqual(r.json.restored, [x.sha]);
  assert.deepEqual(r.json.added, []);
  assert.deepEqual(stack(dir), [x, y, x]);
});

test('a sha stored twice: dropping one copy without --restore is detected and stores nothing', () => {
  const dir = fixture();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [x]);
  assert.deepEqual(r.json.added, []);
  assert.deepEqual(stack(dir), [y, x]);
});

test('a sha stored twice: adding a second copy is reported as added', () => {
  const dir = fixture();
  const x = stashPush(dir, 'once');
  const y = stashPush(dir, 'between');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'store', '-m', x.subject, x.sha);
  const r = compare(dir, baseline);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.added, [x]);
  assert.deepEqual(r.json.removed, []);
  assert.deepEqual(stack(dir), [x, y, x]);
});

test('a sha stored twice: clearing the stack restores every removed copy, each with its own outcome', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  const r = compare(dir, baseline, RUN_ARGS(runDir), { mainRoot: root, cwd: () => root });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [x, y, x]);
  assert.deepEqual(r.json.restored, [x.sha, y.sha, x.sha]);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.deepEqual(r.json.restoreFailed, []);
  assert.deepEqual(stack(dir), [x, y, x]);
  const line = decisionsOf(runDir).split('\n').find((l) => l.startsWith('- '));
  assert.ok(line.includes(`removed stash entries ${x.sha} ${x.subject}, ${y.sha} ${y.subject}, ${x.sha} ${x.subject}; restored via git stash store.`), line);
});

test('a sha stored twice: one failed store and two successes report one outcome per removed copy', () => {
  const dir = fixture();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  let stores = 0;
  // Oldest first: the first store (the older copy of x) fails; y and the newer x succeed.
  const r = compare(dir, baseline, ['--restore'], { git: failingStore(() => ++stores === 1) });
  assert.equal(r.code, 3);
  assert.equal(r.json.removed.length, 3);
  assert.deepEqual(r.json.restored, [x.sha, y.sha]);
  assert.equal(r.json.restoreFailed.length, 1);
  assert.equal(r.json.restoreFailed[0].sha, x.sha);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.deepEqual(stack(dir), [x, y]);
});

test('a sha stored twice: a sibling restoring the older copy first leaves one alreadyPresent and the rest stored', () => {
  const dir = fixture();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  const stores = [];
  const r = compare(dir, baseline, ['--restore'], { git: racingRunner(dir, x, stores) });
  assert.equal(r.code, 3);
  assert.equal(r.json.removed.length, 3);
  assert.deepEqual(r.json.alreadyPresent, [x.sha]);
  assert.deepEqual(r.json.restored, [x.sha, y.sha]);
  assert.equal(stores.length, 2);
  assert.deepEqual(stack(dir), [x, y, x]);
});

const NOTHING_TO_RECOVER = /same commit still at stash@\{0\}; nothing to recover/;

test('AC1.1: stack [x, y, x] with stash@{2} dropped, then compare --restore: reported as a failed restore with no recover command (probe A)', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{2}');
  assert.deepEqual(stack(dir), [x, y]);
  const r = compare(dir, baseline, RUN_ARGS(runDir), { mainRoot: root, cwd: () => root });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [x]);
  assert.deepEqual(r.json.restored, []);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.equal(r.json.restoreFailed.length, 1);
  const failed = r.json.restoreFailed[0];
  assert.equal(failed.sha, x.sha);
  assert.equal(failed.subject, x.subject);
  assert.equal(failed.error, 'same commit still at stash@{0}; nothing to recover');
  assert.ok('command' in failed);
  assert.equal(failed.command, null);
  assert.equal(r.err, `stash-guard.js: restore failed for ${x.sha}: same commit still at stash@{0}; nothing to recover\n`);
  assert.doesNotMatch(r.err, /recover with/);
  assert.deepEqual(stack(dir), [x, y]);
  const text = decisionsOf(runDir);
  assert.equal(r.json.logged, true);
  assert.doesNotMatch(text, /restored via git stash store/);
  assert.doesNotMatch(text, /recover with/);
  const failedLine = text.split('\n').find((l) => l.startsWith('- FAILED '));
  assert.match(failedLine, /^- FAILED \d{2}:\d{2}:\d{2} — Stash guard: implementer for task 2 removed stash entry [0-9a-f]{40} On main: twice; restore failed: same commit still at stash@\{0\}; nothing to recover\. Reversibility: n\/a \(write did not land\)\.$/);
});

test('a store that writes nothing: probe B (two newer entries dropped) restores what it can and reports the rest as failed', () => {
  const dir = fixture();
  const { x, y } = doubledStack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  git(dir, 'stash', 'drop', 'stash@{0}');
  assert.deepEqual(stack(dir), [x]);
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.equal(r.json.removed.length, 2);
  assert.deepEqual(r.json.restored, [y.sha]);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.equal(r.json.restoreFailed.length, 1);
  assert.equal(r.json.restoreFailed[0].sha, x.sha);
  assert.match(r.json.restoreFailed[0].error, NOTHING_TO_RECOVER);
  assert.equal(r.json.restoreFailed[0].command, null);
  assert.doesNotMatch(r.err, /recover with/);
  // Only the real write landed: y went on top of the surviving x.
  assert.deepEqual(stack(dir), [y, x]);
});

test('a store that exits 0 but leaves a different sha at stash@{0} keeps its recover command (sibling drop race)', () => {
  const dir = fixture();
  const older = stashPush(dir, 'older');
  const newer = stashPush(dir, 'newer');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{1}');
  assert.deepEqual(stack(dir), [newer]);
  const r = compare(dir, baseline, ['--restore'], { git: noopStore() });
  assert.equal(r.code, 3);
  assert.equal(r.json.restoreFailed.length, 1);
  assert.equal(r.json.restoreFailed[0].sha, older.sha);
  assert.equal(r.json.restoreFailed[0].error, 'git stash store exited 0 but the entry is not back on the stack');
  assert.equal(r.json.restoreFailed[0].command, storeCommand(older.subject, older.sha));
  assert.match(r.err, new RegExp(`restore failed for ${older.sha}; recover with:`));
});

test('AC3.2: without --restore the stack is left unchanged', () => {
  const dir = fixture();
  stashPush(dir, 'one');
  const dropped = stashPush(dir, 'two');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const before = stack(dir);
  const r = compare(dir, baseline);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [dropped]);
  assert.deepEqual(stack(dir), before);
  assert.equal(stack(dir).some((e) => e.sha === dropped.sha), false);
  assert.equal('restored' in r.json, false);
  assert.equal('restoreFailed' in r.json, false);
});

test('AC4.1: a forced restore failure reports restoreFailed and prints a git stash store line', () => {
  const dir = fixture();
  const dropped = stashPush(dir, 'doomed');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline, ['--restore'], { git: failingStore() });
  assert.equal(r.code, 3);
  assert.equal(r.json.restoreFailed.length, 1);
  assert.equal(r.json.restoreFailed[0].sha, dropped.sha);
  assert.equal(r.json.restoreFailed[0].subject, dropped.subject);
  assert.match(r.json.restoreFailed[0].error, /simulated store failure/);
  assert.equal(r.json.restoreFailed[0].command, storeCommand(dropped.subject, dropped.sha));
  assert.deepEqual(r.json.restored, []);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.match(r.err, /^git stash store -m ".*" [0-9a-f]{40}$/m);
  assert.match(r.err, new RegExp(`restore failed for ${dropped.sha}; recover with:`));
  assert.equal(stack(dir).length, 0);
});

test('AC5.1: a subject with spaces, a colon and a quote round-trips through snapshot and compare --restore', () => {
  const dir = fixture();
  const message = 'it\'s "quoted": a $x `y` test';
  const entry = stashPush(dir, message);
  assert.equal(entry.subject, `On main: ${message}`);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.restored, [entry.sha]);
  assert.deepEqual(stack(dir), [entry]);
  assert.equal(stack(dir)[0].subject, entry.subject);
  assert.equal(
    storeCommand(entry.subject, entry.sha),
    `git stash store -m "On main: it's \\"quoted\\": a \\$x \\\`y\\\` test" ${entry.sha}`,
  );
});

test('added entries are reported and never popped', () => {
  const dir = fixture();
  stashPush(dir, 'original');
  const baseline = snapshot(dir);
  const added = stashPush(dir, 'agent made this');
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.added, [added]);
  assert.deepEqual(r.json.removed, []);
  assert.deepEqual(r.json.restored, []);
  assert.equal(stack(dir)[0].sha, added.sha);
  assert.equal(stack(dir).length, 2);
});

test('a removed entry already back on the stack before its store is reported under alreadyPresent and not stored twice', () => {
  const dir = fixture();
  const entry = stashPush(dir, 'raced');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const stores = [];
  const r = compare(dir, baseline, ['--restore'], { git: racingRunner(dir, entry, stores) });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, [entry]);
  assert.deepEqual(r.json.alreadyPresent, [entry.sha]);
  assert.deepEqual(r.json.restored, []);
  assert.deepEqual(r.json.restoreFailed, []);
  assert.deepEqual(stores, []);
  assert.equal(stack(dir).filter((e) => e.sha === entry.sha).length, 1);
});

test('several removed entries are all restored in their original order', () => {
  const dir = fixture();
  stashPush(dir, 'one');
  stashPush(dir, 'two');
  stashPush(dir, 'three');
  const order = stack(dir);
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  assert.equal(stack(dir).length, 0);
  const r = compare(dir, baseline, ['--restore']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.removed, order);
  assert.deepEqual(r.json.restored, order.map((e) => e.sha));
  assert.deepEqual(stack(dir), order);
});

test('an unreadable, unparseable, null, or non-sha baseline exits 2 and stores nothing', () => {
  const dir = fixture();
  stashPush(dir, 'present');
  const good = { sha: 'a'.repeat(40), subject: 'On main: x' };
  const cases = {
    missing: null,
    unparseable: '{not json',
    null: 'null',
    'not an array': '{"sha":"x"}',
    'non-sha': JSON.stringify([{ sha: 'zzzz', subject: 'On main: x' }]),
    'short sha': JSON.stringify([{ sha: 'abc123', subject: 'On main: x' }]),
    'upper-case sha': JSON.stringify([{ sha: 'A'.repeat(40), subject: 'On main: x' }]),
    'missing subject': JSON.stringify([good, { sha: 'b'.repeat(40) }]),
    'non-string subject': JSON.stringify([{ sha: 'b'.repeat(40), subject: 7 }]),
    'null element': JSON.stringify([good, null]),
  };
  for (const [name, content] of Object.entries(cases)) {
    const file = path.join(dir, '.git', `bad-${seq++}.json`);
    if (content !== null) fs.writeFileSync(file, content);
    const calls = [];
    const trap = (args) => { calls.push(args); if (args[3] === 'store') throw new Error('store must not be reached'); return realGit(args); };
    const r = compare(dir, file, ['--restore'], { git: trap });
    assert.equal(r.code, 2, name);
    assert.equal(r.text, '', name);
    assert.match(r.err, /stash-guard\.js: /, name);
    assert.equal(calls.some((a) => a[3] === 'store'), false, name);
  }
});

test('usage errors exit 2', () => {
  const dir = fixture();
  const b = path.join(dir, 'b.json');
  const r1 = path.join(dir, 'run');
  const base = ['compare', '--repo', dir, '--baseline', b];
  const cases = [
    [],
    ['bogus'],
    ['snapshot'],
    ['snapshot', '--repo'],
    ['snapshot', '--repo', dir],
    ['snapshot', '--repo', dir, '--out'],
    ['snapshot', '--repo', dir, '--out', b, '--restore'],
    ['snapshot', '--repo', dir, '--out', b, '--baseline', b],
    ['compare', '--repo', dir],
    ['compare', '--baseline', b],
    ['compare', '--repo', dir, '--baseline', b, '--out', b],
    ['compare', '--baseline', b, '--repo'],
    [...base, '--bogus'],
    [...base, '--restore', '--run', r1],
    [...base, '--restore', '--run', r1, '--task', '0'],
    [...base, '--restore', '--run', r1, '--task', '-1'],
    [...base, '--restore', '--run', r1, '--task', '1.5'],
    [...base, '--restore', '--run', r1, '--task', 'two'],
    [...base, '--restore', '--run', r1, '--label', 'Fix_Wave'],
    [...base, '--restore', '--run', r1, '--label', 'fix--wave'],
    [...base, '--restore', '--run', r1, '--label', '-fix'],
    [...base, '--restore', '--run', r1, '--label'],
    [...base, '--restore', '--run', r1, '--task'],
    [...base, '--restore', '--run'],
    [...base, '--restore', '--label', 'fix-wave'],
    [...base, '--restore', '--task', '2'],
    [...base, '--run', r1, '--task', '2'],
    [...base, '--run', r1, '--label', 'fix-wave'],
  ];
  for (const argv of cases) {
    const calls = [];
    const r = invoke(dir, argv, { git: (a) => { calls.push(a); return ''; } });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /usage: stash-guard\.js/, JSON.stringify(argv));
    assert.equal(r.text, '', JSON.stringify(argv));
    assert.deepEqual(calls, [], JSON.stringify(argv));
  }
});

test('--help prints the usage and exits 0 without git', () => {
  const calls = [];
  const out = [];
  const code = run(['--help'], { git: (a) => { calls.push(a); return ''; }, stdout: (s) => out.push(s), stderr: () => {} });
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.equal(out.join(''), USAGE);
});

test('parseArgs accepts the documented flag combinations', () => {
  assert.deepEqual(
    parseArgs(['compare', '--repo', '/r', '--baseline', '/b', '--restore', '--run', '/run', '--task', '3', '--label', 'fix-wave']),
    { verb: 'compare', repo: '/r', out: null, baseline: '/b', restore: true, run: '/run', task: 3, label: 'fix-wave', help: false },
  );
  assert.deepEqual(
    parseArgs(['snapshot', '--repo', '/r', '--out', '/o']),
    { verb: 'snapshot', repo: '/r', out: '/o', baseline: null, restore: false, run: null, task: null, label: null, help: false },
  );
  // A flag name that is an inherited object key is unknown, not a value flag.
  assert.ok(parseArgs(['snapshot', 'constructor']).error);
  assert.ok(parseArgs(['snapshot', '--constructor', 'x']).error);
});

test('git and write failures exit 2', () => {
  const dir = fixture();
  const boom = () => { throw new Error('fatal: not a git repository'); };
  const file = path.join(dir, '.git', 'baseline-fail.json');
  const snap = invoke(dir, ['snapshot', '--repo', dir, '--out', file], { git: boom });
  assert.equal(snap.code, 2);
  assert.match(snap.err, /not a git repository/);
  assert.equal(snap.text, '');

  const unwritable = invoke(dir, ['snapshot', '--repo', dir, '--out', path.join(dir, '.git')]);
  assert.equal(unwritable.code, 2);
  assert.equal(unwritable.text, '');

  const baseline = snapshot(dir);
  const cmp = compare(dir, baseline, [], { git: boom });
  assert.equal(cmp.code, 2);
  assert.equal(cmp.text, '');
});

test('readStack parses a NUL-separated list and rejects a line without a separator', () => {
  assert.deepEqual(readStack(() => `${'a'.repeat(40)}\0On main: x\n\n${'b'.repeat(40)}\0WIP on main: y: z\n`, '/r'), [
    { sha: 'a'.repeat(40), subject: 'On main: x' },
    { sha: 'b'.repeat(40), subject: 'WIP on main: y: z' },
  ]);
  assert.deepEqual(readStack(() => '', '/r'), []);
  assert.throws(() => readStack(() => `${'a'.repeat(40)} On main: x\n`, '/r'), /unparseable/);
  const seen = [];
  readStack((args) => { seen.push(args); return ''; }, '/some repo');
  assert.deepEqual(seen, [['-C', '/some repo', 'stash', 'list', '--no-show-signature', '--format=%H%x00%gs']]);
});

test('the real default git runner reads the stack', () => {
  const dir = fixture();
  const entry = stashPush(dir, 'via default runner');
  const file = path.join(dir, '.git', 'baseline-default.json');
  const out = []; const err = [];
  const io = { stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
  assert.equal(run(['snapshot', '--repo', dir, '--out', file], io), 0, err.join(''));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [entry]);
  out.length = 0;
  assert.equal(run(['compare', '--repo', dir, '--baseline', file], io), 0, err.join(''));
  assert.equal(out.join(''), '{"removed":[],"added":[]}\n');
});

test('AC11.2: --label alone and --task with --label name the dispatch in the decisions.md line', () => {
  for (const [args, who] of [
    [['--label', 'fix-wave'], 'fix-wave dispatch'],
    [['--task', '2', '--label', 'review'], 'review dispatch for task 2'],
    [['--task', '5'], 'implementer for task 5'],
  ]) {
    const dir = fixture();
    const { root, runDir } = withRunDir();
    const entry = stashPush(dir, 'named');
    const baseline = snapshot(dir);
    git(dir, 'stash', 'drop', 'stash@{0}');
    const r = compare(dir, baseline, ['--restore', '--run', runDir, ...args], { mainRoot: root, cwd: () => root });
    assert.equal(r.code, 3, who);
    assert.equal(r.json.logged, true, who);
    assert.deepEqual(stack(dir), [entry], who);
    assert.ok(decisionsOf(runDir).includes(`— Stash guard: ${who} removed stash entry ${entry.sha} ${entry.subject}; restored via git stash store. Reversibility: high.`), `${who}: ${decisionsOf(runDir)}`);
  }
});

test('with --run, the AUTO and FAILED lines land in decisions.md under /build', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  const first = stashPush(dir, 'will fail');
  const second = stashPush(dir, 'will restore');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  const r = compare(dir, baseline, RUN_ARGS(runDir), {
    mainRoot: root,
    cwd: () => root,
    git: failingStore((args) => args[args.length - 1] === first.sha),
    now: () => Date.UTC(2026, 9, 31, 8, 9, 10),
  });
  assert.equal(r.code, 3);
  assert.equal(r.json.logged, true);
  assert.equal('logError' in r.json, false);
  assert.deepEqual(r.json.restored, [second.sha]);
  assert.equal(r.json.restoreFailed.length, 1);
  const text = decisionsOf(runDir);
  assert.ok(text.indexOf('## /build') !== -1, text);
  const lines = text.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 2, text);
  assert.ok(text.indexOf('## /build') < text.indexOf(lines[0]));
  assert.equal(
    lines[0].replace(/\d{2}:\d{2}:\d{2}/, 'T'),
    `- AUTO T — Stash guard: implementer for task 2 removed stash entry ${second.sha} ${second.subject}; restored via git stash store. Reversibility: high.`,
  );
  assert.match(lines[1], /^- FAILED \d{2}:\d{2}:\d{2} — Stash guard: implementer for task 2 removed stash entry [0-9a-f]{40} On main: will fail; restore failed: fatal: simulated store failure — recover with: git stash store -m "On main: will fail" [0-9a-f]{40}\. Reversibility: n\/a \(write did not land\)\.$/);
  assert.ok(lines[1].includes(` ${first.sha} `));
  assert.ok(lines[1].includes(`recover with: ${storeCommand(first.subject, first.sha)}.`));
});

test('with --run, an alreadyPresent entry and an added entry each get their detection line', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  const gone = stashPush(dir, 'raced away');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const extra = stashPush(dir, 'new from agent');
  const r = compare(dir, baseline, RUN_ARGS(runDir), { mainRoot: root, cwd: () => root, git: racingRunner(dir, gone) });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.alreadyPresent, [gone.sha]);
  assert.deepEqual(r.json.added, [extra]);
  const lines = decisionsOf(runDir).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/\d{2}:\d{2}:\d{2}/, 'T'));
  assert.deepEqual(lines, [
    `- AUTO T — Stash guard: implementer for task 2 removed stash entry ${gone.sha} ${gone.subject}; already back on the stack before restore, not stored again. Reversibility: n/a (a detection, not a mutation).`,
    `- AUTO T — Stash guard: implementer for task 2 added stash entry ${extra.sha} ${extra.subject}; left on the stack, never popped automatically. Reversibility: n/a (a detection, not a mutation).`,
  ]);
});

test('several entries are listed in one plural line', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  const a = stashPush(dir, 'a');
  const b = stashPush(dir, 'b');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'clear');
  compare(dir, baseline, RUN_ARGS(runDir), { mainRoot: root, cwd: () => root });
  const line = decisionsOf(runDir).split('\n').find((l) => l.startsWith('- '));
  assert.ok(line.includes(`removed stash entries ${b.sha} ${b.subject}, ${a.sha} ${a.subject}; restored via git stash store.`), line);
});

test('with --run and nothing changed, exit 0 and no line is written', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  stashPush(dir, 'steady');
  const baseline = snapshot(dir);
  const r = compare(dir, baseline, RUN_ARGS(runDir), { mainRoot: root, cwd: () => root });
  assert.equal(r.code, 0);
  // No append was attempted, so neither logged nor logError is reported.
  assert.equal('logged' in r.json, false);
  assert.equal('logError' in r.json, false);
  assert.deepEqual(r.json.restored, []);
  assert.equal(decisionsOf(runDir), '');
});

test('an unanchored --run still restores, keeps exit 3, and reports logged:false', () => {
  const dir = fixture();
  const { root } = withRunDir();
  const stray = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-stashguard-stray-')));
  roots.push(stray);
  fs.writeFileSync(path.join(stray, 'decisions.md'), 'shadow\n');
  const entry = stashPush(dir, 'unanchored');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline, ['--restore', '--run', stray, '--task', '2'], { mainRoot: root, cwd: () => root });
  assert.equal(r.code, 3);
  assert.deepEqual(stack(dir), [entry]);
  assert.deepEqual(r.json.restored, [entry.sha]);
  assert.equal(r.json.logged, false);
  assert.equal(typeof r.json.logError, 'string');
  assert.match(r.json.logError, /not anchored/);
  assert.match(r.err, /decisions\.md/);
  assert.match(r.err, /stash-guard\.js: could not append the decisions\.md entry: /);
  assert.equal(fs.readFileSync(path.join(stray, 'decisions.md'), 'utf8'), 'shadow\n');
});

test('a missing --run dir and a throwing append keep the exit code and report logError', () => {
  const dir = fixture();
  const { root, runDir } = withRunDir();
  stashPush(dir, 'one');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const missing = compare(dir, baseline, ['--restore', '--run', path.join(root, 'no-such-run'), '--label', 'x'], { mainRoot: root, cwd: () => root });
  assert.equal(missing.code, 3);
  assert.equal(missing.json.logged, false);
  assert.match(missing.json.logError, /does not exist/);

  git(dir, 'stash', 'clear');
  const throwing = compare(dir, baseline, RUN_ARGS(runDir), {
    mainRoot: root,
    cwd: () => root,
    appendEntries: () => { throw new Error('disk full'); },
  });
  assert.equal(throwing.code, 3);
  assert.equal(throwing.json.logged, false);
  assert.equal(throwing.json.logError, 'disk full');
  assert.match(throwing.err, /could not append the decisions\.md entry: disk full/);
  assert.equal(stack(dir).length, 1);
});

// A runner that delegates to the real one but throws for the nth `stash list` call(s) it sees.
// For one removed entry the CLI lists three times: compare's read, the pre-store re-read, and
// the post-store confirmation.
function failingList(...nths) {
  let lists = 0;
  return (args) => {
    if (args[2] === 'stash' && args[3] === 'list' && nths.includes(++lists)) {
      throw Object.assign(new Error('git stash list failed'), { stderr: 'fatal: simulated list failure\n' });
    }
    return realGit(args);
  };
}

test('a failed pre-store re-read falls through to the store and still restores the entry', () => {
  const dir = fixture();
  const entry = stashPush(dir, 'one');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline, ['--restore'], { git: failingList(2) });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.restored, [entry.sha]);
  assert.deepEqual(r.json.alreadyPresent, []);
  assert.deepEqual(r.json.restoreFailed, []);
  assert.deepEqual(stack(dir), [entry]);
});

test('a failed post-store re-read trusts the exit code and reports the entry restored', () => {
  const dir = fixture();
  const entry = stashPush(dir, 'one');
  const baseline = snapshot(dir);
  git(dir, 'stash', 'drop', 'stash@{0}');
  const r = compare(dir, baseline, ['--restore'], { git: failingList(3) });
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.restored, [entry.sha]);
  assert.deepEqual(r.json.restoreFailed, []);
  assert.deepEqual(stack(dir), [entry]);
});
