#!/usr/bin/env node
// bin/qa-stamp.js — write and check the QA pass stamp (#3003), the only writer
// of {git-dir}/claude-tweaks-qa-pass.json (lib/verify/qa-stamp.js holds the
// rules). /claude-tweaks:test runs --write after QA Phase 5 writes report.json,
// and --check before pipeline story dispatch, so a dispatched group's second
// call skips stories that already passed at the same clean HEAD.
//
//   node bin/qa-stamp.js --write --report <RUN_DIR/report.json> [--stories-dir <dir>]
//   node bin/qa-stamp.js --check --stories <id=file,...> [--stories-dir <dir>]
//
// Prints one JSON line: --write → {written: true, path, sha, stories} or
// {written: false, reason[, invalidated: true | invalidateFailed: <code>]};
// --check → {skip, reason, sha}.
// Status is data: exit 0 in every state; 2 malformed invocation.
//
// Dirty check (Important 3, #3003 final review): cleanliness is this CLI's own
// `git status --porcelain -- . ':(exclude).claude-tweaks/artifacts'` pathspec,
// never report.js's shared gitInfo() dirty flag — a pipeline QA run's own
// screenshots under .claude-tweaks/artifacts/ must not make every run read
// dirty-tree and never stamp. HEAD still comes from gitInfo()'s `git rev-parse HEAD`.
//
// Stamp invalidation (Important 2): a `--write` refusal that is a *result*
// refusal (no-stories, story-not-passed: …, summary-not-clean, summary-mismatch
// — the run was evaluated and failed) removes an existing stamp at the same
// HEAD, so a later `--check` can't report a stale pass. `invalidated: true` is
// present only when a stamp was actually removed; it is omitted (never `false`)
// otherwise, matching report.js's own omit-when-absent convention. When the
// removal itself fails (e.g. EACCES), `invalidateFailed: <errno code>` says so
// instead — the stale stamp is still on disk and the caller must surface it. An
// *environmental* refusal (report-unreadable, no-git-dir, dirty-tree, no-head,
// story-file-unreadable) never invalidates — the run was never evaluated.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  composeQaStamp, decideQaSkip, readQaStamp, writeQaStamp, QA_STAMP_NAME,
} = require('./lib/verify/qa-stamp');
const { gitInfo, gitDir } = require('./lib/verify/report');

const USAGE = 'usage: qa-stamp.js --write --report <RUN_DIR/report.json> [--stories-dir <dir>]\n'
  + '       qa-stamp.js --check --stories <id=file,...> [--stories-dir <dir>]\n'
  + '  prints one JSON line; exit 0 in every state; 2 malformed invocation\n';

function parseArgs(argv) {
  const o = {
    write: false, check: false, report: null, storiesDir: null, stories: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--check') o.check = true;
    else if (a === '--report') o.report = argv[++i] ?? null;
    else if (a === '--stories-dir') o.storiesDir = argv[++i] ?? null;
    else if (a === '--stories') {
      const raw = argv[++i] ?? '';
      const pairs = raw.split(',').filter(Boolean).map((item) => {
        const eq = item.indexOf('=');
        return eq > 0 && eq < item.length - 1 ? { id: item.slice(0, eq), file: item.slice(eq + 1) } : null;
      });
      if (pairs.length === 0 || pairs.includes(null)) return { error: `--stories expects id=file[,id=file...]: ${raw}` };
      o.stories = pairs;
    } else return { error: `unknown argument: ${a}` };
  }
  if (o.write === o.check) return { error: 'exactly one of --write or --check is required' };
  if (o.write && !o.report) return { error: '--write requires --report <path>' };
  if (o.check && !o.stories) return { error: '--check requires --stories <id=file,...>' };
  return o;
}

// Important 3: QA's own artifacts never count toward dirty. A git failure
// means "unknown", which composeQaStamp/decideQaSkip already treat as not
// clean (dirty !== false blocks the stamp the same as a real dirty tree).
function computeDirty(execImpl = execFileSync, cwd = process.cwd()) {
  try {
    const out = String(execImpl('git', ['--no-optional-locks', 'status', '--porcelain', '--', '.', ':(exclude).claude-tweaks/artifacts'], { encoding: 'utf8', cwd, windowsHide: true })).trim(); // git-path-read: not a path list (emptiness only)
    return out !== '';
  } catch {
    return null;
  }
}

const realDeps = {
  cwd: () => process.cwd(),
  gitInfo: () => gitInfo(),
  gitDir: () => gitDir(),
  dirty: () => computeDirty(),
  now: () => new Date().toISOString(),
  unlink: (p) => fs.unlinkSync(p),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function hashFile(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
}

// Minor 4: a storiesDir given as `./stories/`, `stories/`, or an absolute path
// must compare equal to its plain `stories` spelling on both --write and
// --check — normalize to a cwd-relative, forward-slash form before using it
// anywhere (composing the stamp, comparing it, or resolving story paths).
function normalizeStoriesDir(dir, cwd) {
  const rel = path.relative(cwd, path.resolve(cwd, dir));
  return (rel === '' ? '.' : rel).split(path.sep).join('/');
}

function emit(deps, body) {
  deps.stdout(`${JSON.stringify(body)}\n`);
  return 0;
}

// Important 2: a *result* refusal (the run was evaluated and failed) at the
// same HEAD as an existing stamp means that stamp is stale — remove it so a
// later --check can't report a pass that no longer holds. An *environmental*
// refusal (report-unreadable, no-git-dir, dirty-tree, no-head,
// story-file-unreadable) never reaches here: it returns before composeQaStamp
// runs, or composeQaStamp never evaluated the stories to know they passed.
const RESULT_REFUSAL_RE = /^(no-stories|summary-not-clean|summary-mismatch|story-not-passed: )/;
// Returns the fields to merge into the refusal line: {} when nothing was
// removed, {invalidated: true} on removal, {invalidateFailed: code} when the
// stale stamp could not be removed (ENOENT means it is already gone — {}).
function invalidateStaleStamp(dir, head, reason, deps) {
  if (!RESULT_REFUSAL_RE.test(reason)) return {};
  const existing = readQaStamp(dir);
  if (!existing || existing.sha !== head) return {};
  try { deps.unlink(path.join(dir, QA_STAMP_NAME)); } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return { invalidateFailed: (err && err.code) || 'unknown' };
  }
  return { invalidated: true };
}

function write(o, deps) {
  let report;
  try { report = JSON.parse(fs.readFileSync(o.report, 'utf8')); } catch {
    return emit(deps, { written: false, reason: 'report-unreadable' });
  }
  // `null`, a number, or an array parses fine but is no report — refuse it as
  // unreadable rather than crash on `report.stories_dir` below.
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return emit(deps, { written: false, reason: 'report-unreadable' });
  }
  const dir = deps.gitDir();
  if (!dir) return emit(deps, { written: false, reason: 'no-git-dir' });
  const storiesDir = normalizeStoriesDir(o.storiesDir || report.stories_dir || 'stories', deps.cwd());
  // Object.create(null) (Deferred minor 1): a story literally named
  // `__proto__` must hash like any other file, never silently vanish into the
  // prototype's own accessor.
  const storyHashes = Object.create(null);
  for (const s of Array.isArray(report.stories) ? report.stories : []) {
    if (s === null || typeof s !== 'object') continue; // Minor 5 — composeQaStamp refuses malformed entries itself
    storyHashes[s.source_file] = hashFile(path.resolve(deps.cwd(), storiesDir, String(s.source_file)));
  }
  const { sha } = deps.gitInfo();
  const dirty = deps.dirty();
  const { stamp, error } = composeQaStamp({
    report, head: sha, dirty, storyHashes, storiesDir, reportPath: path.resolve(o.report), at: deps.now(),
  });
  if (error) return emit(deps, { written: false, reason: error, ...invalidateStaleStamp(dir, sha, error, deps) });
  const p = writeQaStamp(dir, stamp);
  return emit(deps, { written: true, path: p, sha: stamp.sha, stories: stamp.stories.length });
}

function check(o, deps) {
  const dir = deps.gitDir();
  const stamp = dir ? readQaStamp(dir) : null;
  const storiesDir = normalizeStoriesDir(o.storiesDir || 'stories', deps.cwd());
  const selected = o.stories.map((s) => ({ ...s, sha256: hashFile(path.resolve(deps.cwd(), storiesDir, s.file)) }));
  const { sha } = deps.gitInfo();
  const dirty = deps.dirty();
  const verdict = decideQaSkip({
    stamp, head: sha, dirty, storiesDir, selected,
  });
  return emit(deps, { ...verdict, sha: stamp ? stamp.sha : null });
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`qa-stamp.js: ${o.error}\n${USAGE}`); return 2; }
  return o.write ? write(o, deps) : check(o, deps);
}

module.exports = {
  run, parseArgs, computeDirty,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
