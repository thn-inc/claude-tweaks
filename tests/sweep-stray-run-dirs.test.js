'use strict';
const { test } = require('node:test');
require('./helpers/stub-token-pass').installTokenPassStub();
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const {
  sweep, hasTrackedWork, foldEventsJsonl, listStrayRunDirs,
} = require('../plugin/bin/sweep-stray-run-dirs');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { initRepo } = require('./helpers/git-fixtures');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'sweep-stray-run-dirs.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function trackedFiles(root) {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

function makeRepo() {
  const dir = scratchDir('sweep-strays-');
  initRepo(dir, { name: 't', email: 't@t', branch: 'main', cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function commitPath(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', relPath);
  git(root, 'commit', '-m', `add ${relPath}`);
}

test('hasTrackedWork: true when work/*.md is git-tracked under the dir, false for an untracked-only dir', () => {
  const root = makeRepo();
  commitPath(root, '.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md', '# 1\n');
  const untracked = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-2');
  fs.mkdirSync(path.join(untracked, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(untracked, 'config.yml'), 'x\n');

  assert.equal(hasTrackedWork(root, path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1')), true);
  assert.equal(hasTrackedWork(root, untracked), false);
});

// #4178: hasTrackedWork reads `git -C <root> ls-files`, and an inherited GIT_DIR overrides that
// discovery. The linked worktree's index here has dropped the work/ file that root's index still
// tracks, so an unpinned read through the worktree's GIT_DIR would answer false.
test('hasTrackedWork: an inherited GIT_DIR naming a linked worktree does not redirect the read away from root (#4178)', () => {
  const root = fs.realpathSync(makeRepo());
  const rel = '.claude-tweaks/pipelines/2026-08-01T090000-spec-1';
  commitPath(root, `${rel}/work/1-spec.md`, '# 1\n');
  const wtParent = fs.realpathSync(scratchDir('sweep-strays-wt-'));
  const wt = path.join(wtParent, 'wt');
  git(root, 'worktree', 'add', '-b', 'feat', wt);
  git(wt, 'rm', '--cached', '-q', `${rel}/work/1-spec.md`);
  const admin = git(wt, 'rev-parse', '--absolute-git-dir').trim();
  const prior = process.env.GIT_DIR;
  process.env.GIT_DIR = admin;
  try {
    assert.equal(hasTrackedWork(root, path.join(root, rel)), true);
  } finally {
    if (prior === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = prior;
    fs.rmSync(wtParent, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// #3651 AC1.1: without `-z` git C-quotes a non-ASCII path (the whole line is
// wrapped in `"` and the é prints as \303\251), so the per-path `work/` test
// ran on the quoted form. This pin keeps the per-path test on the raw path;
// core.quotepath is set explicitly so the quoting does not depend on the
// machine's git config.
test('hasTrackedWork: AC1.1 — a tracked work/ file is seen under a non-ASCII run dir and with a non-ASCII spec name', () => {
  const root = makeRepo();
  git(root, 'config', 'core.quotepath', 'true');
  commitPath(root, '.claude-tweaks/pipelines/2026-01-01T000000-café/work/1-spec.md', '# 1\n');
  commitPath(root, '.claude-tweaks/pipelines/2026-01-02T000000-plain/work/café-spec.md', '# 2\n');
  commitPath(root, '.claude-tweaks/pipelines/2026-01-03T000000-café-nowork/notes.md', '# 3\n');

  const dir = (n) => path.join(root, '.claude-tweaks', 'pipelines', n);
  assert.equal(hasTrackedWork(root, dir('2026-01-01T000000-café')), true);
  assert.equal(hasTrackedWork(root, dir('2026-01-02T000000-plain')), true);
  // A tracked file whose only non-ASCII is in the dir name, with no work/: stays false.
  assert.equal(hasTrackedWork(root, dir('2026-01-03T000000-café-nowork')), false);
});

test('listStrayRunDirs: every top-level dir except archive/, regardless of run-id naming shape', () => {
  const root = makeRepo();
  commitPath(root, '.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md', '# 1\n');
  commitPath(root, '.claude-tweaks/pipelines/20260817T082334-spec-741/work/741-spec.md', '# 741\n'); // malformed (no dashes)
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive'), { recursive: true });
  const names = listStrayRunDirs(root).map((d) => path.basename(d)).sort();
  assert.deepEqual(names, ['2026-08-01T090000-spec-1', '20260817T082334-spec-741']);
});

test('foldEventsJsonl: no existing archive twin -> straight move, source removed', () => {
  const root = makeRepo();
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"a"}\n');

  const r = foldEventsJsonl(runDir, archiveDir);
  assert.equal(r.folded, true);
  assert.equal(r.hadExisting, false);
  assert.equal(fs.existsSync(path.join(runDir, 'events.jsonl')), false);
  assert.equal(fs.readFileSync(path.join(archiveDir, 'events.jsonl'), 'utf8'), '{"type":"a"}\n');
});

test('foldEventsJsonl: existing archive twin -> content concatenated, nothing lost', () => {
  const root = makeRepo();
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'events.jsonl'), '{"type":"old"}\n');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"new"}\n');

  const r = foldEventsJsonl(runDir, archiveDir);
  assert.equal(r.folded, true);
  assert.equal(r.hadExisting, true);
  const merged = fs.readFileSync(path.join(archiveDir, 'events.jsonl'), 'utf8');
  assert.equal(merged, '{"type":"old"}\n{"type":"new"}\n');
  assert.equal(fs.existsSync(path.join(runDir, 'events.jsonl')), false);
});

test('foldEventsJsonl: no events.jsonl in source -> no-op, folded false', () => {
  const root = makeRepo();
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  const r = foldEventsJsonl(runDir, path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T090000-spec-1'));
  assert.deepEqual(r, { folded: false });
});

// End-to-end: the exact scenario the issue describes — a stray dir with a
// tracked work/ file and no other run dirs — swept correctly, old path gone
// from disk + index, archived copy tracked at the new path.
test('sweep: archives every stray dir with tracked work/, skips dirs with none, folds events.jsonl, resumable on re-run', () => {
  const root = makeRepo();
  commitPath(root, '.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md', '# 1\n');
  commitPath(root, '.claude-tweaks/pipelines/2026-08-02T090000-spec-2-3/spec-2/work/2-spec.md', '# 2\n');
  commitPath(root, '.claude-tweaks/pipelines/2026-08-02T090000-spec-2-3/spec-3/work/3-spec.md', '# 3\n');
  const dir1 = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1');
  fs.writeFileSync(path.join(dir1, 'events.jsonl'), '{"type":"start"}\n');
  const archiveTwin1 = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T090000-spec-1');
  fs.mkdirSync(archiveTwin1, { recursive: true });
  fs.writeFileSync(path.join(archiveTwin1, 'events.jsonl'), '{"type":"earlier-partial-attempt"}\n');
  fs.writeFileSync(path.join(archiveTwin1, 'run-state.json'), JSON.stringify({ status: 'clean' }));

  // A dir with no tracked work at all — untracked-only residue.
  const noWork = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-03T090000-spec-9');
  fs.mkdirSync(path.join(noWork, 'staged'), { recursive: true });

  const logPath = path.join(root, 'sweep.log');
  const result = sweep({ root, dryRun: false, logPath });

  assert.equal(result.archived.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'no-tracked-work');
  assert.equal(result.failed.length, 0);

  const tracked = trackedFiles(root);
  assert.equal(tracked.includes('.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md'), false);
  assert.ok(tracked.includes('.claude-tweaks/pipelines/archive/2026-08-01T090000-spec-1/work/1-spec.md'));
  assert.ok(tracked.includes('.claude-tweaks/pipelines/archive/2026-08-02T090000-spec-2-3/spec-2/work/2-spec.md'));
  assert.ok(tracked.includes('.claude-tweaks/pipelines/archive/2026-08-02T090000-spec-2-3/spec-3/work/3-spec.md'));

  // events.jsonl folded, not overwritten — both entries survive.
  const mergedEvents = fs.readFileSync(path.join(archiveTwin1, 'events.jsonl'), 'utf8');
  assert.ok(mergedEvents.includes('earlier-partial-attempt'));
  assert.ok(mergedEvents.includes('"start"'));

  // The untouched no-tracked-work dir survives — this sweep's scope is the
  // git-tracked resurrection bug specifically.
  assert.equal(fs.existsSync(noWork), true);

  // Old dirs with tracked work are gone from disk.
  assert.equal(fs.existsSync(dir1), false);
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', '2026-08-02T090000-spec-2-3')), false);

  // Log has one line per processed dir (archived + skipped).
  const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(logLines.length, 3);

  // Resumable: a second pass over what's left is a safe no-op (nothing left
  // with tracked work to archive; the no-work dir is skipped again).
  const second = sweep({ root, dryRun: false, logPath });
  assert.equal(second.archived.length, 0);
  assert.equal(second.skipped.length, 1);
  assert.equal(second.failed.length, 0);
});

test('sweep: dry-run reports without mutating anything', () => {
  const root = makeRepo();
  commitPath(root, '.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md', '# 1\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-1');

  const result = sweep({ root, dryRun: true, logPath: null });
  assert.equal(result.archived.length, 1);
  assert.equal(fs.existsSync(runDir), true, 'dry-run must not move anything');
  assert.ok(trackedFiles(root).includes('.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md'));
});

// --- CLI script entry (#5386) ---

// The four GIT_* location variables stripped, so an ambient GIT_DIR cannot redirect the fixtures' git.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

// Real process: proves the script entry, exit code 0 and the four-line dry-run summary on stdout.
// Its cwd is the fixture too: were --root ever ignored, the child would sweep the fixture, never this checkout.
test('AC5.1 AC7.1: --dry-run --root <fixture> prints the summary lines and exits 0', () => {
  const root = fs.realpathSync(makeRepo());
  try {
    commitPath(root, '.claude-tweaks/pipelines/2026-08-01T090000-spec-1/work/1-spec.md', '# 1\n');
    fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', '2026-08-03T090000-spec-9', 'staged'), { recursive: true });
    const res = spawnCli(CLI, ['--dry-run', '--root', root], { env: cleanEnv(), cwd: root });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, `root: ${root}\narchived: 1\nskipped: 1\nfailed: 0\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Real process: proves the script entry's exit code 1, the FAILED line on stdout and the empty stderr.
// Not a dry run, so its cwd is the fixture: a regressed --root must never archive the real checkout.
test('AC7.1: a failed archive exits 1 with a FAILED line on stdout and empty stderr', () => {
  const root = fs.realpathSync(makeRepo());
  try {
    const runId = '2026-08-01T090000-spec-1';
    commitPath(root, `.claude-tweaks/pipelines/${runId}/work/1-spec.md`, '# 1\n');
    // A regular file where the archive twin directory belongs: archiveRunDir's mkdir refuses.
    fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), 'in the way\n');
    const logPath = path.join(root, 'sweep.log');
    const res = spawnCli(CLI, ['--root', root, '--log', logPath], { env: cleanEnv(), cwd: root });
    assert.equal(res.code, 1);
    assert.equal(res.stderr, '');
    assert.equal(
      res.stdout,
      `root: ${root}\narchived: 0\nskipped: 0\nfailed: 1\n  FAILED ${runId}: mkdir-failed\nlog: ${logPath}\n`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- in-process entry (#5386) ---

// A POSIX literal, not path.join: it is compared against `git ls-files` output, which uses
// forward slashes on Windows too; path.join(root, PIPELINES, …) still yields a native fs path.
const PIPELINES = '.claude-tweaks/pipelines';

function withRepos(count, body) {
  const roots = [];
  try {
    for (let i = 0; i < count; i++) roots.push(fs.realpathSync(makeRepo()));
    return body(...roots);
  } finally {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  }
}

test('AC4.1: in-process with a fixture cwd sweeps only under that directory', () => {
  withRepos(2, (a, b) => {
    const runId = '2026-08-01T090000-spec-1';
    commitPath(a, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    commitPath(b, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    // Guard: a dry run first, so a `run` that ignores deps.cwd() fails here (it would otherwise sweep
    // and commit in whichever checkout contains the test runner's cwd) before anything is written to git.
    const logDir = scratchDir('sweep-strays-guard-');
    try {
      const guard = runCliSync(CLI, ['--dry-run', '--log', path.join(logDir, 'guard.log')], { cwd: a, env: cleanEnv() });
      assert.equal(guard.stdout.split('\n')[0], `root: ${a}`);
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
    const res = runCliSync(CLI, [], { cwd: a, env: cleanEnv() });
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
    assert.equal(
      res.stdout,
      `root: ${a}\narchived: 1\nskipped: 0\nfailed: 0\nlog: ${path.join(a, '.claude-tweaks', 'sweep-stray-run-dirs.log')}\n`,
    );
    assert.ok(trackedFiles(a).includes(`${PIPELINES}/archive/${runId}/work/1-spec.md`));
    assert.equal(fs.existsSync(path.join(a, PIPELINES, runId)), false);
    assert.ok(trackedFiles(b).includes(`${PIPELINES}/${runId}/work/1-spec.md`));
    assert.equal(fs.existsSync(path.join(b, PIPELINES, 'archive')), false);
  });
});

test('AC8.1: a relative --root and --log resolve against deps.cwd()', () => {
  const parent = fs.realpathSync(scratchDir('sweep-strays-cwd-'));
  const stray = path.join(process.cwd(), 'sweep-rel.log');
  const strayExisted = fs.existsSync(stray);
  try {
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    initRepo(root, { name: 't', email: 't@t', branch: 'main', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    commitPath(root, `${PIPELINES}/2026-08-01T090000-spec-1/work/1-spec.md`, '# 1\n');
    const res = runCliSync(CLI, ['--root', 'repo', '--log', 'sweep-rel.log'], { cwd: parent, env: cleanEnv() });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, `root: ${root}\narchived: 1\nskipped: 0\nfailed: 0\nlog: sweep-rel.log\n`);
    assert.equal(fs.existsSync(path.join(parent, 'sweep-rel.log')), true, 'the log lands under the injected cwd');
    assert.equal(fs.existsSync(stray), strayExisted, 'nothing is written under the real cwd');
  } finally {
    if (!strayExisted) fs.rmSync(stray, { force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// A deleted working directory: process.cwd() throws ENOENT. An absolute --root and --log never need it.
test('an absolute --root and --log work when deps.cwd() throws (deleted cwd)', () => {
  withRepos(1, (root) => {
    commitPath(root, `${PIPELINES}/2026-08-01T090000-spec-1/work/1-spec.md`, '# 1\n');
    const logDir = scratchDir('sweep-strays-deleted-cwd-');
    try {
      const deletedCwd = () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); };
      const res = runCliSync(CLI, ['--dry-run', '--root', root, '--log', path.join(logDir, 'sweep.log')], {
        env: cleanEnv(), deps: { cwd: deletedCwd },
      });
      assert.equal(res.code, 0, res.stderr);
      assert.equal(res.stdout, `root: ${root}\narchived: 1\nskipped: 0\nfailed: 0\n`);
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});

// A repo whose --root is a subdirectory, so git discovery has to ascend: an env-only
// GIT_CEILING_DIRECTORIES (a variable repoPinnedEnv keeps) stops it, and process.env has none.
function withSubdirRoot(body) {
  return withRepos(1, (repo) => {
    const root = path.join(repo, 'sub');
    const runId = '2026-08-01T090000-spec-1';
    commitPath(repo, `sub/${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    return body({ repo, root, runId, runDir: path.join(root, PIPELINES, runId) });
  });
}

test('AC8.1: git children get the injected env — a ceiling in deps.env stops the hasTrackedWork read', () => {
  withSubdirRoot(({ repo, root, runDir }) => {
    const ceiling = cleanEnv({ GIT_CEILING_DIRECTORIES: repo });
    assert.equal(hasTrackedWork(root, runDir, ceiling), false);
    assert.equal(hasTrackedWork(root, runDir, cleanEnv()), true);
    const withCeiling = runCliSync(CLI, ['--root', root, '--dry-run'], { cwd: root, env: ceiling });
    assert.equal(withCeiling.stdout, `root: ${root}\narchived: 0\nskipped: 1\nfailed: 0\n`);
    const without = runCliSync(CLI, ['--root', root, '--dry-run'], { cwd: root, env: cleanEnv() });
    assert.equal(without.stdout, `root: ${root}\narchived: 1\nskipped: 0\nfailed: 0\n`);
  });
});

// Env-only config: every commit must be GPG-signed by a program that does not exist.
const FAIL_COMMIT = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'true',
  GIT_CONFIG_KEY_1: 'gpg.program',
  GIT_CONFIG_VALUE_1: 'no-such-gpg-program-5386',
};

function traceCommands(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line) => /built-in: git '?([a-z-]+)'?/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

// A copy of a trace's subcommand list, sorted: the assertions pin which git children ran and how
// many times each, not the order the archive code happens to start them in.
const sorted = (list) => [...list].sort();

test('AC8.1: git children get the injected env — a failing commit in deps.env refuses and reverts', () => {
  withRepos(1, (root) => {
    const runId = '2026-08-01T090000-spec-1';
    commitPath(root, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    const traceDir = scratchDir('sweep-strays-trace-');
    try {
      const trace = path.join(traceDir, 'trace.txt');
      const res = runCliSync(CLI, ['--root', root, '--log', path.join(traceDir, 'sweep.log')], {
        cwd: root, env: cleanEnv({ ...FAIL_COMMIT, GIT_TRACE: trace }),
      });
      assert.equal(res.code, 1);
      assert.match(res.stdout, new RegExp(`  FAILED ${runId}: commit-failed\\n`));
      // The revert's own git child (reset) carried the env too, and the tree is back where it was.
      assert.ok(traceCommands(trace).includes('reset'));
      assert.ok(trackedFiles(root).includes(`${PIPELINES}/${runId}/work/1-spec.md`));
      assert.equal(fs.existsSync(path.join(root, PIPELINES, runId, 'work', '1-spec.md')), true);
    } finally {
      fs.rmSync(traceDir, { recursive: true, force: true });
    }
  });
});

test('AC8.1: every git child on the archive path runs under the injected env (GIT_TRACE only in deps.env)', () => {
  withRepos(1, (root) => {
    const runId = '2026-08-01T090000-spec-1';
    commitPath(root, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    const traceDir = scratchDir('sweep-strays-trace-');
    try {
      const trace = path.join(traceDir, 'trace.txt');
      const res = runCliSync(CLI, ['--root', root, '--log', path.join(traceDir, 'sweep.log')], {
        cwd: root, env: cleanEnv({ GIT_TRACE: trace }),
      });
      assert.equal(res.code, 0);
      const seen = traceCommands(trace).filter((c) => ['ls-files', 'mv', 'commit', 'show', 'symbolic-ref'].includes(c));
      // hasTrackedWork, the work/ move, the commit, readArchiveCommit's two reads, the tracked-entry guard.
      assert.deepEqual(sorted(seen), sorted(['ls-files', 'mv', 'commit', 'show', 'symbolic-ref', 'ls-files']));
    } finally {
      fs.rmSync(traceDir, { recursive: true, force: true });
    }
  });
});

test('AC8.1: the identical-twin resolution children run under the injected env too', () => {
  withRepos(1, (root) => {
    const runId = '2026-08-01T090000-spec-1';
    commitPath(root, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    commitPath(root, `${PIPELINES}/archive/${runId}/work/1-spec.md`, '# 1\n');
    const traceDir = scratchDir('sweep-strays-trace-');
    try {
      const trace = path.join(traceDir, 'trace.txt');
      const res = runCliSync(CLI, ['--root', root, '--log', path.join(traceDir, 'sweep.log')], {
        cwd: root, env: cleanEnv({ GIT_TRACE: trace }),
      });
      assert.equal(res.code, 0, res.stdout);
      const seen = traceCommands(trace).filter((c) => ['ls-files', 'hash-object', 'rm', 'commit'].includes(c));
      // hasTrackedWork, the two twin hashes, isTracked's two reads, git rm, the commit (the emptied run dir is gone, so no guard read).
      assert.deepEqual(sorted(seen), sorted(['ls-files', 'hash-object', 'hash-object', 'ls-files', 'ls-files', 'rm', 'commit']));
    } finally {
      fs.rmSync(traceDir, { recursive: true, force: true });
    }
  });
});

// Runs the CLI in-process with GIT_TRACE set only in deps.env and returns the exit code plus the git
// subcommands that wrote a trace line (those given in `watch`, in trace order). A git child that did not
// get deps.env writes nothing, so a missing entry names the child that lost the env.
function traceSweep(root, watch, extraEnv = {}) {
  const traceDir = scratchDir('sweep-strays-trace-');
  try {
    const trace = path.join(traceDir, 'trace.txt');
    const res = runCliSync(CLI, ['--root', root, '--log', path.join(traceDir, 'sweep.log')], {
      cwd: root, env: cleanEnv({ ...extraEnv, GIT_TRACE: trace }),
    });
    return { res, seen: traceCommands(trace).filter((c) => watch.includes(c)) };
  } finally {
    fs.rmSync(traceDir, { recursive: true, force: true });
  }
}

const RUN_ID = '2026-08-01T090000-spec-1';

test('AC8.1: the empty-work/ checks of a multi-spec run dir run under the injected env', () => {
  withRepos(1, (root) => {
    const runDir = path.join(root, PIPELINES, RUN_ID);
    commitPath(root, `${PIPELINES}/${RUN_ID}/spec-2/work/2-spec.md`, '# 2\n');
    fs.mkdirSync(path.join(runDir, 'work'));
    fs.mkdirSync(path.join(runDir, 'spec-3', 'work'), { recursive: true });
    const { res, seen } = traceSweep(root, ['ls-files', 'mv', 'commit']);
    assert.equal(res.code, 0, res.stdout);
    // hasTrackedWork, the empty top work/, the empty spec-3/work, the spec-2 move, the commit, the tracked-entry guard.
    assert.deepEqual(sorted(seen), sorted(['ls-files', 'ls-files', 'ls-files', 'mv', 'commit', 'ls-files']));
  });
});

test('AC8.1: a tidy-standalone run dir\'s audit-file tracked checks run under the injected env', () => {
  withRepos(1, (root) => {
    const runId = '2026-08-01T090000-tidy-standalone';
    commitPath(root, `${PIPELINES}/${runId}/work/1-spec.md`, '# 1\n');
    commitPath(root, `${PIPELINES}/${runId}/decisions.md`, 'd\n');
    const { res, seen } = traceSweep(root, ['ls-files', 'mv', 'commit']);
    assert.equal(res.code, 0, res.stdout);
    // hasTrackedWork, decisions.md's two isTracked reads, the two moves (work/, decisions.md), the commit, the guard.
    assert.deepEqual(sorted(seen), sorted(['ls-files', 'ls-files', 'ls-files', 'mv', 'mv', 'commit', 'ls-files']));
  });
});

test('AC8.1: an identical twin under a spec dir, and a twin copy that is untracked, run under the injected env', () => {
  withRepos(2, (specTwin, untrackedTwin) => {
    commitPath(specTwin, `${PIPELINES}/${RUN_ID}/spec-2/work/2-spec.md`, '# 2\n');
    commitPath(specTwin, `${PIPELINES}/archive/${RUN_ID}/spec-2/work/2-spec.md`, '# 2\n');
    const a = traceSweep(specTwin, ['ls-files', 'hash-object', 'rm', 'mv']);
    assert.equal(a.res.code, 0, a.res.stdout);
    assert.deepEqual(sorted(a.seen), sorted(['ls-files', 'hash-object', 'hash-object', 'ls-files', 'ls-files', 'rm']));

    commitPath(untrackedTwin, `${PIPELINES}/${RUN_ID}/work/1-spec.md`, '# 1\n');
    const twinFile = path.join(untrackedTwin, PIPELINES, 'archive', RUN_ID, 'work', '1-spec.md');
    fs.mkdirSync(path.dirname(twinFile), { recursive: true });
    fs.writeFileSync(twinFile, '# 1\n');
    const b = traceSweep(untrackedTwin, ['ls-files', 'hash-object', 'rm', 'mv']);
    assert.equal(b.res.code, 0, b.res.stdout);
    assert.deepEqual(sorted(b.seen), sorted(['ls-files', 'hash-object', 'hash-object', 'ls-files', 'mv', 'ls-files']));
  });
});

test('AC8.1: reverting a failed commit — twin removal and twin move — runs under the injected env', () => {
  withRepos(2, (tracked, untracked) => {
    commitPath(tracked, `${PIPELINES}/${RUN_ID}/work/1-spec.md`, '# 1\n');
    commitPath(tracked, `${PIPELINES}/archive/${RUN_ID}/work/1-spec.md`, '# 1\n');
    const a = traceSweep(tracked, ['checkout', 'reset'], FAIL_COMMIT);
    assert.equal(a.res.code, 1);
    assert.deepEqual(sorted(a.seen), sorted(['checkout']));
    assert.equal(fs.existsSync(path.join(tracked, PIPELINES, RUN_ID, 'work', '1-spec.md')), true);

    commitPath(untracked, `${PIPELINES}/${RUN_ID}/work/1-spec.md`, '# 1\n');
    const twinFile = path.join(untracked, PIPELINES, 'archive', RUN_ID, 'work', '1-spec.md');
    fs.mkdirSync(path.dirname(twinFile), { recursive: true });
    fs.writeFileSync(twinFile, '# 1\n');
    const b = traceSweep(untracked, ['checkout', 'reset'], FAIL_COMMIT);
    assert.equal(b.res.code, 1);
    assert.deepEqual(sorted(b.seen), sorted(['reset']));
  });
});
