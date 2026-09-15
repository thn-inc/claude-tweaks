// tests/curation-judge-stagepath.test.js — pins #675: a curation judge that stages a finding
// self-verifies the file at the ABSOLUTE anchored stagePath and echoes that path; a relative
// stagePath is a payload violation the controller rejects; and after every judged fan-out the
// engine sweeps the current worktree's shadow of the run-dir `staged/` path. #738 promoted that
// sweep from a bash snippet embedded in curation-engine.md §4 to `bin/hooks.js sweep-shadow`
// (bin/lib/hooks/sweep-shadow.js) — the probes below now exercise the verb directly (a real
// spawned CLI process, so the documented invocation is what this file actually runs) instead of
// spawning `bash -c` over an inline snippet copy.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipUnderRoot } = require('./helpers/root');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const ENGINE = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'curation-engine.md'), 'utf8');
const BATCH = fs.readFileSync(path.join(SKILLS, 'flow', 'multispec-batch-curation.md'), 'utf8');
const HOOKS_JS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

test('curation-engine.md §4 carries the judge self-verification step and the absolute-stagePath rule', () => {
  const s4 = ENGINE.slice(ENGINE.indexOf('## 4. Parallel dispatch'));
  assert.match(s4, /test -f/, 'judge self-verifies with test -f');
  assert.match(s4, /absolute/, 'names the absolute anchored path');
  assert.match(s4, /stagePath/, 'names the payload field');
  assert.match(s4, /re-prompt once/, 'controller re-prompts once on a relative stagePath');
  assert.match(s4, /unstaged/, 'then treats the finding as unstaged and surfaces it');
});

test('curation-engine.md §3 stagePath row requires the absolute anchored path and names the rejection', () => {
  const row = ENGINE.split('\n').find((l) => l.startsWith('| `findings[].stagePath` |'));
  assert.ok(row, 'stagePath contract row present');
  assert.match(row, /absolute/i);
  assert.match(row, /reject/i);
});

// #737: each consumer site words its citation naturally for its own sentence rather than
// pasting one reused literal phrase into two grammatically different slots (a category error —
// #737 review finding: a path being equated to an invariant reads wrong). Checking a set of
// short, independent, whitespace-normalized keywords is both grammar-agnostic and immune to
// this file's own line-wrapping (curation-engine.md keeps each paragraph as one physical line,
// but the check is written the same defensive way as its sibling in staged-patch-contract.test.js
// so both stay correct even if that changes).
const normWS = (s) => s.replace(/\s+/g, ' ');
function citesStagedFileInvariant(text) {
  const n = normWS(text);
  return n.includes('staged-file invariant')
    && n.includes('_shared/pipeline-run-dir.md')
    && n.includes('Anchoring section')
    && n.includes('single owner');
}

test('curation-engine.md §3/§4 cite the pipeline-run-dir.md staged-file invariant instead of restating it', () => {
  const row = ENGINE.split('\n').find((l) => l.startsWith('| `findings[].stagePath` |'));
  assert.ok(citesStagedFileInvariant(row), '§3 stagePath row cites the staged-file invariant');
  assert.ok(!row.includes('$RUN_ROOT/.claude-tweaks/pipelines/{run-id}'), '§3 row no longer restates the literal anchored path pattern');

  const s4 = ENGINE.slice(ENGINE.indexOf('## 4. Parallel dispatch'));
  const verifyPara = s4.slice(s4.indexOf('**Judge self-verification'), s4.indexOf('**Post-fan-out shadow sweep'));
  assert.ok(citesStagedFileInvariant(verifyPara), '§4 judge self-verification paragraph cites the staged-file invariant');
  assert.ok(!verifyPara.includes("lands in the worktree's *shadow* of `.claude-tweaks/pipelines/…`, not in the anchored run directory"), '§4 no longer restates the shadow-vs-anchored mechanism explanation');
  // Procedure-specific mentions of "absolute" (the ABS_STAGE_DIR self-verification instruction,
  // the payload-validation prose) are untouched by this task and must still be present.
  assert.match(verifyPara, /literal absolute/);
  assert.match(verifyPara, /absolute path spelled out/);
});

test('curation-engine.md §4 invokes the sweep-shadow verb, scoped to staged/ never work/', () => {
  const s4 = ENGINE.slice(ENGINE.indexOf('## 4. Parallel dispatch'));
  assert.match(s4, /bin\/hooks\.js"\s+sweep-shadow\s+--run\s+"\$PIPELINE_RUN_DIR"\s+--worktree\s+"\$WORKTREE"/, 'invokes the verb with --run/--worktree');
  assert.match(s4, /bin\/lib\/hooks\/sweep-shadow\.js/, 'names the implementation module');
  assert.doesNotMatch(s4, /RUN_ROOT=\$\(cd/, 'the inline bash fence is retired, not just supplemented');
  assert.match(s4, /shadow/i);
  assert.match(s4, /never `work\/`/, 'states the work/ exclusion');
});

test('multispec-batch-curation.md cites the sweep at its registry pass', () => {
  assert.match(BATCH, /shadow sweep/i);
  assert.ok(BATCH.includes('curation-engine.md'), 'cites the engine file that owns the sweep');
});

// ---- Live probe: `node bin/hooks.js sweep-shadow` relocates a stray shadow file and leaves work/ alone ----
test('probe: sweep-shadow relocates a staged file written to the worktree shadow and never touches work/', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  // A judge that resolved the run dir relatively from inside the worktree — the incident shape.
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(shadow, 'work'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'staged', 'wrap-up-skill-1.md'), 'proposal\n');
  fs.writeFileSync(path.join(shadow, 'decisions.md'), '# Auto-Decision Log — x\n\n## /wrap-up\n- STAGED stray line\n');
  fs.writeFileSync(path.join(shadow, 'work', '1-spec.md'), 'materialized — must stay\n');

  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /relocated: wrap-up-skill-1\.md/);
  assert.match(r.stdout, /relocated: decisions\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md')), 'file now at the anchored path');
  assert.ok(!fs.existsSync(path.join(shadow, 'staged', 'wrap-up-skill-1.md')), 'shadow copy gone');
  assert.ok(!fs.existsSync(path.join(shadow, 'staged')), 'empty shadow staged/ removed');
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /STAGED stray line/, 'shadow decisions.md entry appended to the anchored log');
  assert.ok(!log.includes('# Auto-Decision Log — x'), 'shadow decisions.md header dropped, not appended');
  assert.ok(!fs.existsSync(path.join(shadow, 'decisions.md')), 'shadow decisions.md removed after append');
  assert.ok(fs.existsSync(path.join(shadow, 'work', '1-spec.md')), 'work/ untouched');
});

test('probe: sweep-shadow is a no-op when no shadow exists', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stagepath-probe-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  const r0 = spawnSync('git', ['init', '-q'], { cwd: main, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r0.status, 0, r0.stderr);
  const runDir = path.join(main, '.claude-tweaks/pipelines/x/spec-1');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  const r = sweep(main, { runDir, worktree: main });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
  assert.ok(fs.existsSync(path.join(runDir, 'staged')), 'anchored staged/ survives — the same-path guard stops the sweep from rmdir-ing it');
});

// ---- Shared fixture builder for the remaining probes: a main checkout + linked worktree + anchored run dir ----
function buildFixture(t, { realpath = true } = {}) {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepath-probe-'));
  const root = realpath ? fs.realpathSync(raw) : raw;
  t.after(() => fs.rmSync(raw, { recursive: true, force: true }));
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 'probe@example.invalid');
  git(main, 'config', 'user.name', 'probe');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-q', '-m', 'base');
  const wt = path.join(root, 'wt');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'probe');
  const runRel = '.claude-tweaks/pipelines/2026-01-01T000000-spec-1/spec-1';
  const runDir = path.join(main, runRel);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# log\n');
  return { main, wt, runDir, shadow: path.join(wt, runRel) };
}

// `node bin/hooks.js sweep-shadow [--run <runDir>] [--worktree <worktree>]` — a flag is omitted
// entirely (not passed as an empty string) when the caller wants the "unset" case, matching what
// an actually-missing PIPELINE_RUN_DIR/WORKTREE looks like to the verb.
function sweep(cwd, { runDir, worktree } = {}) {
  const args = [HOOKS_JS, 'sweep-shadow'];
  if (runDir !== undefined) args.push('--run', runDir);
  if (worktree !== undefined) args.push('--worktree', worktree);
  // #1270: neutralize any ambient PIPELINE_RUN_DIR (present in every
  // /flow-dispatched shell) so a case that omits `runDir` (the deliberate
  // "unset" probe this helper's own comment above documents) resolves the
  // verb's own unset-arg fallback rather than silently picking up a real run
  // dir this test never named — same defense-in-depth convention #1130
  // established for every other bin/hooks.js test spawn helper.
  return spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, PIPELINE_RUN_DIR: '' },
  });
}

test('probe: a same-basename collision keeps the anchored file, moves the shadow copy to .shadow-dup, and says so', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md'), 'ANCHORED ORIGINAL\n');
  fs.writeFileSync(path.join(shadow, 'staged', 'wrap-up-skill-1.md'), 'shadow copy\n');
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /collision: wrap-up-skill-1\.md \(kept as wrap-up-skill-1\.md\.shadow-dup\)/);
  assert.doesNotMatch(r.stdout, /relocated: wrap-up-skill-1\.md/, 'a collision is never reported as a relocation');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md'), 'utf8'), 'ANCHORED ORIGINAL\n', 'anchored file untouched');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md.shadow-dup'), 'utf8'), 'shadow copy\n', 'shadow copy preserved at the anchored path');
  assert.ok(!fs.existsSync(path.join(shadow, 'staged')), 'shadow staged/ emptied and removed');
});

test('probe: run from the main checkout with a trailing-slash worktree arg, the guard holds and the anchored staged/ survives', (t) => {
  const { main, runDir } = buildFixture(t);
  const r = sweep(main, { runDir: runDir + '/', worktree: main + '/' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', 'a well-configured no-op prints nothing');
  assert.ok(fs.existsSync(path.join(runDir, 'staged')), 'anchored staged/ survives — trailing slashes cannot defeat the -ef guard');
});

test('probe: a symlinked temp root (raw mkdtemp path, no realpath) still relocates — pwd -P normalizes both sides', (t) => {
  const { wt, runDir, shadow } = buildFixture(t, { realpath: false });
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'staged', 'claude-md-1.md'), 'p\n');
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /relocated: claude-md-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'claude-md-1.md')), 'relocated to the anchored path despite symlinked components');
});

test('probe: an unset worktree arg is a loud diagnostic, exit 1, not a silent no-op — nothing is moved', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'staged', 'x.md'), 'x\n');
  const r = sweep(wt, { runDir });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /not swept/);
  assert.ok(fs.existsSync(path.join(shadow, 'staged', 'x.md')), 'nothing moved when misconfigured');
});

test('probe: a run dir outside RUN_ROOT is a loud diagnostic, exit 1 — nothing is moved', (t) => {
  const { wt, shadow } = buildFixture(t);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stagepath-other-')));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  fs.mkdirSync(path.join(other, 'staged'));
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'staged', 'x.md'), 'x\n');
  const r = sweep(wt, { runDir: other, worktree: wt });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /not under .* — not swept/);
  assert.ok(fs.existsSync(path.join(shadow, 'staged', 'x.md')), 'nothing moved');
});

test('probe: a headers-only shadow decisions.md is dropped and reported as such, never as "entries appended"', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'decisions.md'), '# Auto-Decision Log — x\n\n## /wrap-up\n');
  const before = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /had no entries — dropped/);
  assert.doesNotMatch(r.stdout, /entries appended/);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), before, 'anchored log unchanged');
  assert.ok(!fs.existsSync(path.join(shadow, 'decisions.md')), 'shadow file removed');
});

test('probe: a repeated collision keeps every earlier .shadow-dup — the second lands as .shadow-dup-1', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md'), 'ANCHORED\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md.shadow-dup'), 'FIRST DUP — pending\n');
  fs.writeFileSync(path.join(shadow, 'staged', 'wrap-up-skill-1.md'), 'second shadow copy\n');
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /collision: wrap-up-skill-1\.md \(kept as wrap-up-skill-1\.md\.shadow-dup-1\)/);
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md.shadow-dup'), 'utf8'), 'FIRST DUP — pending\n', 'earlier dup untouched');
  assert.equal(fs.readFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md.shadow-dup-1'), 'utf8'), 'second shadow copy\n');
});

test('probe: a symlink in the shadow staged/ is skipped with a diagnostic, exit 1, never moved, and the shadow dir is left for inspection', (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'secret.txt'), 'outside staged\n');
  fs.symlinkSync(path.join(shadow, 'secret.txt'), path.join(shadow, 'staged', 'link.md'));
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /skipped link\.md — not a regular file/);
  assert.match(r.stdout, /shadow staged\/ not empty after sweep/);
  assert.ok(!fs.existsSync(path.join(runDir, 'staged', 'link.md')), 'symlink never relocated');
  assert.ok(fs.lstatSync(path.join(shadow, 'staged', 'link.md')).isSymbolicLink(), 'symlink left in place');
});

test('probe: an mv failure is a loud diagnostic, exit 1, not a silent no-op', skipUnderRoot('root ignores directory permissions'), (t) => {
  const { wt, runDir, shadow } = buildFixture(t);
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(shadow, 'staged', 'x.md'), 'x\n');
  fs.chmodSync(path.join(runDir, 'staged'), 0o555);
  t.after(() => { if (fs.existsSync(path.join(runDir, 'staged'))) fs.chmodSync(path.join(runDir, 'staged'), 0o755); });
  const r = sweep(wt, { runDir, worktree: wt });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAILED to move x\.md/);
  assert.match(r.stdout, /shadow staged\/ not empty after sweep/);
  assert.ok(fs.existsSync(path.join(shadow, 'staged', 'x.md')), 'file still in the shadow — nothing lost');
  fs.chmodSync(path.join(runDir, 'staged'), 0o755);
});

// #1140: concurrent fan-out judges raced their own `git add`/`git commit` on the shared
// worktree index (one judge's edit swept into a sibling's commit; a fabricated hash reported).
// The fix is structural: judges never mutate git — the controller's serial-commit pass is the
// single committer and the only writer of findings[].commit. These pins keep the three prose
// surfaces (the §4 rule, the §3 contract row, skill-curation's apply step) from drifting back.
test('curation-engine.md §4 forbids judge-side git mutations and documents the serial-commit pass with its audit', () => {
  const s4 = ENGINE.slice(ENGINE.indexOf('## 4. Parallel dispatch'));
  const para = s4.slice(
    s4.indexOf('**No judge-side git mutations'),
    s4.indexOf('**Judge self-verification'),
  );
  assert.ok(para.length > 0, 'the no-judge-side-git paragraph exists, before the self-verification paragraph');
  assert.match(para, /never run `git add`, `git commit`/, 'the dispatch-prompt instruction forbids judge commits');
  assert.match(para, /serial-commit pass/, 'names the controller-side pass');
  assert.match(para, /git status --porcelain/, 'the commit audit checks the working tree');
  assert.match(para, /judge-filled `commit`.*payload violation|payload violation.*judge-filled `commit`/s, 'a judge-filled commit hash is a violation');
  assert.match(para, /one commit per finding/, 'commits stay per-finding (separate-commit reversibility)');
  assert.match(para, /before any `record` call/, 'the pass runs before record, so payloads carry final hashes');
});

test('curation-engine.md §3 commit row and applied-precondition name the controller as the only committer', () => {
  const row = ENGINE.split('\n').find((l) => l.startsWith('| `findings[].commit` |'));
  assert.ok(row, 'commit contract row present');
  assert.match(row, /controller/i, 'controller writes the field');
  assert.match(row, /judge never commits/i, 'judges never commit');

  assert.match(ENGINE, /committed on its own — by the controller's serial-commit pass \(section 4\), never by the judge/, 'applied-precondition follow-up names the controller');
});

test('skill-curation.md step 2 no longer instructs a judge-side commit', () => {
  const CURATION = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'skill-curation.md'), 'utf8');
  assert.doesNotMatch(CURATION, /auto-apply now\. Commit\./, 'the old judge-commits wording is retired');
  assert.match(CURATION, /never run `git add`\/`git commit`/, 'states the no-judge-commit rule');
  assert.match(CURATION, /serial-commit\s+pass/, 'cites the engine pass that commits instead');
  assert.match(CURATION, /written by the controller at commit time/, 'the AUTO log entry is controller-written (only it knows the hash)');
});

test('curation-engine.md §4 keeps the Initiative-Fix trailer carve-out for the references row', () => {
  const s4 = ENGINE.slice(ENGINE.indexOf('## 4. Parallel dispatch'));
  const para = s4.slice(
    s4.indexOf('**No judge-side git mutations'),
    s4.indexOf('**Judge self-verification'),
  );
  assert.match(para, /Initiative-Fix: \{run-id\}/, 'the trailer carve-out for the references row survives in the serial-commit paragraph');
});

// reference-sweep.md ~line 72 used to claim the judge itself made the commit ("in their own
// commit with the `Initiative-Fix: {run-id}` trailer"). #1140's fix moved commit ownership to the
// controller's serial-commit pass; the judge-side phrasing must not survive, and the new
// controller-commits wording must be present.
test('reference-sweep.md no longer claims the judge makes its own Initiative-Fix commit', () => {
  const REF_SWEEP = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'reference-sweep.md'), 'utf8');
  assert.doesNotMatch(
    REF_SWEEP,
    /in their own commit with the `Initiative-Fix: \{run-id\}` trailer/,
    'the old judge-side commit phrasing is retired',
  );
  assert.match(REF_SWEEP, /serial-commit\s+pass/, 'names the controller-side pass that actually commits');
  assert.match(REF_SWEEP, /never a judge-side commit/, 'states the repair is applied as a working-tree edit only');
});
