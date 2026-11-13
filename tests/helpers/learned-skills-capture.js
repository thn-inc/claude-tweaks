'use strict';
// Shared fixtures for the learned-skills capture suites (#5290): tests/bin-lib/learned-skills/
// capture.test.js and the fault-matrix files beside it (one per scenario kind, so node --test runs
// them in parallel). The matrix machinery lives here once; each matrix file only registers a kind.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { capture, readManifest, realDeps, StagingFailure } = require('../../plugin/bin/lib/learned-skills/learned-skills.js');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const X = '.claude/skills/x/SKILL.md';

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

// A repo with one commit holding x/SKILL.md, a run dir under .claude-tweaks/pipelines, a merge base.
function fixture(t, extraFiles = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-capture-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  sh(repo, ['init', '-q']);
  write(repo, X, '# x\n\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n');
  for (const [rel, text] of Object.entries(extraFiles)) write(repo, rel, text);
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'base']);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-11-13T000000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  return { repo, runDir, mergeBase: sh(repo, ['rev-parse', 'HEAD']).trim() };
}

const status = (repo, rel) => sh(repo, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', rel]);
const args = (f, target, summary = 'adds a note') => ({
  runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, target, summary,
});

const baseDeps = { now: () => Date.UTC(2026, 10, 13, 12, 0, 0) };
const diffOf = (repo, rel) => sh(repo, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', rel]);

// --- The durability invariant, under injected faults ---------------------------------------------
//
// From the diff read until capture returns, the whole change (in a join: the earlier captured edit
// plus this one) is held complete in the tree, a learned-skills/ patch, or a staged/ file, and the
// outcome names a place that holds it. Every fault point capture's fallback can hit is enumerated
// below; each combination runs against a real repo with the faults injected through deps.
// A '-partial' write leaves half the bytes and throws; a '-silent' write leaves half and returns
// normally, so only a re-read can tell.

const TOP = (b) => b.replace('# x\n', '# x\nfirst edit near the top\n');
const BOTTOM = (b) => b + 'second edit at the bottom\n';

// kind: 'tracked' (an edit to X), 'untracked' (a new Y), 'joined' (X captured once, then edited again).
// Each kind is built once; every combination runs on a fresh copy of it.
const templates = new Map();
const templateCleanups = [];
after(() => { for (const fn of templateCleanups) fn(); });

function scenario(t, kind) {
  if (!templates.has(kind)) {
    const tpl = buildScenario({ after: (fn) => templateCleanups.push(fn) }, kind);
    // git needs no sample hooks; dropping them halves what every copy below has to copy.
    fs.rmSync(path.join(tpl.f.repo, '.git', 'hooks'), { recursive: true, force: true });
    templates.set(kind, tpl);
  }
  const tpl = templates.get(kind);
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-matrix-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.cpSync(tpl.f.repo, repo, { recursive: true });
  const rebase = (p) => path.join(repo, path.relative(tpl.f.repo, p));
  const s = { ...tpl, f: { repo, runDir: rebase(tpl.f.runDir), mergeBase: tpl.f.mergeBase } };
  if (tpl.existingPatch) {
    s.existingPatch = rebase(tpl.existingPatch);
    const m = readManifest(s.f.runDir).map((e) => ({ ...e, patch: rebase(e.patch) }));
    fs.writeFileSync(path.join(s.f.runDir, 'learned-skills', 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  }
  return s;
}

function buildScenario(t, kind) {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  const s = { f, kind, joined: kind === 'joined', head: sh(f.repo, ['rev-parse', 'HEAD']).trim() };
  if (kind === 'untracked') {
    s.target = '.claude/skills/y/SKILL.md';
    write(f.repo, s.target, '# y\n\nbrand new\n');
    sh(f.repo, ['add', '-N', '--', s.target]);
    s.C = Buffer.from(diffOf(f.repo, s.target));
    sh(f.repo, ['rm', '--cached', '--quiet', '--', s.target]);
    s.D = s.C;
    s.full = Buffer.from('# y\n\nbrand new\n');
    s.start = s.full;
    s.headBytes = null;
    return s;
  }
  s.target = X;
  s.headBytes = Buffer.from(body);
  if (kind === 'tracked') {
    write(f.repo, X, BOTTOM(body));
    s.C = Buffer.from(diffOf(f.repo, X));
    s.D = s.C;
    s.full = Buffer.from(BOTTOM(body));
    s.start = s.full;
    return s;
  }
  write(f.repo, X, BOTTOM(TOP(body)));
  s.C = Buffer.from(diffOf(f.repo, X));
  s.full = Buffer.from(BOTTOM(TOP(body)));
  write(f.repo, X, BOTTOM(body));
  s.D = Buffer.from(diffOf(f.repo, X));
  write(f.repo, X, TOP(body));
  const first = capture(args(f, X, 'first finding'), baseDeps);
  assert.equal(first.route, 'captured');
  s.existingPatch = first.patch;
  s.P1 = fs.readFileSync(first.patch);
  write(f.repo, X, BOTTOM(body));
  s.start = Buffer.from(BOTTOM(body));
  return s;
}

const WRITES = ['patch-write', 'patch-write-partial', 'patch-write-silent', 'staged-write', 'staged-write-partial', 'staged-write-silent'];
const POINTS = {
  tracked: [...WRITES, 'checkout', 'promote', 'manifest', 'gate', 're-apply', 'reverse-apply'],
  untracked: [...WRITES, 'rm-cached', 'unlink', 'promote', 'manifest', 'gate', 're-apply', 'reverse-apply'],
  joined: [...WRITES, 'checkout', 'join-apply', 're-diff', 'promote', 'restore-earlier', 'manifest', 'gate', 're-apply', 'reverse-apply'],
};
// One write cannot fail two ways at once.
const EXCLUSIVE = [
  ['patch-write', 'patch-write-partial'], ['patch-write', 'patch-write-silent'], ['patch-write-partial', 'patch-write-silent'],
  ['staged-write', 'staged-write-partial'], ['staged-write', 'staged-write-silent'], ['staged-write-partial', 'staged-write-silent'],
];
// Chains named in review, run whatever the sampling picks.
const CHAINS = {
  tracked: [
    ['patch-write-partial', 'staged-write', 're-apply'],
    ['patch-write-partial', 'checkout', 'staged-write', 're-apply'],
    ['checkout', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply'],
    ['manifest', 'staged-write', 're-apply'],
    ['patch-write', 'gate', 're-apply'],
    ['checkout', 'reverse-apply', 'staged-write', 're-apply'],
  ],
  untracked: [
    ['rm-cached', 'staged-write', 're-apply'],
    ['unlink', 'reverse-apply', 'staged-write'],
    ['patch-write-partial', 'rm-cached', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply'],
  ],
  joined: [
    ['checkout', 'staged-write', 're-apply'],
    ['checkout', 'staged-write', 're-apply', 'restore-earlier'],
    ['promote', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply', 'restore-earlier'],
    ['re-diff', 'reverse-apply'],
    ['re-diff', 'reverse-apply', 'staged-write'],
    ['re-diff', 'staged-write', 're-apply'],
    ['patch-write-partial', 'checkout', 'staged-write', 're-apply'],
    ['patch-write', 'gate', 're-apply'],
    ['join-apply', 'staged-write', 're-apply'],
    // The copy fails while the tree holds both edits: it must not be reverted.
    ['patch-write', 'staged-write', 're-apply'],
    ['patch-write-partial', 'staged-write', 're-apply'],
    ['patch-write-silent', 'staged-write', 're-apply'],
    ['patch-write-silent', 'staged-write-silent', 're-apply'],
  ],
};
// Silent writes: only a re-read can tell the pending copy or the staged file was not written whole.
CHAINS.tracked.push(
  ['patch-write-silent', 'staged-write', 're-apply'], ['patch-write-silent', 'gate', 're-apply'],
  ['patch-write', 'staged-write-silent', 're-apply'],
);
CHAINS.untracked.push(['patch-write-silent', 'staged-write', 're-apply'], ['patch-write', 'staged-write-silent', 're-apply']);
CHAINS.joined.push(['patch-write', 'staged-write-silent', 're-apply']);

// Gate-path points, run in the chains part only. A gate rewrite happens only after a main-path
// failure (to reach staging) AND a failed check, so no pair can reach one: in a pair these points
// never fire, and a fault that never fires leaves the run identical to the run without it.
//   gate-once              the first `apply --check` fails, later ones are real
//   staged-rewrite-silent  a rewrite of an existing staged file leaves half the bytes, returns normally
//   staged-rewrite-partial ... leaves half and throws
//   staged-rewrite-mangle  ... keeps the diff whole but drops the preamble's Invariant line
const GATE_POINTS = ['gate-once', 'staged-rewrite-silent', 'staged-rewrite-partial', 'staged-rewrite-mangle'];
// The main-path failure that reaches staging with a copy of exactly this edit (in a join, only the
// 'separate' route has one: the joined copy holds both edits).
const PRIMARY = { tracked: 'checkout', untracked: 'rm-cached', joined: 'join-apply' };
for (const kind of Object.keys(CHAINS)) {
  const p = PRIMARY[kind];
  CHAINS[kind].push(
    // An exact copy exists: description-only may be written, and must read back whole.
    [p, 'gate', 'staged-rewrite-silent'],
    [p, 'gate', 'staged-rewrite-partial'],
    // The recompose passes the re-check, but the rewrite is not what was confirmed.
    [p, 'gate-once', 'staged-rewrite-mangle'],
    [p, 'gate-once'],
    // No copy but the staged file: the gate must not rewrite it.
    ['patch-write', 'gate', 'staged-rewrite-silent', 're-apply'],
    ['patch-write', 'gate', 'staged-rewrite-partial', 're-apply'],
  );
}

function combos(points, k) {
  const out = [];
  const rec = (from, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let i = from; i < points.length; i++) rec(i + 1, [...acc, points[i]]);
  };
  rec(0, []);
  return out.filter((c) => !EXCLUSIVE.some(([a, b]) => c.includes(a) && c.includes(b)));
}

// Deterministic sample (mulberry32), so a red combination reproduces.
function sample(list, n, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...list];
  const picked = [];
  while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return picked;
}

function faultyDeps(s, faults, fired) {
  const ls = path.join(s.f.runDir, 'learned-skills');
  const staged = path.join(s.f.runDir, 'staged');
  const abs = path.join(s.f.repo, s.target);
  const has = (n) => faults.includes(n);
  const boom = (n) => { fired.add(n); return Object.assign(new Error(`injected ${n}`), { stderr: `fatal: injected ${n}\n` }); };
  const half = (d) => { const b = Buffer.isBuffer(d) ? d : Buffer.from(String(d)); return b.subarray(0, Math.floor(b.length / 2)); };
  const writer = (real, exclusive) => (p, d) => {
    const inLs = path.dirname(p) === ls && p.endsWith('.patch');
    const inStaged = path.dirname(p) === staged;
    // A rewrite of a staged file that already exists (the gate's recompose or description-only write).
    if (inStaged && !exclusive && fs.existsSync(p)) {
      if (has('staged-rewrite-partial')) { fs.writeFileSync(p, half(d)); throw boom('staged-rewrite-partial'); }
      if (has('staged-rewrite-silent')) { fired.add('staged-rewrite-silent'); fs.writeFileSync(p, half(d)); return undefined; }
      if (has('staged-rewrite-mangle')) {
        // The diff stays whole (so a check still passes); the preamble loses its Invariant line.
        fired.add('staged-rewrite-mangle');
        fs.writeFileSync(p, String(Buffer.isBuffer(d) ? d.toString('utf8') : d).replace(/^Invariant: .*\n/m, ''));
        return undefined;
      }
    }
    if (s.existingPatch && p === s.existingPatch && has('restore-earlier')) throw boom('restore-earlier');
    if (path.basename(p) === 'manifest.json' && has('manifest')) throw boom('manifest');
    for (const [where, n] of [[inLs, 'patch-write'], [inStaged, 'staged-write']]) {
      if (!where) continue;
      if (has(n)) throw boom(n);
      if (exclusive && fs.existsSync(p)) continue; // the real call reports EEXIST
      if (has(`${n}-partial`)) {
        fs.writeFileSync(p, half(d));
        throw boom(`${n}-partial`);
      }
      if (has(`${n}-silent`)) {
        fired.add(`${n}-silent`);
        fs.writeFileSync(p, half(d));
        return undefined;
      }
    }
    return real(p, d);
  };
  let diffs = 0;
  let checks = 0;
  return {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('--binary') && ++diffs === 2 && has('re-diff')) throw boom('re-diff');
      if (a.includes('checkout') && has('checkout')) throw boom('checkout');
      if (a.includes('rm') && a.includes('--cached') && has('rm-cached')) throw boom('rm-cached');
      // joinPlan's `apply --check -R` probe (does the tree already hold the earlier edit?) runs on real
      // git with no fault: were it to absorb a fault, a point reachable only through the probe would
      // still count as fired, and the "fault points that never fired" check could not see the real
      // reverse-apply path go unexercised.
      if (a.includes('apply') && a.includes('--check') && a.includes('-R')) return realDeps.git(a, o);
      if (a.includes('apply')) {
        if (a.includes('--check')) {
          if (has('gate')) throw boom('gate');
          if (++checks === 1 && has('gate-once')) throw boom('gate-once');
        }
        else if (a.includes('-R')) { if (has('reverse-apply')) throw boom('reverse-apply'); }
        else if (a[a.length - 1] === '-') { if (has('re-apply')) throw boom('re-apply'); }
        else if (has('join-apply')) throw boom('join-apply');
      }
      return realDeps.git(a, o);
    },
    writeFile: writer(realDeps.writeFile, false),
    writeFileExclusive: writer(realDeps.writeFileExclusive, true),
    unlink: (p) => { if (p === abs && has('unlink')) throw boom('unlink'); return realDeps.unlink(p); },
    rename: (a, b) => { if (has('promote')) throw boom('promote'); return realDeps.rename(a, b); },
  };
}

// Every invariant breach for one finished run, as text ([] = sound).
function breaches(s, res, err) {
  const out = [];
  const abs = path.join(s.f.repo, s.target);
  const ls = path.join(s.f.runDir, 'learned-skills');
  const stagedDir = path.join(s.f.runDir, 'staged');
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
  const bytes = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const diffBlock = (p) => { const b = fs.readFileSync(p); const i = b.indexOf('diff --git'); return i < 0 ? null : b.subarray(i); };
  const eq = (a, b) => a !== null && b !== null && a.equals(b);
  const tree = bytes(abs);
  let manifest = [];
  try { manifest = readManifest(s.f.runDir); } catch (e) { out.push(`manifest unreadable: ${e.message}`); }
  const earlier = s.joined ? manifest.find((e) => e.id === '1') : null;
  const earlierBytes = s.joined ? bytes(s.existingPatch) : null;
  // In a join whose earlier capture still holds the earlier edit alone, this call answers for its own edit.
  const split = Boolean(s.joined && earlier && earlier.status === 'captured' && eq(earlierBytes, s.P1));
  const want = split ? s.D : s.C;
  const holdsFile = (p) => eq(bytes(p), want) || eq(bytes(p), s.C);
  const holdsStaged = (p) => fs.existsSync(p) && (eq(diffBlock(p), want) || eq(diffBlock(p), s.C));
  const treeHolds = eq(tree, s.full) || (split && eq(tree, s.start));
  const lsFiles = list(ls).filter((n) => n !== 'manifest.json').map((n) => path.join(ls, n));
  const stagedFiles = list(stagedDir).map((n) => path.join(stagedDir, n));

  // (a) a durable place holds the whole change.
  if (!(treeHolds || lsFiles.some(holdsFile) || stagedFiles.some(holdsStaged))) out.push('(a) no durable place holds the whole change');
  if (s.joined && !(eq(earlierBytes, s.P1) || eq(earlierBytes, s.C))) out.push('(a) the earlier captured patch file was damaged');

  // (b) the outcome names a place that holds it.
  if (err) {
    if (!(err instanceof StagingFailure)) out.push(`(b) threw a non-StagingFailure: ${err.message}`);
    else if (err.holder === 'tree') {
      if (!/in the working tree/.test(err.message)) out.push('(b) holder tree, but the message does not say so');
      if (!(eq(tree, s.start) || (s.joined && eq(tree, s.full)))) out.push('(b) message names the tree, which does not hold the edit');
      if (err.restored !== true) out.push('(b) holder tree but restored is not true');
    } else if (typeof err.holder === 'string') {
      if (!err.message.includes(err.holder)) out.push('(b) the holder path is not in the message');
      if (!holdsFile(err.holder)) out.push(`(b) the named file does not hold the edit: ${err.holder}`);
    } else {
      out.push(`(b) the error names no holder: ${err.message}`);
    }
  } else if (res.route === 'captured') {
    if (!eq(bytes(res.patch), s.C)) out.push('(b) captured, but the patch does not hold the whole change');
    if (s.joined && res.patch !== s.existingPatch) out.push('(b) a joined capture moved to a new patch file');
    if (s.headBytes === null ? tree !== null : !eq(tree, s.headBytes)) out.push('(b) captured, but the tree is not back at HEAD');
  } else if (res.route === 'staged') {
    if (res.patch) { if (!holdsFile(res.patch)) out.push('(b) staged result names a patch that does not hold the edit'); }
    else if (!holdsStaged(res.stagePath)) out.push('(b) the staged file named does not hold the edit');
  } else {
    out.push(`(b) unexpected route ${res.route}`);
  }

  // (c) no partial or duplicate proposal in staged/.
  if (err || (res && res.route === 'captured')) {
    if (stagedFiles.length) out.push(`(c) staged/ is not empty: ${stagedFiles.map((p) => path.basename(p)).join(', ')}`);
  } else if (res && res.route === 'staged') {
    if (stagedFiles.length !== 1 || stagedFiles[0] !== res.stagePath) out.push(`(c) staged/ holds ${stagedFiles.length} files`);
    for (const p of stagedFiles) {
      const block = diffBlock(p);
      // A description-only stage is the whole preamble, and only with a named patch beside it; a
      // stage with a diff carries the whole preamble ahead of it.
      const text = fs.readFileSync(p, 'utf8');
      const wholeDescription = /^Target: .*\nInvariant: .*\nFinding: .*\nStaged-at: .*\n\n$/.test(text);
      const wholePreamble = /^Target: .*\nInvariant: .*\nFinding: .*\nStaged-at: .*\n\ndiff --git /.test(text);
      if (block === null ? !(res.patch && wholeDescription) : !(holdsStaged(p) && wholePreamble)) out.push(`(c) partial proposal ${path.basename(p)}`);
    }
  }
  if (split && stagedFiles.some((p) => eq(diffBlock(p), s.C))) out.push('(c) the earlier edit is both captured and staged');

  // No unnamed copy left in learned-skills/ (no new pending pile).
  const named = new Set([...manifest.map((e) => e.patch), res && res.patch, err && err.holder].filter(Boolean));
  for (const p of lsFiles) if (!named.has(p)) out.push(`unnamed leftover ${path.basename(p)}`);
  if (headOf(s.f.repo) !== s.head) out.push('a commit was made');
  return out;
}

// HEAD's commit id read from .git directly (one git spawn fewer per combination).
function headOf(repo) {
  const ref = fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8').trim();
  return ref.startsWith('ref: ') ? fs.readFileSync(path.join(repo, '.git', ref.slice(5)), 'utf8').trim() : ref;
}

function runMatrix(t, kind, list) {
  const fired = new Set();
  const red = [];
  for (const faults of list) {
    const s = scenario(t, kind);
    let res;
    let err;
    try { res = capture(args(s.f, s.target, 'second finding'), faultyDeps(s, faults, fired)); } catch (e) { err = e; }
    const b = breaches(s, res, err);
    if (b.length) red.push(`${kind} [${faults.join(', ') || 'no faults'}]: ${b.join('; ')}`);
  }
  return { red, fired };
}

// The kind's combinations, by part:
//   'chains' — no fault, every single, the named chains, seeded samples of triples and four-way.
//   'pairs'  — every pair; { shard: i, of: n } takes every n-th pair from the i-th (1-based), so one
//              kind's pairs can run as n files in parallel.
function matrixList(kind, part, { shard = 1, of = 1 } = {}) {
  const P = POINTS[kind];
  if (part === 'chains') {
    return [[], ...combos(P, 1), ...CHAINS[kind], ...sample(combos(P, 3), 20, 5290), ...sample(combos(P, 4), 12, 4)];
  }
  return combos(P, 2).filter((_, i) => i % of === shard - 1);
}

// Registers one part of one kind's matrix as a test (one matrix file per part, so they run in parallel).
function registerMatrix(kind, part, shardOpts) {
  const P = POINTS[kind];
  const label = part === 'chains'
    ? 'no fault, every single, named chains, sampled triples and four-way faults'
    : `every pair${shardOpts ? ` (shard ${shardOpts.shard} of ${shardOpts.of})` : ''}`;
  test(`fault matrix (${kind}): ${label}`, (t) => {
    const { red, fired } = runMatrix(t, kind, matrixList(kind, part, shardOpts));
    assert.deepEqual(red, []);
    if (part === 'chains') {
      // Every point is reached somewhere in this part, so the matrix exercises it.
      assert.deepEqual([...P, ...GATE_POINTS].filter((p) => !fired.has(p) && p !== 'restore-earlier'), [], 'fault points that never fired');
    }
    // The earlier captured patch is never rewritten in place: that step no longer exists.
    assert.equal(fired.has('restore-earlier'), false);
  });
}

module.exports = {
  ENV, X, sh, write, fixture, status, args, baseDeps, diffOf, TOP, BOTTOM, registerMatrix,
};
