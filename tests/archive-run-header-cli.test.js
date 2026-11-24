'use strict';
// plugin/bin/archive-run-header.js (#3976): wrap-up's pre-merge header move as a self-logging CLI.
// Every case drives the real CLI against a real git fixture: a main repo with a harness worktree
// carrying the committed header, the run dir under the main checkout holding a run-state.json written
// through the real writer. The move itself is covered by tests/run-header-archive.test.js; these
// cases pin the CLI's own contract: run-dir anchoring, run/spec identity, worktree resolution, the
// decisions.md trail, the envelope and the exit codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { gitRepo, harnessWorktreeOf, fixtureGit, cleanGitEnv, hookEnv } = require('./helpers/git-fixtures');
const { writeRunState } = require('../plugin/bin/lib/hooks/context');
const { ARGS_ERROR_CODE } = require('../plugin/bin/lib/run-header-archive');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'archive-run-header.js');
const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const RUN = '2026-11-16T000000-record-7';
const PIPELINES = path.join('.claude-tweaks', 'pipelines');
const LIVE = `.claude-tweaks/pipelines/${RUN}`;
const ARCH = `.claude-tweaks/pipelines/archive/${RUN}`;

// Hermetic: no machine-wide hooks path, signing or identity leaks in; the identity is the env's own.
const ENV = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

const roots = [];
test.after(() => { for (const d of roots) fs.rmSync(d, { recursive: true, force: true }); });

// A main checkout with one harness worktree (`wt`) and the run dir under the main checkout.
function makeFixture({ runState = {} } = {}) {
  const main = gitRepo({ branch: 'main' });
  roots.push(main);
  const wt = harnessWorktreeOf(main);
  const git = (dir, ...args) => fixtureGit(['-C', dir, ...args], { env: ENV, encoding: 'utf8' }).trim();
  const pipelines = path.join(main, PIPELINES);
  const runDir = path.join(pipelines, RUN);
  fs.mkdirSync(runDir, { recursive: true });
  if (runState !== null) writeRunState(runDir, { status: 'active', worktree: wt, ...runState });
  const write = (root, rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  // Commits `rel` in the worktree (force-added: the repo's real .gitignore ignores most of a run dir).
  const header = (rel, content = 'spec\n') => {
    write(wt, rel, content);
    git(wt, 'add', '-f', rel);
    git(wt, 'commit', '-q', '-m', `header ${rel}`);
  };
  const decisionsFile = path.join(runDir, 'decisions.md');
  return {
    main, wt, runDir, pipelines, git, write, header, decisionsFile,
    head: () => git(wt, 'rev-parse', 'HEAD'),
    tree: (prefix) => git(wt, 'ls-tree', '-r', '--name-only', 'HEAD', prefix).split('\n').filter(Boolean),
    decisions: () => (fs.existsSync(decisionsFile) ? fs.readFileSync(decisionsFile, 'utf8') : ''),
    entries: (text) => text.split('\n').filter((l) => l.startsWith('- ')),
  };
}

// In-process, with the main checkout as the injected cwd (never the test process's own).
const cli = (f, argv, opts = {}) => runCliSync(CLI, argv, { env: ENV, cwd: f.main, ...opts });
const envelope = (res) => {
  const lines = res.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `exactly one stdout line, got: ${res.stdout}`);
  return JSON.parse(lines[0]);
};

test('moves, prints the envelope and logs one AUTO line', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'moved');
  assert.equal(env.logged, true);
  assert.equal(env.commit, f.head());
  assert.deepEqual(env.moved, [`${LIVE}/work/7-spec.md`]);
  assert.equal(env.push, undefined, 'the CLI never pushes, so the envelope has no push field');
  assert.deepEqual(f.tree(`${LIVE}/`), []);
  assert.deepEqual(f.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
  const text = f.decisions();
  assert.match(text, /^## \/wrap-up$/m, 'the default section');
  const lines = f.entries(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- AUTO \d\d:\d\d:\d\d — Archive spec header: moved 1 file\(s\) to archive\/2026-11-16T000000-record-7\/ in [0-9a-f]{7}/);
  assert.ok(lines[0].includes(`in ${env.commit.slice(0, 7)}`), 'the entry names the commit the envelope reports');
  assert.match(lines[0], /Reversibility: high \(git revert\)\.$/);
});

test('--section puts the entry under the named heading', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  const res = cli(f, ['--run', f.runDir, '--section', '/build']);
  assert.equal(res.code, 0, res.stderr);
  const text = f.decisions();
  assert.match(text, /^## \/build\n- AUTO /m);
  assert.doesNotMatch(text, /^## \/wrap-up$/m);
});

test('a second call is a no-op and logs nothing', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  assert.equal(envelope(cli(f, ['--run', f.runDir])).outcome, 'moved');
  const before = fs.readFileSync(f.decisionsFile);
  const head = f.head();

  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'noop');
  assert.equal(env.logged, true, 'a noop owes no line, so every owed line is logged');
  assert.deepEqual(env.moved, []);
  assert.equal(f.head(), head, 'no new commit');
  assert.deepEqual(fs.readFileSync(f.decisionsFile), before, 'decisions.md byte-unchanged');
});

test('a refusal logs one SKIP line naming the fallback', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`, 'live bytes\n');
  f.header(`${ARCH}/work/7-spec.md`, 'different archived bytes\n');
  const head = f.head();

  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'refused');
  assert.equal(env.reason, 'archived-copy-differs');
  assert.equal(env.logged, true);
  assert.equal(f.head(), head, 'a refusal makes no commit');
  const lines = f.entries(f.decisions());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- SKIP .* — Archive spec header: condition: archived-copy-differs .*→ fallback: header left live; reconcile's archiveRunDir archives it after the merge/);
});

test('no worktree recorded refuses with no-worktree', () => {
  const f = makeFixture({ runState: { worktree: null } });
  f.header(`${LIVE}/work/7-spec.md`);
  const head = f.head();

  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'refused');
  assert.equal(env.reason, 'no-worktree');
  assert.equal(f.head(), head);
  const lines = f.entries(f.decisions());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- SKIP .* — Archive spec header: condition: no-worktree .*→ fallback: header left live/);
});

test('a worktree equal to the main checkout refuses with not-a-linked-worktree', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  const head = f.head();

  const res = cli(f, ['--run', f.runDir, '--worktree', f.main]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'refused');
  assert.equal(env.reason, 'not-a-linked-worktree');
  assert.equal(f.head(), head);
  assert.equal(f.entries(f.decisions()).length, 1);
});

test('a recorded worktree that is the main checkout refuses the same way', () => {
  const f = makeFixture({ runState: {} });
  writeRunState(f.runDir, { worktree: f.main });
  f.header(`${LIVE}/work/7-spec.md`);
  const env = envelope(cli(f, ['--run', f.runDir]));
  assert.equal(env.reason, 'not-a-linked-worktree');
});

test('a *-partial-revert refusal logs a SKIP that sends the reader to git status, not the "header left live" fallback', () => {
  const f = makeFixture();
  const archiveRunHeader = () => ({ outcome: 'refused', reason: 'git-mv-failed-partial-revert', detail: 'mv back failed', moved: [] });

  const res = cli(f, ['--run', f.runDir], { deps: { archiveRunHeader } });

  assert.equal(res.code, 0, res.stderr);
  assert.equal(envelope(res).reason, 'git-mv-failed-partial-revert');
  const lines = f.entries(f.decisions());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- SKIP .* — Archive spec header: condition: git-mv-failed-partial-revert \(mv back failed\) → the unwind did not finish: .*check git status/);
  assert.doesNotMatch(lines[0], /header left live/, 'a failed unwind is not a clean refusal');
});

test('--worktree overrides run-state; worktreeAtClose is the fallback after close-run', () => {
  const f = makeFixture({ runState: {} });
  f.header(`${LIVE}/work/7-spec.md`);
  // run-state names the main checkout; the override wins and the move lands in the linked worktree.
  writeRunState(f.runDir, { worktree: f.main });
  const override = cli(f, ['--run', f.runDir, '--worktree', f.wt]);
  assert.equal(override.code, 0, override.stderr);
  assert.equal(envelope(override).outcome, 'moved');
  assert.deepEqual(f.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);

  // A fresh run closed through the real verb: `worktree` is null, `worktreeAtClose` carries the path.
  const g = makeFixture();
  g.header(`${LIVE}/work/7-spec.md`);
  const closed = spawnCli(HOOKS, ['close-run', '--run', g.runDir], { env: hookEnv(), cwd: g.main });
  assert.equal(closed.code, 0, closed.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(g.runDir, 'run-state.json'), 'utf8'));
  assert.equal(state.worktree, null);
  assert.equal(state.worktreeAtClose, g.wt);
  const res = cli(g, ['--run', g.runDir]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(envelope(res).outcome, 'moved');
  assert.deepEqual(g.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
});

test('a spec-{N} run dir moves only its own header; an archived run dir resolves the top-level run id', () => {
  const f = makeFixture();
  f.header(`${LIVE}/spec-8/work/8-spec.md`, 'eight\n');
  f.header(`${LIVE}/spec-9/work/9-spec.md`, 'nine\n');
  const specDir = path.join(f.runDir, 'spec-8');
  fs.mkdirSync(specDir);

  const res = cli(f, ['--run', specDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'moved');
  assert.deepEqual(env.moved, [`${LIVE}/spec-8/work/8-spec.md`]);
  assert.deepEqual(f.tree(`${LIVE}/`), [`${LIVE}/spec-9/work/9-spec.md`], 'spec-9 stays live');
  assert.deepEqual(f.tree(`${ARCH}/`), [`${ARCH}/spec-8/work/8-spec.md`]);
  assert.equal(f.entries(fs.readFileSync(path.join(specDir, 'decisions.md'), 'utf8')).length, 1, 'logged under the per-spec run dir');

  // An archive/{run-id} dir (what reconcile leaves after a close): the run id is the segment after archive/.
  const g = makeFixture({ runState: null });
  g.header(`${LIVE}/work/7-spec.md`);
  const archivedDir = path.join(g.pipelines, 'archive', RUN);
  fs.mkdirSync(archivedDir, { recursive: true });
  writeRunState(archivedDir, { status: 'clean', worktree: null, worktreeAtClose: g.wt });
  const again = cli(g, ['--run', archivedDir]);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(envelope(again).outcome, 'moved');
  assert.deepEqual(g.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
  assert.equal(g.entries(fs.readFileSync(path.join(archivedDir, 'decisions.md'), 'utf8')).length, 1);
});

test('a parent --run moves the flat and every spec-{N} header in one commit', () => {
  const f = makeFixture();
  const headers = [`${LIVE}/work/7-spec.md`, `${LIVE}/spec-8/work/8-spec.md`, `${LIVE}/spec-9/work/9-spec.md`];
  for (const rel of headers) f.header(rel);
  const before = Number(f.git(f.wt, 'rev-list', '--count', 'HEAD'));

  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, res.stderr);
  const env = envelope(res);
  assert.equal(env.outcome, 'moved');
  assert.deepEqual([...env.moved].sort(), [...headers].sort());
  assert.equal(Number(f.git(f.wt, 'rev-list', '--count', 'HEAD')), before + 1, 'exactly one move commit');
  assert.deepEqual(f.tree('.claude-tweaks').sort(), headers.map((rel) => rel.replace(LIVE, ARCH)).sort(), 'every header is under archive/, none live');
  assert.deepEqual(f.tree(`${LIVE}/`), []);
  assert.match(f.entries(f.decisions())[0], /moved 3 file\(s\) to archive\//);
});

test('the move commit runs with the injected env', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  // A value this process does not carry: only the injected env can put it on the commit.
  assert.notEqual(process.env.GIT_AUTHOR_NAME, 'ArchiveCliEnvProbe');

  const res = cli(f, ['--run', f.runDir], { env: { ...ENV, GIT_AUTHOR_NAME: 'ArchiveCliEnvProbe' } });

  assert.equal(res.code, 0, res.stderr);
  assert.equal(envelope(res).outcome, 'moved');
  assert.equal(f.git(f.wt, 'log', '-1', '--format=%an'), 'ArchiveCliEnvProbe');
});

test('the move\'s argument error exits 2 with one stderr line; any other throw, a plain TypeError included, is not swallowed', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  const head = f.head();

  const res = cli(f, ['--run', f.runDir], { deps: { archiveRunHeader: () => { throw Object.assign(new TypeError('boom'), { code: ARGS_ERROR_CODE }); } } });

  assert.equal(res.code, 2);
  assert.equal(res.stdout, '');
  assert.deepEqual(res.stderr.split('\n').filter(Boolean), ['archive-run-header.js: the move refused its arguments: boom']);
  assert.equal(f.decisions(), '');
  assert.equal(f.head(), head);
  assert.throws(() => cli(f, ['--run', f.runDir], { deps: { archiveRunHeader: () => { throw new Error('other'); } } }), /other/);
  // A TypeError from inside the move (a bug after a mutation, say) is not an argument refusal.
  assert.throws(() => cli(f, ['--run', f.runDir], { deps: { archiveRunHeader: () => { throw new TypeError('x'); } } }), { name: 'TypeError', message: 'x' });
});

test('an unanchored worktree-local shadow --run exits 3 and leaves the shadow byte-unchanged', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  // The shadow: a copy of the run dir inside the linked worktree (the shape a bare relative path creates).
  const shadow = path.join(f.wt, PIPELINES, RUN);
  f.write(shadow, 'run-state.json', JSON.stringify({ status: 'active', worktree: f.wt }));
  f.write(shadow, 'decisions.md', '## /wrap-up\n- AUTO 00:00:00 — shadow: untouched. Reversibility: n/a.\n');
  const shadowBefore = fs.readFileSync(path.join(shadow, 'decisions.md'));
  const mainBefore = f.decisions();
  const head = f.head();

  const res = cli(f, ['--run', shadow]);

  assert.equal(res.code, 3);
  assert.equal(res.stdout, '', 'no envelope on an unanchored run dir');
  assert.match(res.stderr, /not anchored under the main checkout/);
  assert.deepEqual(fs.readFileSync(path.join(shadow, 'decisions.md')), shadowBefore);
  assert.equal(f.decisions(), mainBefore);
  assert.equal(f.head(), head, 'git was never asked to move anything');
  assert.deepEqual(f.tree(`${ARCH}/`), []);

  // A run dir that does not exist is exit 3 too.
  const missing = cli(f, ['--run', path.join(f.pipelines, '2026-11-17T000000-record-9')]);
  assert.equal(missing.code, 3);
  assert.match(missing.stderr, /does not exist/);
});

test('malformed invocations exit 2 with nothing on stdout and no git call', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  const head = f.head();
  fs.mkdirSync(path.join(f.pipelines, 'not-a-run-id'));
  fs.mkdirSync(path.join(f.pipelines, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(f.runDir, 'spec-0'));
  fs.mkdirSync(path.join(f.runDir, 'spec-x'));
  fs.mkdirSync(path.join(f.runDir, 'spec-8', 'work'), { recursive: true });
  const glob = path.join(f.pipelines, '2026-11-16T000000-[a]');
  fs.mkdirSync(glob);
  const cases = {
    'trailing bare --run': ['--run'],
    'empty --run': ['--run', ''],
    '--run followed by a flag': ['--run', '--section'],
    '--worktree with an option-shaped value': ['--run', f.runDir, '--worktree', '-x'],
    'trailing bare --worktree': ['--run', f.runDir, '--worktree'],
    '--section with an option-shaped value': ['--run', f.runDir, '--section', '-x'],
    'unknown flag': ['--run', f.runDir, '--force'],
    '--push, which the CLI no longer takes': ['--run', f.runDir, '--push'],
    'no --run': ['--section', '/wrap-up'],
    'a --run whose basename is not a run id': ['--run', path.join(f.pipelines, 'not-a-run-id')],
    'a glob character in the run id': ['--run', glob],
    'the pipelines/archive dir itself': ['--run', path.join(f.pipelines, 'archive')],
    'a spec segment that is not spec-{N}': ['--run', path.join(f.runDir, 'spec-x')],
    'spec-0': ['--run', path.join(f.runDir, 'spec-0')],
    'a segment below the spec dir': ['--run', path.join(f.runDir, 'spec-8', 'work')],
  };
  for (const [name, argv] of Object.entries(cases)) {
    const res = cli(f, argv);
    assert.equal(res.code, 2, `${name}: ${res.stderr}`);
    assert.equal(res.stdout, '', name);
    assert.match(res.stderr, /archive-run-header\.js: /, name);
  }
  // The main checkout, outside .claude-tweaks/pipelines/, is no run dir at all: the shared guard
  // (#5830) refuses it with the unanchored exit 3 before the run-id identity check that exits 2.
  const outside = cli(f, ['--run', f.main]);
  assert.equal(outside.code, 3, outside.stderr);
  assert.equal(outside.stdout, '');
  assert.match(outside.stderr, /archive-run-header\.js: /);
  assert.equal(f.head(), head);
  assert.equal(f.decisions(), '', 'nothing logged');
});

test('--help prints the usage and exits 0 before any probe', () => {
  const res = runCliSync(CLI, ['--help'], { env: {}, cwd: path.parse(process.cwd()).root });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /^usage: archive-run-header\.js --run <run-dir>/);
  assert.match(res.stdout, /exit 0 an envelope was printed/);
});

test('a relative --run resolves against the injected cwd', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  // f.main is not the test process's cwd, so a path.resolve that ignored the injection would not find this dir.
  const res = cli(f, ['--run', path.join(PIPELINES, RUN)]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(envelope(res).outcome, 'moved');
  assert.equal(f.entries(f.decisions()).length, 1);

  // And a relative --worktree resolves against it too.
  const g = makeFixture({ runState: { worktree: null } });
  g.header(`${LIVE}/work/7-spec.md`);
  const rel = path.relative(g.main, g.wt);
  const viaRel = cli(g, ['--run', path.join(PIPELINES, RUN), '--worktree', rel]);
  assert.equal(viaRel.code, 0, viaRel.stderr);
  assert.equal(envelope(viaRel).outcome, 'moved');
});

test('a failed decisions.md append reports logged: false and one stderr line', () => {
  const f = makeFixture();
  f.header(`${LIVE}/work/7-spec.md`);
  fs.mkdirSync(f.decisionsFile); // an unreadable-as-a-file decisions.md: the append throws

  const res = cli(f, ['--run', f.runDir]);

  assert.equal(res.code, 0, 'a failed append never changes the exit code');
  const env = envelope(res);
  assert.equal(env.outcome, 'moved', 'the move still happened');
  assert.equal(env.logged, false);
  assert.ok(env.logError, 'the envelope carries the reason');
  assert.deepEqual(f.tree(`${ARCH}/`), [`${ARCH}/work/7-spec.md`]);
  const stderrLines = res.stderr.split('\n').filter(Boolean);
  assert.equal(stderrLines.length, 1);
  assert.match(stderrLines[0], /^archive-run-header\.js: could not append the decisions\.md entry: /);
});

test('spawnCli smoke: script entry exits 0 on a noop', () => {
  const f = makeFixture();
  const res = spawnCli(CLI, ['--run', f.runDir], { env: ENV, cwd: f.main });
  assert.equal(res.code, 0, res.stderr);
  const env = JSON.parse(res.stdout);
  assert.deepEqual(env, { outcome: 'noop', moved: [], logged: true });
  assert.equal(f.decisions(), '');
});
