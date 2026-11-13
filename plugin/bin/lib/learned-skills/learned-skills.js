// plugin/bin/lib/learned-skills/learned-skills.js — moves a wrap-up Skills-row edit off the run
// branch (#5290). Wrap-up's Skills row used to commit an auto-applied skill edit on the run's own
// branch, which makes merge-check refuse the record's auto-merge. `capture` turns one such
// working-tree edit into a patch file in the run dir and reverts it in the worktree; a later verb
// lands the patches as a separate learned-skills PR (or `stageEntry` parks one for the console).
//
// Failure contract: a failure BEFORE the diff was read (git unavailable, no HEAD, a bad target)
// throws, and nothing was changed. A failure AFTER it (patch write, revert, residue check,
// manifest write) puts the tree back at HEAD for the target and stages the edit through the
// staging writer, returning { route: 'staged', ... } — never committed on the run branch. When
// staging cannot hold the edit either, it is put back in the working tree (StagingFailure,
// restored: true), or else the confirmed patch copy that holds it is named (restored: false).
//
// Durability invariant (capture): from the diff read until return, the target's whole working-tree
// change — in a join, the earlier captured edit plus this one — is held complete in at least one
// durable place: the working tree, a patch file under learned-skills/, or a staged file under
// staged/. A copy counts only once a re-read of it matches byte for byte. The tree is reset only
// after a copy outside it is confirmed; a superseded copy is removed only after the final home is
// confirmed; the earlier captured patch file is never rewritten in place, only replaced by an
// atomic rename of a confirmed copy as the last step. Every outcome names a place that holds it.
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

// A failure after the diff was read that staging could not absorb either: the edit is in the working
// tree (restored: true) or is not, and `holder` is the absolute path of the confirmed patch copy
// that holds it (restored: false). The message names the same place. Never "nothing changed".
class StagingFailure extends Error {
  constructor(message, { restored, holder }) {
    super(message);
    this.restored = restored;
    this.holder = holder;
  }
}

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
  rename: (from, to) => fs.renameSync(from, to),
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

// `io` (mkdir, writeFile) defaults to the real fs; capture passes its deps so the write is injectable.
function writeManifest(runDir, entries, io = realDeps) {
  const file = manifestPath(runDir);
  io.mkdir(path.dirname(file));
  io.writeFile(file, JSON.stringify(entries, null, 2) + '\n');
  return file;
}

function nextId(entries) {
  const max = entries.reduce((m, e) => Math.max(m, Number.parseInt(e.id, 10) || 0), 0);
  return String(max + 1);
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// `{first stderr line}`: the first non-empty line of the child's stderr, else the message's first line
// (execFileSync's message is "Command failed: git -C /abs/… " — an absolute path and the full argv).
function firstStderrLine(e) {
  const lines = (s) => String(s == null ? '' : s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines(e && e.stderr)[0] || lines(e && e.message)[0] || String(e);
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
// The stacked check (bin/check-staged-stack.js) is NOT run: it accepts only staged/*.patch, while
// the spec fixes this artifact's name as staged/wrap-up-skill-{N}.md, so it could never report a
// verdict against it.
// entry: { target, summary, patch: Buffer|string, patchFile?: string }.
function stageEntry({ runDir, worktree, entry, reason }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const st = writeStage({ runDir, worktree, entry }, deps);
  let g;
  try {
    g = gateStage(st, entry, worktree, deps);
  } catch (err) {
    // No half-written proposal stays behind: the caller treats a throw as "nothing staged".
    removeQuiet(deps, st.stagePath);
    throw err;
  }
  const logFailed = logStaged({
    runDir, deps, target: st.target, summary: st.summary, reason, gate: g.gate, note: g.note, stageName: st.name,
  });
  return { stagePath: st.stagePath, gate: g.gate, logFailed };
}

// Creates staged/wrap-up-skill-{N}.md holding the preamble and entry.patch. Exclusive create, so two
// writers racing for one N cannot overwrite each other; a create that dies partway is removed.
function writeStage({ runDir, worktree, entry }, deps) {
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
  let n = nextStageNumber(stagedDir, deps);
  for (;;) {
    const stagePath = path.join(stagedDir, `wrap-up-skill-${n}.md`);
    try {
      deps.writeFileExclusive(stagePath, compose(entry.patch));
      return { stagePath, name: `wrap-up-skill-${n}.md`, preamble, compose, target, summary };
    } catch (err) {
      if (err && err.code === 'EEXIST') { n += 1; continue; }
      removeQuiet(deps, stagePath);
      throw err;
    }
  }
}

// The Staging-time gate: { gate: 'ok' | 'unvalidated' | 'description-only', note }. With
// mayDegrade false a twice-failed check returns { gate: null } and leaves the full diff in place,
// for a caller whose staged file is the only copy of the patch outside the working tree.
function gateStage(st, entry, worktree, deps, { mayDegrade = true } = {}) {
  const check = () => {
    try { deps.git(['-C', worktree, 'apply', '--check', st.stagePath]); return { ok: true }; } catch (err) {
      return { ok: false, text: firstStderrLine(err) };
    }
  };
  let probe = check();
  if (probe.ok) return { gate: 'ok', note: '' };
  try { deps.readFile(st.stagePath); } catch { return { gate: 'unvalidated', note: probe.text }; }
  // Recompose once from the patch file the diff was captured to.
  let again = toBuffer(entry.patch);
  if (entry.patchFile) { try { again = deps.readFile(entry.patchFile); } catch { /* keep the bytes in hand */ } }
  deps.writeFile(st.stagePath, st.compose(again));
  probe = check();
  if (probe.ok) return { gate: 'ok', note: '' };
  if (!mayDegrade) return { gate: null, note: probe.text };
  deps.writeFile(st.stagePath, Buffer.from(st.preamble, 'utf8'));
  return { gate: 'description-only', note: probe.text };
}

// STAGED line in the shape the Global Constraints fix:
//   STAGED {time} — Skills row: skill update for {skill}/SKILL.md ({section}) could not ride a
//   learned-skills PR ({reason}); staged instead. Reversibility: high (stage path: staged/…).
// A gate degrade logs staged-patch.md's own line for it instead (finding = `{skill}/SKILL.md ({section})`).
function logStaged({ runDir, deps, target, summary, reason, gate, note, stageName }) {
  const finding = `${skillLabel(target)} (${summary})`;
  let line;
  if (gate === 'description-only') {
    line = formatEntry({
      status: 'STAGED',
      now: deps.now(),
      step: STEP,
      text: `${finding} — patch failed \`git apply --check\` at staging (${note}); staged description-only at staged/${stageName}`,
      reversibility: 'high',
    });
  } else if (gate === 'unvalidated') {
    line = formatEntry({
      status: 'STAGED',
      now: deps.now(),
      step: STEP,
      text: `${finding} — gate could not run: ${note} — path/anchoring problem, not a composition error`,
      reversibility: 'high',
    });
  } else {
    line = formatEntry({
      status: 'STAGED',
      now: deps.now(),
      step: STEP,
      text: `skill update for ${finding} could not ride a learned-skills PR (${oneLine(reason)}); staged instead`,
      reversibility: `high (stage path: staged/${stageName})`,
    });
  }
  try {
    deps.appendEntries({ runDir, items: [{ section: LOG_SECTION, entry: line }] });
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// capture

const diffArgs = (rel) => [
  '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff',
  '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', rel,
];

function removeQuiet(deps, p) {
  try { if (p && deps.lstatType(p).type !== 'missing') deps.unlink(p); } catch { /* best effort */ }
}

// Does the file at p hold exactly these bytes? A failed read is "no".
function fileHolds(deps, p, bytes) {
  try { return Boolean(p) && toBuffer(deps.readFile(p)).equals(bytes); } catch { return false; }
}

// The target's bytes in the working tree, or null when it is absent.
function readTree(deps, abs) {
  return deps.lstatType(abs).type === 'missing' ? null : toBuffer(deps.readFile(abs));
}

// The next free id: one above the manifest's highest that no file in learned-skills/ already uses
// (a leftover {id}.patch may be an earlier failure's named copy, never to be overwritten).
function allocateId(manifest, patchDir, deps) {
  let id = Number.parseInt(nextId(manifest), 10);
  while (deps.lstatType(path.join(patchDir, `${id}.patch`)).type !== 'missing') id += 1;
  return String(id);
}

// Writes bytes to a fresh file (exclusive create, never over an existing one) and confirms it by
// re-reading. Returns { path } or { err }; a file that could not be confirmed is removed, so an
// unconfirmed copy is never named as holding the edit.
function writeConfirmedCopy(dir, base, bytes, deps) {
  let p = null;
  try {
    deps.mkdir(dir);
    for (let n = 1; ; n++) {
      p = path.join(dir, n === 1 ? `${base}.patch` : `${base}-${n}.patch`);
      try { deps.writeFileExclusive(p, bytes); break; } catch (err) {
        if (err && err.code === 'EEXIST') { p = null; continue; }
        throw err;
      }
    }
    if (!fileHolds(deps, p, bytes)) throw new Error(`the patch copy did not read back intact: ${path.basename(p)}`);
    return { path: p };
  } catch (err) {
    removeQuiet(deps, p);
    return { err };
  }
}

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
  // Only a still-captured entry can be joined; a landed one already left in a commit.
  const existing = manifest.find((e) => e.target === rel && e.status === 'captured') || null;

  // Only whether the output is empty is read, never a path from it.
  const statusOf = () => String(deps.git(['-C', worktree, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', rel])).trimEnd(); // git-path-read: not a path list (emptiness only)
  const inHead = () => { try { git(['cat-file', '-e', `HEAD:${rel}`]); return true; } catch { return false; } };

  // 2. Nothing changed: the audit's clean-path case, or a target already captured in this run.
  const before = statusOf();
  if (!before) {
    if (!existing) return { route: 'clean' };
    return { route: 'captured', id: existing.id, patch: existing.patch, shared: true };
  }

  // 3. Read the tree and the diff. An untracked file first becomes intent-to-add, so it diffs as new.
  const tracked = inHead();
  let addedIntent = false;
  let diff;
  let start;
  try {
    start = readTree(deps, abs);
    if (!tracked) { git(['add', '-N', '--', rel]); addedIntent = true; }
    diff = toBuffer(git(diffArgs(rel), { encoding: 'buffer' }));
  } catch (err) {
    if (addedIntent) { try { git(['rm', '--cached', '--quiet', '--', rel]); } catch { /* best effort */ } }
    throw err;
  }
  if (diff.length === 0) {
    if (addedIntent) { try { git(['rm', '--cached', '--quiet', '--', rel]); } catch { /* best effort */ } }
    return existing ? { route: 'captured', id: existing.id, patch: existing.patch, shared: true } : { route: 'clean' };
  }

  // From here the diff is in hand: no failure throws without naming where the edit is.
  const cx = {
    deps, git, worktree, runDir, rel, abs, tracked, statusOf, manifest, note, existing,
    D: diff, start, patchDir: path.join(runDir, 'learned-skills'),
  };
  // plan: { mode, C: the whole change as a patch, full: the tree bytes that hold it }.
  const plan = existing ? joinPlan(cx) : { mode: 'new', C: diff, full: start };
  if (plan.mode === 'stuck') {
    throw new StagingFailure(`capture failed: ${plan.reason}; ${bothInTree(existing)}`, { restored: true, holder: 'tree' });
  }
  cx.id = plan.mode === 'join' ? existing.id : allocateId(manifest, cx.patchDir, deps);

  // 4. A confirmed copy outside the tree, before the tree is touched.
  const copy = writeConfirmedCopy(cx.patchDir, `${cx.id}.pending`, plan.C, deps);
  let L = copy.path || null;
  let failure = plan.mode === 'separate' ? new Error(plan.reason) : copy.err;
  if (!failure) {
    try {
      // 5. Revert: a path in HEAD is checked out again; a new file leaves the index and the disk.
      if (tracked) {
        git(['checkout', 'HEAD', '--', rel]);
      } else {
        git(['rm', '--cached', '--quiet', '--', rel]);
        if (deps.lstatType(abs).type !== 'missing') deps.unlink(abs);
        pruneEmptyParents(abs, worktree, deps);
      }
      if (statusOf()) throw new Error('revert left residue');
      // 6. Promote the confirmed copy to its final name (an atomic rename: it either moved or it did
      //    not). In a join that replaces the earlier patch with the superset — the last step.
      const final = plan.mode === 'join' ? existing.patch : path.join(cx.patchDir, `${cx.id}.patch`);
      if (plan.mode !== 'join' && deps.lstatType(final).type !== 'missing') throw new Error(`${path.basename(final)} already exists`);
      deps.rename(L, final);
      L = final;
      if (plan.mode === 'new') {
        writeManifest(runDir, [...manifest, { id: cx.id, target: rel, summary: note, patch: final, status: 'captured' }], deps);
      }
      return { route: 'captured', id: cx.id, patch: final, shared: plan.mode === 'join' };
    } catch (err) {
      failure = err;
    }
  }
  return fallback(cx, plan, L, failure);
}

// The earlier capture was reverted, so this edit sits on HEAD alone. Put the earlier patch back on
// top, so one patch holds the file's whole change. When that cannot be done, this edit is staged
// on its own ('separate') and the earlier one stays captured, untouched.
function joinPlan(cx) {
  const { deps, git, existing } = cx;
  const separate = (why) => ({
    mode: 'separate', C: cx.D, full: cx.start,
    reason: `could not join the earlier captured patch (${existing.id}) with this edit: ${why}`,
  });
  if (!cx.tracked) return separate('the target is a new file');
  try { git(['apply', '--', existing.patch]); } catch (err) { return separate(firstStderrLine(err)); }
  let full = null;
  try {
    full = readTree(deps, cx.abs);
    return { mode: 'join', C: toBuffer(git(diffArgs(cx.rel), { encoding: 'buffer' })), full };
  } catch (err) {
    // Undo the join, so the tree holds this edit alone again.
    try { git(['apply', '-R', '--', existing.patch]); } catch { /* judged below */ }
    if (treeHolds(cx, cx.start)) return separate(firstStderrLine(err));
    return { mode: 'stuck', reason: `could not read the joined diff (${firstStderrLine(err)}) and could not undo the join` };
  }
}

const bothInTree = (existing) => `the edit is in the working tree together with the earlier captured patch ${existing.id} (${existing.patch}), which stays captured as well, so the earlier edit is in both (not staged) — commit the tree on the run branch`;

function treeHolds(cx, bytes) {
  try {
    const now = readTree(cx.deps, cx.abs);
    return bytes === null ? now === null : now !== null && now.equals(bytes);
  } catch {
    return false;
  }
}

// The target matches HEAD by content (a leftover intent-to-add entry is index residue, not content).
function atHead(cx) {
  try {
    if (!cx.tracked) return cx.deps.lstatType(cx.abs).type === 'missing';
    return toBuffer(cx.git(diffArgs(cx.rel), { encoding: 'buffer' })).length === 0;
  } catch {
    return false;
  }
}

// Puts the target back at HEAD. Called only once a copy outside the tree is confirmed. Never throws.
function resetToHead(cx, plan) {
  const { git, deps } = cx;
  if (!atHead(cx)) {
    let held = null;
    if (treeHolds(cx, plan.full)) held = plan.C;
    else if (treeHolds(cx, cx.start)) held = cx.D;
    if (held) { try { git(['apply', '-R', '-'], { input: held }); } catch { /* the per-kind undo follows */ } }
  }
  if (!cx.tracked) {
    try { git(['rm', '--cached', '--quiet', '--', cx.rel]); } catch { /* not in the index, or residue */ }
    try { if (deps.lstatType(cx.abs).type !== 'missing') deps.unlink(cx.abs); } catch { /* judged below */ }
    pruneEmptyParents(cx.abs, cx.worktree, deps);
  } else if (!atHead(cx)) {
    try { git(['checkout', 'HEAD', '--', cx.rel]); } catch { /* judged below */ }
  }
  return atHead(cx);
}

// After a failure past the diff read. L: the confirmed copy under learned-skills/, or null.
// What is staged is this call's own edit (D). In a join the earlier capture is never touched: it
// keeps its patch file and its 'captured' entry, so no outcome can schedule the earlier edit twice
// (a staged superset would, whenever the manifest could not then be updated).
function fallback(cx, plan, L, failure) {
  const { deps, existing } = cx;
  const joined = plan.mode === 'join';
  const mine = cx.D;
  const reason = `capture failed: ${firstStderrLine(failure)}`;
  const entry = { target: cx.rel, summary: cx.note, patch: mine };
  const stageId = joined ? allocateId(cx.manifest, cx.patchDir, deps) : cx.id;
  const own = (p) => p && !(existing && p === existing.patch); // never the earlier capture's file
  const lExact = () => fileHolds(deps, L, mine); // L is a copy of exactly this edit
  const lHolds = () => lExact() || (joined && fileHolds(deps, L, plan.C)); // or of the joined superset
  let st = null; // the staged file, once written and confirmed
  const sHolds = () => Boolean(st) && fileHolds(deps, st.stagePath, st.compose(mine));
  const stage = () => {
    try { st = writeStage({ runDir: cx.runDir, worktree: cx.worktree, entry }, deps); } catch (err) { st = null; return err; }
    if (sHolds()) return null;
    removeQuiet(deps, st.stagePath);
    st = null;
    return new Error('the staged file did not read back intact');
  };
  const earlier = existing
    ? `; the earlier captured patch ${existing.id} (${existing.patch}) is unchanged and stays captured` : '';

  // Records a staged outcome. home: the staged file ('staged'), or L when it holds exactly this edit.
  const finish = (home, gate, note) => {
    let patch = '';
    if (home !== 'staged') {
      const final = path.join(cx.patchDir, `${stageId}.patch`);
      try {
        if (deps.lstatType(final).type !== 'missing') throw new Error('taken');
        deps.rename(L, final);
        L = final;
      } catch { /* L keeps its name */ }
      patch = L;
    }
    const logFailed = logStaged({
      runDir: cx.runDir, deps, target: st.target, summary: st.summary, reason, gate, note, stageName: st.name,
    });
    const entries = [...cx.manifest, {
      id: stageId, target: cx.rel, summary: cx.note, patch, status: 'staged', stagePath: st.stagePath, reason,
    }];
    try { writeManifest(cx.runDir, entries, deps); } catch { /* the staged file and the log line are the record */ }
    // Superseded copies go last, once the home is confirmed.
    if (home === 'staged' && own(L)) removeQuiet(deps, L);
    const out = { route: 'staged', stagePath: st.stagePath, reason };
    if (patch) out.patch = patch;
    let residue = true;
    try { residue = Boolean(cx.statusOf()); } catch { /* unreadable counts as residue */ }
    if (residue) out.residue = true;
    if (logFailed) out.logFailed = true;
    return out;
  };

  // Staging cannot be the home: put this call's edit back in the tree as this call found it (the
  // state before the call, the earlier capture included), else name the confirmed copy holding it.
  const settle = (why) => {
    const head = `${reason}; then ${why}`;
    const still = 'the edit is still in the working tree (not captured, not staged) — commit it on the run branch';
    let where = null;
    if (treeHolds(cx, cx.start)) {
      where = still + earlier;
    } else if (joined && treeHolds(cx, plan.full)) {
      try { cx.git(['apply', '-R', '--', existing.patch]); } catch { /* judged below */ }
      where = treeHolds(cx, cx.start) ? still + earlier : bothInTree(existing);
    } else if (atHead(cx)) {
      try { cx.git(['apply', '-'], { input: mine }); } catch { /* judged below */ }
      if (treeHolds(cx, cx.start)) where = `the edit was restored in the working tree (not captured, not staged) — commit it on the run branch${earlier}`;
    }
    if (where) {
      if (st) removeQuiet(deps, st.stagePath);
      if (own(L)) removeQuiet(deps, L);
      throw new StagingFailure(`${head}; ${where}`, { restored: true, holder: 'tree' });
    }
    if (lHolds()) {
      if (st) removeQuiet(deps, st.stagePath);
      const tail = lExact() ? earlier
        : `; it holds this edit together with the earlier captured patch ${existing.id} (${existing.patch}), which stays captured, so the earlier edit is in both`;
      throw new StagingFailure(`${head}; restoring the edit in the working tree failed too — it is not in the tree; recover it from ${L}${tail}`, { restored: false, holder: L });
    }
    // The staged file holds the whole diff, ungated: it is the home.
    if (sHolds()) return finish('staged', 'unvalidated', why);
    throw new StagingFailure(`${head}; no copy of the edit could be confirmed`, { restored: false, holder: null });
  };

  // 1. Before the tree is reset, a copy outside it must be confirmed: L, or the staged file itself.
  if (!L) {
    const err = stage();
    if (err) return settle(`staging failed (${firstStderrLine(err)})`);
  }
  // 2. The gate needs the tree at HEAD, and the edit must leave the run branch.
  if (!resetToHead(cx, plan)) return settle('the working tree could not be reset to HEAD, so the edit was not staged');
  if (!st) {
    const err = stage();
    if (err) return settle(`staging failed (${firstStderrLine(err)})`);
  }
  // 3. The gate. It may degrade to description-only only while L holds exactly this edit.
  const exact = lExact();
  let g;
  try {
    g = gateStage(st, { ...entry, patchFile: exact ? L : undefined }, cx.worktree, deps, { mayDegrade: exact });
  } catch (err) {
    if (lHolds()) { removeQuiet(deps, st.stagePath); st = null; }
    return settle(`staging failed (${firstStderrLine(err)})`);
  }
  if (g.gate === 'ok' && sHolds()) return finish('staged', 'ok', '');
  if ((g.gate === 'description-only' || g.gate === 'unvalidated') && lExact()) return finish(L, g.gate, g.note);
  return settle(`the staged patch failed \`git apply --check\` (${g.note || 'unconfirmed'})`);
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

module.exports = {
  UsageError, StagingFailure, realDeps, readManifest, writeManifest, manifestPath, nextId, normalizeTarget, skillLabel,
  stageEntry, capture, LOG_SECTION, STEP,
};
