'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkPrBookkeepingPrecondition } = require('../../../plugin/bin/lib/pr-bookkeeping/precondition');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { fakeGh } = require('../../helpers/fake-gh');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');

function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

function makeRunDir(id) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-run-'));
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function writeRunState(runDir, state) {
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
}

function commitMaterializeFile(repo, runId) {
  const rel = path.join('.claude-tweaks', 'pipelines', runId, 'work', '1-spec.md');
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'materialize', '-q']);
}

test('checkPrBookkeepingPrecondition: ok when run dir is absent (nothing to check)', () => {
  const r = checkPrBookkeepingPrecondition({ runDir: null, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
});

test('checkPrBookkeepingPrecondition: ok when the run is already clean', () => {
  const runId = '2026-09-17T000001-spec-1';
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'clean' });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'clean');
});

test('checkPrBookkeepingPrecondition: ok when no materialize commit has landed yet', () => {
  const runId = '2026-09-17T000002-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-materialized-yet');
});

test('checkPrBookkeepingPrecondition: DENY when materialize commit landed but no worktree stamp was ever recorded (#2472 core scenario)', () => {
  const runId = '2026-09-17T000003-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  // No run-state.json at all -- record-worktree never ran.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
  assert.match(r.message, /record-worktree/);
});

test('checkPrBookkeepingPrecondition: ok (fail-open) for a current-branch-shaped run -- no worktree field, NOT a linked worktree (#2472 Finding 1 regression)', () => {
  const runId = '2026-09-17T000003b-spec-1';
  // A plain git repo that is NOT a linked worktree of anything -- the
  // git-strategy: current-branch shape, where build/worktree-setup.md (and
  // its record-worktree call) never runs at all.
  const main = gitRepoWithCommit();
  // current-branch mode works directly on a feature branch in the SAME
  // checkout (no linked worktree at all) -- advance HEAD past the resolved
  // integration branch (main/master) the same way a linked worktree's own
  // branch does, so hasMaterializeCommit's {integration}..HEAD range is
  // non-empty.
  execFileSync('git', ['-C', main, 'checkout', '-b', 'feature-branch', '-q']);
  commitMaterializeFile(main, runId);
  const runDir = makeRunDir(runId);
  // No run-state.json -- record-worktree legitimately never ran in this mode.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: main });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-linked-worktree');
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and prExempt is set', () => {
  const runId = '2026-09-17T000004-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, prExempt: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and a PR is recorded', () => {
  const runId = '2026-09-17T000005-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when integration model resolves local-merge (no policy, no remote)', () => {
  const runId = '2026-09-17T000006-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-pr-first');
});

test('checkPrBookkeepingPrecondition: ok when a PR-early-lifecycle FAILED degrade line is already logged', () => {
  const runId = '2026-09-17T000007-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  fs.writeFileSync(path.join(runDir, 'decisions.md'),
    '- AUTO 10:00:00 -- PR-early run lifecycle: push of br FAILED (network). Reversibility: n/a.\n');
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'degrade-logged');
});

test('checkPrBookkeepingPrecondition: DENY when pr-first, worktree stamped, no PR and no degrade line logged (#2472 core scenario)', () => {
  const runId = '2026-09-17T000008-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-pr-stamp');
  assert.match(r.message, /pr-early-run-lifecycle/);
});

// #2664: a multi-spec /flow run hands each spec's skills a PER-SPEC
// $PIPELINE_RUN_DIR ({parent-run-id}/spec-{N}/, flow/multi-spec.md's env-var
// table), and materialize commits that spec's file at
// {parent-run-id}/spec-{N}/work/{N}-spec.md. Before #2571, hasMaterializeCommit
// keyed its pathspec off path.basename(runDir) ("spec-{N}", never a real run
// id), so the materialize commit was never found and this precondition
// silently returned not-materialized-yet for every multi-spec run.
function commitPerSpecMaterializeFile(repo, parentId, n) {
  const rel = path.join('.claude-tweaks', 'pipelines', parentId, `spec-${n}`, 'work', `${n}-spec.md`);
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', `materialize ${n}`, '-q']);
}

test('checkPrBookkeepingPrecondition (#2664): a multi-spec per-spec runDir recognizes its own materialize commit -> no-worktree-stamp, not a false not-materialized-yet', () => {
  const parentId = '2026-09-17T000012-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  // No per-spec run-state.json -- Step 4.5's record-worktree never ran for this spec.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
  assert.match(r.message, /record-worktree/);
});

test('checkPrBookkeepingPrecondition (#2664): a stamped multi-spec per-spec runDir passes as pr-stamped-or-exempt', () => {
  const parentId = '2026-09-17T000013-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2664): a per-spec runDir does NOT arm off a SIBLING spec\'s materialize commit', () => {
  const parentId = '2026-09-17T000014-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  // Only spec-8 has materialized; this check runs on behalf of spec-7.
  commitPerSpecMaterializeFile(wt, parentId, 8);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-materialized-yet');
});

test('checkPrBookkeepingPrecondition (#2664): parent-only stamps satisfy a per-spec runDir -- the run\'s shared worktree/PR live on the parent (pack.js resolveState-style fallback)', () => {
  const parentId = '2026-09-17T000015-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2664): a per-spec runDir honors a PR-early degrade line logged in the PARENT decisions.md', () => {
  const parentId = '2026-09-17T000018-spec-7-8';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  // The run-level PR-early lifecycle ran against the parent: worktree
  // stamped there, PR creation failed, degrade line logged there.
  writeRunState(parentRunDir, { status: 'active', worktree: wt });
  fs.writeFileSync(path.join(parentRunDir, 'decisions.md'),
    '- AUTO 10:00:00 -- PR-early run lifecycle: push of br FAILED (network). Reversibility: n/a.\n');
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'degrade-logged');
});

test('checkPrBookkeepingPrecondition (#2664): a spec-* dir whose parent is NOT run-id-shaped does not inherit that parent\'s stamps', () => {
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  // Not a multi-spec child (same rule as pre-tool-use.js's perSpecPathspec),
  // so its materialize path is the ordinary single-record one rooted at spec-7.
  commitMaterializeFile(wt, 'spec-7');
  const notARun = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-notarun-'));
  writeRunState(notARun, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const runDir = path.join(notARun, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
});

test('checkPrBookkeepingPrecondition (#2858): a per-spec runDir whose own run-state.json carries only status borrows the parent\'s worktree and PR', () => {
  const parentId = '2026-09-17T000019-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active' });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2858): a status-only per-spec runDir honors a prExempt stamped on the parent', () => {
  const parentId = '2026-09-17T000020-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, prExempt: 'initial-publish' });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active', pr: null });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2858): a hand-corrupted parent stamp still fails open for a status-only per-spec runDir', () => {
  const parentId = '2026-09-17T000021-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active' });

  // A PR object with no usable number still reads as "a PR was recorded".
  writeRunState(parentRunDir, { status: 'active', worktree: wt, pr: {} });
  const shapeless = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(shapeless.ok, true);
  assert.strictEqual(shapeless.reason, 'pr-stamped-or-exempt');

  // A non-string worktree cannot be resolved -- unreadable, not a missing stamp.
  writeRunState(parentRunDir, { status: 'active', worktree: 5 });
  const unresolvable = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(unresolvable.ok, true);
  assert.strictEqual(unresolvable.reason, 'unreadable-run-state');
});

// #4578 Q11: a forge detection that timed out twice cannot prove the run is
// pr-first or not -- it reports degraded-detection (ok, fail-open), never the
// not-pr-first a clean local-merge detection reports.
function degradedFixture(runId) {
  const main = gitRepoWithCommit();
  execFileSync('git', ['-C', main, 'remote', 'add', 'origin', 'https://github.com/o/n.git']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  return { runDir, wt };
}

function withGhTimeoutEnv(ms, fn) {
  const KEY = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const saved = process.env[KEY];
  process.env[KEY] = ms;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

test('checkPrBookkeepingPrecondition (#4578 Q11): a degraded forge detection reports degraded-detection, never not-pr-first (AC21.1)', { skip: STUB_SKIP }, () => {
  const { runDir, wt } = degradedFixture('2026-10-31T000001-spec-4578');
  // precondition.js passes no timeoutMs, so the ladder's env rung bounds the probe.
  const gh = fakeGh({ first: 'hang' });
  let r;
  let calls;
  try {
    r = withGhTimeoutEnv('1000', () => checkPrBookkeepingPrecondition({ runDir, cwd: wt }));
    calls = gh.count();
  } finally {
    gh.restore();
  }
  assert.deepStrictEqual(r, { ok: true, reason: 'degraded-detection' });
  assert.strictEqual(calls, 2);
});

test('checkPrBookkeepingPrecondition (#4578 Q11): a clean local-merge detection (gh exits non-zero at once) still reports not-pr-first', { skip: STUB_SKIP }, () => {
  const { runDir, wt } = degradedFixture('2026-10-31T000002-spec-4578');
  const gh = fakeGh({ first: 'fail' });
  let r;
  let calls;
  try {
    r = withGhTimeoutEnv('1000', () => checkPrBookkeepingPrecondition({ runDir, cwd: wt }));
    calls = gh.count();
  } finally {
    gh.restore();
  }
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-pr-first');
  assert.strictEqual(calls, 1);
});

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRECONDITION_RAW = readText(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'pr-bookkeeping', 'precondition.js'));
const PRECONDITION_CODE = stripComments(PRECONDITION_RAW);
const FORWARD_RE = /resolveRunPinnedIntegrationModel\(mainRoot,\s*runDir,\s*\{\s*onDegrade\s*\}\)/;
const CALL_SITE_RE = /resolveRunPinnedIntegrationModel\(/g;
const callSiteCount = (code) => (code.match(CALL_SITE_RE) || []).length;

// FORWARD_RE pins the call's argument text to exactly `{ onDegrade }`, so a
// timeoutMs in the call fails the match -- that is the Q3 property. No
// whole-file timeoutMs ban: an unrelated timeoutMs elsewhere in the file (a git
// spawn bound) would not break it. The single-call-site count closes the other
// gap: a second call that carries timeoutMs would not disturb FORWARD_RE's match
// on the first.
test('precondition.js forwards exactly { onDegrade } to resolveRunPinnedIntegrationModel -- it follows the gh-timeout-ms ladder (#4578 AC13.2, AC13.3, AC21.1)', () => {
  assert.strictEqual(stripperVerdict(PRECONDITION_RAW, PRECONDITION_CODE), 'ok', STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.match(PRECONDITION_CODE, FORWARD_RE);
  assert.strictEqual(callSiteCount(PRECONDITION_CODE), 1,
    'resolveRunPinnedIntegrationModel( must be called exactly once, so no second call can carry timeoutMs');
});

test('go-red: the forwarding scan rejects a two-argument call, a timeoutMs call, and a call that exists only in a comment', () => {
  const live = 'model = resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade });';
  assert.match(stripComments(live), FORWARD_RE);
  const twoArg = 'model = resolveRunPinnedIntegrationModel(mainRoot, runDir);';
  assert.doesNotMatch(stripComments(twoArg), FORWARD_RE);
  const withTimeout = 'model = resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade, timeoutMs: 5000 });';
  assert.doesNotMatch(stripComments(withTimeout), FORWARD_RE);
  const commented = `// ${live}\nmodel = resolveRunPinnedIntegrationModel(mainRoot, runDir);`;
  assert.doesNotMatch(stripComments(commented), FORWARD_RE);
  // a timeoutMs mention in a trailing comment does not disturb a compliant call
  assert.match(stripComments(`${live} // timeoutMs`), FORWARD_RE);
  // timeoutMs listed before onDegrade is also rejected
  assert.doesNotMatch(stripComments('model = resolveRunPinnedIntegrationModel(mainRoot, runDir, { timeoutMs: 5000, onDegrade });'), FORWARD_RE);
  // a second call carrying timeoutMs leaves FORWARD_RE matching the first, but the call-site count catches it
  const twoCalls = `${live}\nother = resolveRunPinnedIntegrationModel(mainRoot, runDir, { timeoutMs: 5000, onDegrade });`;
  assert.match(stripComments(twoCalls), FORWARD_RE);
  assert.strictEqual(callSiteCount(stripComments(live)), 1);
  assert.strictEqual(callSiteCount(stripComments(twoCalls)), 2);
  // a call mentioned only in a comment is not a call site
  assert.strictEqual(callSiteCount(stripComments(`${live}\n// resolveRunPinnedIntegrationModel(mainRoot, runDir, { timeoutMs: 1 });`)), 1);
});

test('/test Step 0 names the degraded-detection reason the precondition returns (#4578 Q11 prose twin)', () => {
  const skill = readText(path.join(REPO_ROOT, 'plugin', 'skills', 'test', 'SKILL.md'));
  const start = skill.indexOf('## Step 0: PR-Bookkeeping Precondition Check');
  const end = skill.indexOf('## Step 1:', start);
  assert.ok(start >= 0 && end > start, 'Step 0 section not found');
  const slice = skill.slice(start, end);
  assert.match(slice, /ok \(degraded-detection\)/);
  assert.match(slice, /--status SKIP|`SKIP`/);
  // the producer still carries the literal the prose names
  assert.match(PRECONDITION_CODE, /'degraded-detection'/);
});
