'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sweep, hasTrackedWork, foldEventsJsonl, listStrayRunDirs,
} = require('../plugin/bin/sweep-stray-run-dirs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function trackedFiles(root) {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-strays-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
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
  const wtParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-strays-wt-')));
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
