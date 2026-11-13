// plugin/bin/lib/learned-skills/learned-skills.js — moves a wrap-up Skills-row edit off the run
// branch (#5290). Wrap-up's Skills row used to commit an auto-applied skill edit on the run's own
// branch, which makes merge-check refuse the record's auto-merge. `capture` turns one such
// working-tree edit into a patch file in the run dir and reverts it in the worktree; a later verb
// lands the patches as a separate learned-skills PR (or `stageEntry` parks one for the console).
//
// Failure contract: a failure BEFORE the diff was read (git unavailable, no HEAD, a bad target)
// throws, and nothing was changed. A failure AFTER it (patch write, revert, residue check,
// manifest write) puts the tree back at HEAD for the target and stages the edit through
// `stageEntry`, returning { route: 'staged', ... } — the edit is never lost and never committed on
// the run branch. `residue: true` on that result means even the tree could not be put back.
//
// Every side effect goes through `deps` (git, now, appendEntries, fs seams) so tests inject fakes.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeFileAtomic } = require('../atomic-write');
const { splitNul } = require('../git-z');
const { formatEntry, appendEntries } = require('../log-decision/append');
const { lstatType, canonicalRealpath, resolveTarget, isAncestorOrSelf } = require('../path-guard');
const { ghOptions } = require('../repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');

const LOG_SECTION = '/wrap-up';
const STEP = 'Skills row';
const SKILL_PREFIX = '.claude/skills/';

// A bad invocation (CLI exit 2). Everything else thrown out of a verb is an exit-1 failure.
class UsageError extends Error {}

const realDeps = {
  // Throwing runner: stdout on success (a string, or a Buffer with opts.encoding 'buffer'), a throw
  // on any non-zero exit. Local-only calls, so no timeout.
  git: (args, opts = {}) => execFileSync('git', args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: opts.encoding || 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: LARGE_MAX_BUFFER_BYTES,
    windowsHide: true,
  }),
  // The gh runner the PR verb uses: a body travels on stdin, never a temp file.
  gh: (args, input) => execFileSync('gh', args, ghOptions(args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES,
    windowsHide: true,
  })),
  now: () => Date.now(),
  appendEntries,
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  readdir: (p) => fs.readdirSync(p),
  readFile: (p) => fs.readFileSync(p),
  writeFile: (p, data) => writeFileAtomic(p, data),
  writeFileExclusive: (p, data) => fs.writeFileSync(p, data, { flag: 'wx' }),
  unlink: (p) => fs.unlinkSync(p),
  rmdir: (p) => fs.rmdirSync(p),
  lstatType,
};

// ---------------------------------------------------------------------------------------------
// Manifest

function manifestPath(runDir) { return path.join(runDir, 'learned-skills', 'manifest.json'); }

function readManifest(runDir) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath(runDir), 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`learned-skills manifest is not an array: ${manifestPath(runDir)}`);
  return parsed;
}

function writeManifest(runDir, entries) {
  const file = manifestPath(runDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(entries, null, 2) + '\n');
  return file;
}

function nextId(entries) {
  const max = entries.reduce((m, e) => Math.max(m, Number.parseInt(e.id, 10) || 0), 0);
  return String(max + 1);
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function errText(e) {
  return [e && e.message, e && e.stderr].filter(Boolean).map((s) => String(s).trim().split('\n')[0]).join(' — ') || String(e);
}

function toBuffer(x) { return Buffer.isBuffer(x) ? x : Buffer.from(String(x == null ? '' : x), 'utf8'); }

// '.claude/skills/x/SKILL.md' -> 'x/SKILL.md'; a target without the prefix keeps its whole path.
function skillLabel(target) {
  return target.startsWith(SKILL_PREFIX) ? target.slice(SKILL_PREFIX.length) : target;
}

// A repo-relative posix target that cannot leave the worktree. Throws UsageError otherwise.
function normalizeTarget(target, worktree) {
  if (typeof target !== 'string' || !target.trim()) throw new UsageError('target is required');
  if (target.includes('\0')) throw new UsageError('target contains a NUL byte');
  const slashed = target.replace(/\\/g, '/');
  if (path.posix.isAbsolute(slashed) || path.win32.isAbsolute(target) || /^[A-Za-z]:/.test(target)) {
    throw new UsageError(`target must be repo-relative, not absolute: ${target}`);
  }
  const rel = path.posix.normalize(slashed);
  if (rel === '.' || rel === '..' || rel.startsWith('../') || slashed.split('/').includes('..')) {
    throw new UsageError(`target must stay inside the worktree: ${target}`);
  }
  const root = canonicalRealpath(worktree);
  if (root === null) throw new UsageError(`worktree is not readable: ${worktree}`);
  const resolved = resolveTarget(path.join(worktree, rel));
  if (resolved.state !== 'resolved' || !isAncestorOrSelf(root, resolved.path)) {
    throw new UsageError(`target resolves outside the worktree: ${target}`);
  }
  return rel;
}

// ---------------------------------------------------------------------------------------------
// stageEntry — the staging writer (capture's fallback; the stage verb)

// N = 1 + the highest existing wrap-up-skill-{n}.md.
function nextStageNumber(stagedDir, deps) {
  let names = [];
  try { names = deps.readdir(stagedDir); } catch (err) {
    if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) throw err;
  }
  let max = 0;
  for (const n of names) {
    const m = /^wrap-up-skill-(\d+)\.md$/.exec(n);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max + 1;
}

// Writes staged/wrap-up-skill-{N}.md: a preamble (staged-patch.md's Artifact format), a blank line,
// the patch bytes. Gate per staged-patch.md's Staging-time gate, with the patch's own outcomes:
//   `git apply --check` exit 0 -> 'ok'; an unreadable file -> 'unvalidated' (kept); otherwise
//   recompose once from the patch file and, failing again, description-only (no diff).
// The stacked check (bin/check-staged-stack.js) is NOT run: it walks only `*.patch` entries of
// staged/ and exits 2 for any other --patch name, so against this `.md` artifact it could never
// report a verdict — see the task report.
// entry: { target, summary, patch: Buffer|string, patchFile?: string }.
function stageEntry({ runDir, worktree, entry, reason }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const stagedDir = path.join(runDir, 'staged');
  deps.mkdir(stagedDir);
  const target = oneLine(entry.target);
  const summary = oneLine(entry.summary);
  let headShort = 'unknown';
  try { headShort = String(deps.git(['-C', worktree, 'rev-parse', '--short', 'HEAD'])).trim() || 'unknown'; } catch { /* kept as unknown */ }
  const preamble = [
    `Target: ${target}`,
    `Invariant: ${summary}`,
    `Finding: Skills row — ${summary}`,
    `Staged-at: ${headShort}`,
  ].join('\n') + '\n\n';
  const compose = (patch) => Buffer.concat([Buffer.from(preamble, 'utf8'), toBuffer(patch)]);

  // Exclusive create, so two writers racing for one N cannot overwrite each other.
  let n = nextStageNumber(stagedDir, deps);
  let stagePath;
  for (;;) {
    stagePath = path.join(stagedDir, `wrap-up-skill-${n}.md`);
    try { deps.writeFileExclusive(stagePath, compose(entry.patch)); break; } catch (err) {
      if (err && err.code === 'EEXIST') { n += 1; continue; }
      throw err;
    }
  }

  const check = () => {
    try { deps.git(['-C', worktree, 'apply', '--check', stagePath]); return { ok: true }; } catch (err) {
      return { ok: false, text: errText(err) };
    }
  };
  let gate;
  let note = '';
  let probe = check();
  if (probe.ok) {
    gate = 'ok';
  } else {
    let readable = true;
    try { deps.readFile(stagePath); } catch { readable = false; }
    if (!readable) {
      gate = 'unvalidated';
      note = `gate could not run: ${probe.text}; kept unvalidated`;
    } else {
      // Recompose once from the patch file the diff was captured to.
      let again = toBuffer(entry.patch);
      if (entry.patchFile) { try { again = deps.readFile(entry.patchFile); } catch { /* keep the bytes in hand */ } }
      deps.writeFile(stagePath, compose(again));
      probe = check();
      if (probe.ok) {
        gate = 'ok';
      } else {
        deps.writeFile(stagePath, Buffer.from(preamble, 'utf8'));
        gate = 'description-only';
        note = `patch failed \`git apply --check\` at staging (${probe.text}); staged description-only`;
      }
    }
  }

  const logFailed = logStaged({ runDir, deps, target, summary, reason, note, stageName: `wrap-up-skill-${n}.md` });
  return { stagePath, gate, logFailed };
}

// STAGED line in the shape the Global Constraints fix:
//   STAGED {time} — Skills row: skill update for {skill}/SKILL.md ({section}) could not ride a
//   learned-skills PR ({reason}); staged instead. Reversibility: high (stage path: staged/…).
function logStaged({ runDir, deps, target, summary, reason, note, stageName }) {
  const why = [oneLine(reason), note].filter(Boolean).join('; ');
  const line = formatEntry({
    status: 'STAGED',
    now: deps.now(),
    step: STEP,
    text: `skill update for ${skillLabel(target)} (${summary}) could not ride a learned-skills PR (${why}); staged instead`,
    reversibility: `high (stage path: staged/${stageName})`,
  });
  try {
    deps.appendEntries({ runDir, items: [{ section: LOG_SECTION, entry: line }] });
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// capture

function capture({ runDir, worktree, mergeBase, target, summary }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  if (typeof runDir !== 'string' || !runDir) throw new UsageError('runDir is required');
  if (typeof worktree !== 'string' || !worktree) throw new UsageError('worktree is required');
  if (typeof mergeBase !== 'string' || !mergeBase.trim() || mergeBase.startsWith('-')) {
    throw new UsageError('mergeBase must be a commit id');
  }
  const rel = normalizeTarget(target, worktree);
  const note = oneLine(summary);
  if (!note) throw new UsageError('summary is required');

  const git = (args, opts) => deps.git(['-C', worktree, ...args], opts);
  const abs = path.join(worktree, rel);

  // 1. Record-owned: an edit the record's own commits already touched stays on the run branch.
  const owned = splitNul(git(['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--end-of-options', mergeBase, 'HEAD', '--']));
  if (owned.includes(rel)) return { route: 'run-branch', reason: 'record-owned' };

  const manifest = readManifest(runDir);
  const existing = manifest.find((e) => e.target === rel && e.status !== 'staged') || null;

  // Only whether the output is empty is read, never a path from it.
  const statusOf = () => String(deps.git(['-C', worktree, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', rel])).trimEnd(); // git-path-read: not a path list (emptiness only)
  const inHead = () => { try { git(['cat-file', '-e', `HEAD:${rel}`]); return true; } catch { return false; } };

  // 2. Nothing changed: the audit's clean-path case, or a target already captured in this run.
  const before = statusOf();
  if (!before) {
    if (!existing) return { route: 'clean' };
    return { route: 'captured', id: existing.id, patch: existing.patch, shared: true };
  }

  // 3. Read the diff. An untracked file first becomes intent-to-add, so it appears as a new file.
  const tracked = inHead();
  let addedIntent = false;
  let diff;
  try {
    if (!tracked) { git(['add', '-N', '--', rel]); addedIntent = true; }
    diff = toBuffer(git([
      '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff',
      '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', rel,
    ], { encoding: 'buffer' }));
  } catch (err) {
    if (addedIntent) { try { git(['rm', '--cached', '--quiet', '--', rel]); } catch { /* best effort */ } }
    throw err;
  }
  if (diff.length === 0) {
    if (addedIntent) { try { git(['rm', '--cached', '--quiet', '--', rel]); } catch { /* best effort */ } }
    return existing ? { route: 'captured', id: existing.id, patch: existing.patch, shared: true } : { route: 'clean' };
  }

  // From here the diff is in hand: any failure stages it instead of throwing.
  let workDiff = diff; // the diff matching the working tree right now
  let combinedWith = null; // the existing entry whose patch this diff now contains
  const patchDir = path.join(runDir, 'learned-skills');
  try {
    let id;
    let patchFile;
    let record;
    if (existing) {
      // The tree was reverted after the earlier capture, so this edit sits on HEAD alone. Put the
      // earlier patch back on top, so the patch file holds the file's whole working-tree change.
      let combined = false;
      if (tracked) {
        try { git(['apply', '--', existing.patch]); combined = true; } catch { combined = false; }
      }
      if (!combined) throw new Error(`could not join the earlier captured patch (${existing.id}) with this edit`);
      combinedWith = existing;
      workDiff = toBuffer(git([
        '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff',
        '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', rel,
      ], { encoding: 'buffer' }));
      id = existing.id;
      patchFile = existing.patch;
      record = existing;
    } else {
      id = nextId(manifest);
      patchFile = path.join(patchDir, `${id}.patch`);
      record = { id, target: rel, summary: note, patch: patchFile, status: 'captured' };
    }

    deps.mkdir(patchDir);
    deps.writeFile(patchFile, workDiff);

    // Revert: a path in HEAD is checked out again; a new file leaves the index and the disk.
    if (tracked) {
      git(['checkout', 'HEAD', '--', rel]);
    } else {
      git(['rm', '--cached', '--quiet', '--', rel]);
      if (deps.lstatType(abs).type !== 'missing') deps.unlink(abs);
      pruneEmptyParents(abs, worktree, deps);
    }
    if (statusOf()) throw new Error('revert left residue');

    if (!existing) writeManifest(runDir, [...manifest, record]);
    return { route: 'captured', id, patch: patchFile, shared: Boolean(existing) };
  } catch (err) {
    return stageFallback({
      err, deps, runDir, worktree, rel, note, manifest, existing: combinedWith, diff: workDiff, tracked, statusOf,
    });
  }
}

// An emptied directory left by deleting a new file is removed up to (never including) the worktree.
function pruneEmptyParents(abs, worktree, deps) {
  let dir = path.dirname(abs);
  const root = path.resolve(worktree);
  while (path.resolve(dir) !== root && isAncestorOrSelf(root, path.resolve(dir))) {
    try { deps.rmdir(dir); } catch { return; }
    dir = path.dirname(dir);
  }
}

// Puts the target back at HEAD (the edit is about to live in staged/ instead), then stages it.
function stageFallback({ err, deps, runDir, worktree, rel, note, manifest, existing, diff, tracked, statusOf }) {
  const git = (args, opts) => deps.git(['-C', worktree, ...args], opts);
  const abs = path.join(worktree, rel);
  let residue = false;
  try {
    if (statusOf()) {
      // The tree holds HEAD + this diff, or part of the revert ran: undo the diff, then settle the rest.
      try { git(['apply', '-R', '-'], { input: diff }); } catch { /* fall through to the per-kind undo */ }
      if (!tracked) {
        try { git(['rm', '--cached', '--quiet', '--', rel]); } catch { /* best effort */ }
        try { if (deps.lstatType(abs).type !== 'missing') deps.unlink(abs); } catch { /* best effort */ }
      } else if (statusOf()) {
        try { git(['restore', '--source=HEAD', '--staged', '--worktree', '--', rel]); } catch { /* best effort */ }
      }
    }
    residue = Boolean(statusOf());
  } catch {
    residue = true;
  }

  const reason = `capture failed: ${errText(err)}`;
  const staged = stageEntry({ runDir, worktree, entry: { target: rel, summary: note, patch: diff }, reason }, deps);

  // Record the outcome. A joined earlier capture is superseded by the staged superset.
  const entries = manifest.map((e) => (existing && e.id === existing.id
    ? { ...e, status: 'staged', stagePath: staged.stagePath, reason }
    : e));
  if (!existing) {
    entries.push({
      id: nextId(manifest), target: rel, summary: note, patch: '', status: 'staged', stagePath: staged.stagePath, reason,
    });
  }
  try { writeManifest(runDir, entries); } catch { /* the staged file and the log line are the record */ }

  const out = { route: 'staged', stagePath: staged.stagePath, reason };
  if (residue) out.residue = true;
  return out;
}

module.exports = {
  UsageError, realDeps, readManifest, writeManifest, manifestPath, nextId, normalizeTarget, skillLabel,
  stageEntry, capture, LOG_SECTION, STEP,
};
