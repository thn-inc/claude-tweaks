// tests/dispatch-flow-rundir-handoff-fixture.test.js
//
// #2556 (follow-up from #1826's own AC1/AC4/AC5): a genuine end-to-end
// regression test for /flow's two-call run-dir handoff — a fixture-repo
// harness (bare git `origin` remote, a real worktree-like checkout, `gh`
// faked at the injectable-runner seam tests/bin-lib/claim-targets/
// claim-targets.test.js already uses) that drives the REAL sequence of bin/
// CLIs: materialize.js -> claim-targets.js -> set-config.js ->
// log-decision.js -> hooks.js record-worktree -> a real git push -> hooks.js
// record-pr (mocked `gh pr create`/`gh pr list`: the PR-early procedure
// itself is skill prose, not a bin/ CLI, so this fixture supplies canned PR
// data the way the real `gh` call would have, and feeds it to the one real
// CLI that persists it).
//
// tests/dispatch-flow-rundir-handoff.test.js (the sibling this file joins)
// is entirely prose-conformance — it regex-matches skill .md files and never
// spawns a process or touches a filesystem. The units this test exercises
// end-to-end are each already covered in isolation (preflight.test.js's
// computeAdoption case 3; claim-targets.test.js's contest/all-or-abort
// handling) but nothing before this file ran them together, in the order
// /flow's own Step 1 -> 2.8 -> 3 -> 4 actually runs them, against a real
// git repo.
//
// Read-only against the real repo: every git/fs operation here happens
// inside a temp directory created by this file; nothing touches the
// claude-tweaks checkout this suite itself runs from.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { fixtureGit } = require('./helpers/git-fixtures');
const { run: claimTargetsRun, BOT_IN_PROGRESS } = require('../plugin/bin/lib/claim-targets/claim-targets');

const ROOT = path.join(__dirname, '..');
const MATERIALIZE_JS = path.join(ROOT, 'plugin', 'bin', 'materialize.js');
const SET_CONFIG_JS = path.join(ROOT, 'plugin', 'bin', 'set-config.js');
const LOG_DECISION_JS = path.join(ROOT, 'plugin', 'bin', 'log-decision.js');
const HOOKS_JS = path.join(ROOT, 'plugin', 'bin', 'hooks.js');

// #1270/#1130 convention every bin/hooks.js (and sibling CLI) test spawn
// already follows: neutralize any ambient PIPELINE_RUN_DIR so a spawn can
// never silently resolve against a real run dir it was not explicitly
// pointed at.
const CLEAN_ENV = { ...process.env, PIPELINE_RUN_DIR: '' };
const SPAWN_TIMEOUT_MS = 20000;

// The 13 canonical Manifesto levers (manifesto.md's canonical numbering),
// one concrete valid value each — mirrors the exact batch shape
// flow/manifesto.md's Step 3 write produces, so set-config.js's own
// isManifestoAutoBatch() FYI-render branch fires the same way it does in a
// real auto-mode run.
const MANIFESTO_SET = [
  'mode=auto',
  'scope-creep=add-to-plan',
  'overlap=companion',
  'design-intent=none',
  'leftover-default=defer',
  'auto-fix-threshold=lint+type',
  'review-auto-apply-ceiling=low',
  'tidy-aggressiveness=moderate',
  'ceremony-profile=standard',
  'model-stance=default',
  'merge-verification=merge-when-green',
  'design-critique=auto',
  'merge-authorization=ask',
].join(',');

function spawn(cmdArgs, opts) {
  try {
    const stdout = execFileSync('node', cmdArgs, {
      timeout: SPAWN_TIMEOUT_MS, env: CLEAN_ENV, ...opts,
    });
    return { code: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString('utf8') : '',
      stderr: e.stderr ? e.stderr.toString('utf8') : '',
    };
  }
}

// A bare `origin` remote plus a real `main` checkout pushed to it — gives
// the push/PR half of the lifecycle something real to push against without
// touching the network (this record's own Technical Approach).
function makeFixtureRepo() {
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2e-bare-'));
  fixtureGit(['init', '--bare', '-q', bareDir]);
  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2e-main-'));
  fixtureGit(['init', '-q', '-b', 'main', mainDir]);
  fixtureGit(['-C', mainDir, 'config', 'user.email', 'fixture@example.com']);
  fixtureGit(['-C', mainDir, 'config', 'user.name', 'Fixture']);
  fixtureGit(['-C', mainDir, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const bareReal = fs.realpathSync(bareDir);
  fixtureGit(['-C', mainDir, 'remote', 'add', 'origin', bareReal]);
  fixtureGit(['-C', mainDir, 'push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return { bare: bareReal, main: fs.realpathSync(mainDir) };
}

// A real `git worktree add` under <main>/.claude/worktrees/<branch> — the
// same domain the native EnterWorktree tool uses (ADR-0004), on its own
// feature branch, mirroring a dispatched run's isolation.
function makeWorktree(main, branch) {
  const wt = path.join(main, '.claude', 'worktrees', branch);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  fixtureGit(['-C', main, 'worktree', 'add', '-q', wt, '-b', branch]);
  return fs.realpathSync(wt);
}

// Dispatch's own mint is mkdir-only (no config.yml yet) — reproduced here
// literally rather than pre-populating anything.
function mintEmptyRunDir(main, runId) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A minimal, genuinely spec-shaped record body: materialize.js's shapeGate
// requires all four headings non-empty and no TBD/TODO/<!-- ambiguity: -->
// marker before "## Original request".
function specShapedBody() {
  return [
    'Surface: infra',
    '',
    '## Current State',
    'A fixture record used only by this test file.',
    '',
    '## Deliverables',
    '- Nothing real; this body exists to satisfy the shape gate.',
    '',
    '## Acceptance Criteria',
    '- N/A',
    '',
    '## Release Note',
    'No user-visible change.',
    '',
  ].join('\n');
}

function writeRecordJson(dir, n) {
  const file = path.join(dir, `record-${n}.json`);
  fs.writeFileSync(file, JSON.stringify({
    number: n,
    title: `Fixture record #${n}`,
    url: `https://github.com/acme/fixture-repo/issues/${n}`,
    labels: [],
    body: specShapedBody(),
  }));
  return file;
}

// claim-targets.js's own injectable-runner fake pattern (tests/bin-lib/
// claim-targets/claim-targets.test.js) — a create-only absent-target claim,
// reused here verbatim rather than re-invented.
const REPO = 'acme/fixture-repo';
function readPath(issue) { return `repos/${REPO}/contents/claims/issue-${issue}.json?ref=claims-registry`; }
function isRead(args, issue) { return args[0] === readPath(issue); }
function isWrite(args, issue) {
  return args[0] === '--method' && args[1] === 'PUT' && args[2] === `repos/${REPO}/contents/claims/issue-${issue}.json`;
}
function liveMarker(runId) {
  return JSON.stringify({
    runId, sessionId: 's', claimedAt: new Date(0).toISOString(), ttlHours: 72, host: 'h',
  });
}
const readAbsent = { stdout: null, failure: null, status: 404 };
function readOk(content, sha) { return { stdout: JSON.stringify({ content, sha }), failure: null, status: null }; }
function confirmRead(runId) { return readOk(liveMarker(runId), 'sha-confirm'); }
const writeOk = { stdout: '{}', failure: null, status: null };

function makeClaimDeps({ issue, runId, contestedBy }) {
  const reads = contestedBy
    ? { [issue]: [readOk(liveMarker(contestedBy), 'sha-live')] }
    : { [issue]: [readAbsent, confirmRead(runId)] };
  const writes = { [issue]: [writeOk] };
  function ghApi(args) {
    for (const i of Object.keys(reads)) if (isRead(args, i)) return reads[i].shift() || reads[i][reads[i].length - 1];
    for (const i of Object.keys(writes)) if (isWrite(args, i)) return writes[i].shift() || writeOk;
    throw new Error(`unexpected ghApi ${args.join(' ')}`);
  }
  function gh(args) {
    if (args[0] === 'repo' && args[1] === 'view') return `${REPO}\n`;
    if (args[0] === 'label' && args[1] === 'list') return `${BOT_IN_PROGRESS}\n`;
    if (args[0] === 'label' && args[1] === 'create') return '';
    if (args[0] === 'issue' && args[1] === 'edit') return '';
    if (args[0] === 'issue' && args[1] === 'comment') return '';
    throw new Error(`unexpected gh ${args.join(' ')}`);
  }
  const out = []; const err = [];
  return {
    deps: {
      ghApi, gh, now: () => 0, stdout: (s) => out.push(s), stderr: (s) => err.push(s), hostname: 'h', sessionId: 's', sleep: () => {},
    },
    out,
  };
}

function readRunState(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Fixture 1: the full "call 1" sequence — materialize -> claim -> Manifesto
// batch write -> decision log -> record-worktree -> push -> record-pr —
// asserting the anchored run directory's config.yml/decisions.md/
// run-state.json all exist and carry correct content afterward.
// ---------------------------------------------------------------------------

test('fixture-repo e2e: the real call-1 CLI sequence produces a correct anchored run directory', () => {
  const ISSUE = 9001;
  const RUN_ID = '2026-01-01T000000-record-9001';
  const { bare, main } = makeFixtureRepo();
  const branch = `worktree-record-${ISSUE}`;
  const wt = makeWorktree(main, branch);
  const runDir = mintEmptyRunDir(main, RUN_ID);

  // 1. materialize.js — the real CLI, --record-json so no `gh` is touched.
  const recordJsonPath = writeRecordJson(wt, ISSUE);
  const matOut = spawn(
    [MATERIALIZE_JS, String(ISSUE), '--run-dir', runDir, '--record-json', recordJsonPath, '--ceremony', 'standard'],
    { cwd: wt },
  );
  assert.equal(matOut.code, 0, `materialize.js failed: ${matOut.stderr}`);
  const matJson = JSON.parse(matOut.stdout);
  assert.equal(matJson.record, ISSUE);
  // #1210/#959: materialize.js always rewrites the write target to the
  // CALLING worktree's own equivalent path when cwd sits inside one — the
  // materialized spec file lives at {worktree}/.claude-tweaks/pipelines/
  // {run-id}/work/{n}-spec.md, never under the main-checkout-anchored
  // run dir a naive reading of --run-dir would suggest.
  const expectedSpecFile = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work', `${ISSUE}-spec.md`);
  assert.equal(matJson.file, expectedSpecFile, 'materialize.js must rewrite the output path to the worktree-local equivalent (#1210)');
  assert.ok(fs.existsSync(expectedSpecFile), 'the worktree-local spec file must actually exist');
  assert.ok(
    !fs.existsSync(path.join(runDir, 'work', `${ISSUE}-spec.md`)),
    'the main-checkout-anchored run dir must NOT receive the spec file — that would be the shadow this record exists to rule out',
  );
  const specContent = fs.readFileSync(expectedSpecFile, 'utf8');
  assert.match(specContent, /Fixture record #9001/);
  assert.match(specContent, /## Acceptance Criteria/);

  // 2. claim-targets.js — the real run(), gh faked at the injectable-runner seam.
  const { deps: claimDeps, out: claimOut } = makeClaimDeps({ issue: ISSUE, runId: RUN_ID });
  const claimCode = claimTargetsRun(['--run-id', RUN_ID, '--targets', String(ISSUE)], claimDeps);
  assert.equal(claimCode, 0, `claim-targets.js did not claim cleanly: ${claimOut.join('')}`);
  const claimBody = JSON.parse(claimOut[0]);
  assert.deepEqual(claimBody.claimed, [ISSUE]);

  // 3. set-config.js — the Manifesto's own batch write, run from inside the
  // worktree (the real shape — the anchoring check still resolves to `main`).
  const cfgOut = spawn([SET_CONFIG_JS, '--run', runDir, '--set', MANIFESTO_SET], { cwd: wt });
  assert.equal(cfgOut.code, 0, `set-config.js failed: ${cfgOut.stderr}`);
  assert.match(cfgOut.stdout, /Pipeline Config \(auto\)/, 'a full 13-lever mode=auto batch must render the Manifesto FYI table');
  const configPath = path.join(runDir, 'config.yml');
  assert.ok(fs.existsSync(configPath), 'config.yml must exist under the anchored (main-checkout) run dir');
  const configText = fs.readFileSync(configPath, 'utf8');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const pair of MANIFESTO_SET.split(',')) {
    const [key, value] = pair.split('=');
    assert.match(configText, new RegExp(`^${escapeRe(key)}: ${escapeRe(value)}$`, 'm'), `config.yml missing ${key}: ${value}`);
  }

  // 4. log-decision.js — logs the config.yml write with its absolute path
  // (#1810/#1826's own fix: this line used to go unlogged).
  const decisionText = `config.yml written at ${configPath}`;
  const logOut = spawn(
    [LOG_DECISION_JS, '--run', runDir, '--status', 'AUTO', '--text', decisionText],
    { cwd: wt },
  );
  assert.equal(logOut.code, 0, `log-decision.js failed: ${logOut.stderr}`);
  const decisionsPath = path.join(runDir, 'decisions.md');
  assert.ok(fs.existsSync(decisionsPath), 'decisions.md must exist under the anchored run dir');
  const decisionsText = fs.readFileSync(decisionsPath, 'utf8');
  assert.match(decisionsText, /AUTO/);
  assert.ok(decisionsText.includes(configPath), 'decisions.md must carry the config.yml write\'s absolute path');

  // 5. hooks.js record-worktree — the real CLI, real fs write.
  const rwOut = spawn([HOOKS_JS, 'record-worktree', '--run', runDir, wt], { cwd: wt });
  assert.match(rwOut.stdout, /worktree recorded/, `record-worktree did not confirm: ${rwOut.stdout}`);
  let state = readRunState(runDir);
  assert.equal(state.worktree, path.resolve(wt));
  assert.equal(state.status, 'active');

  // 6. A real push of the worktree's branch to the bare `origin` — the
  // push half of "PR-early": no network, a real bare repo.
  fixtureGit(['-C', wt, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
  const wtHead = fixtureGit(['-C', wt, 'rev-parse', 'HEAD']).toString('utf8').trim();
  const remoteHead = fixtureGit(['ls-remote', bare, `refs/heads/${branch}`]).toString('utf8').trim().split(/\s+/)[0];
  assert.equal(remoteHead, wtHead, 'the branch must actually be present on the bare origin at the worktree\'s HEAD');

  // 7. `gh pr create`/`gh pr list` are mocked here (no bin/ CLI wraps PR
  // creation — it's pr-early-run-lifecycle.md's own skill prose) by supplying
  // canned PR data straight to the one real CLI that persists it.
  const PR_NUMBER = 4242;
  const PR_URL = `https://github.com/${REPO}/pull/${PR_NUMBER}`;
  const prOut = spawn([HOOKS_JS, 'record-pr', '--run', runDir, String(PR_NUMBER), PR_URL], { cwd: wt });
  assert.match(prOut.stdout, new RegExp(`PR #${PR_NUMBER} recorded`), `record-pr did not confirm: ${prOut.stdout}`);

  // Final assertion: config.yml, decisions.md, and run-state.json (with
  // `worktree` AND `pr` fields) all exist under the anchored run dir with
  // correct content — this record's own Deliverables/AC bar.
  state = readRunState(runDir);
  assert.equal(state.worktree, path.resolve(wt));
  assert.deepEqual(state.pr, { number: PR_NUMBER, url: PR_URL, branch });
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(decisionsPath));
});

// ---------------------------------------------------------------------------
// Fixture 2: a contested claim must stop the sequence before materialize's
// own commit/write step ever runs.
// ---------------------------------------------------------------------------

test('fixture-repo e2e: a contested claim-targets.js exit halts the sequence before materialize ever writes', () => {
  const ISSUE = 9002;
  const RUN_ID = '2026-01-01T000000-record-9002';
  const { main } = makeFixtureRepo();
  const branch = `worktree-record-${ISSUE}`;
  const wt = makeWorktree(main, branch);
  const runDir = mintEmptyRunDir(main, RUN_ID);

  // claim-targets.js first — the real sequencing /flow's own Step 2.8 (claim)
  // precedes Step 4's build-time materialize/commit.
  const { deps: claimDeps, out: claimOut } = makeClaimDeps({ issue: ISSUE, runId: RUN_ID, contestedBy: 'some-other-run' });
  const claimCode = claimTargetsRun(['--run-id', RUN_ID, '--targets', String(ISSUE)], claimDeps);
  assert.equal(claimCode, 3, `expected a contested exit (3), got ${claimCode}: ${claimOut.join('')}`);
  const claimBody = JSON.parse(claimOut[0]);
  assert.equal(claimBody.contested.length, 1);
  assert.equal(claimBody.contested[0].issue, ISSUE);
  assert.equal(claimBody.contested[0].holder.runId, 'some-other-run');

  // The harness's own control flow (mirroring /flow's gate) must never reach
  // materialize on this branch — asserted by simply not calling it, then
  // confirming no spec file exists anywhere this run could have written one.
  const wouldBeSpecFile = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work', `${ISSUE}-spec.md`);
  assert.ok(!fs.existsSync(wouldBeSpecFile), 'materialize must never have run against a contested target');
  assert.ok(!fs.existsSync(path.join(runDir, 'config.yml')), 'no Manifesto write should have happened either');
});

// ---------------------------------------------------------------------------
// Fixture 3: the shadow-write hypothesis — a run dir resolving under the
// WORKTREE instead of the anchored main checkout must be refused by
// set-config.js's own anchoring guard, not silently written.
// ---------------------------------------------------------------------------

test('fixture-repo e2e: set-config.js refuses a worktree-local shadow run dir instead of writing config.yml there', () => {
  const RUN_ID = '2026-01-01T000000-record-9003';
  const { main } = makeFixtureRepo();
  const branch = 'worktree-record-9003';
  const wt = makeWorktree(main, branch);
  // The shadow: a run dir that exists under the WORKTREE at the identical
  // relative path a real anchored run dir would use under the main checkout.
  const shadowRunDir = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(shadowRunDir, { recursive: true });

  const cfgOut = spawn([SET_CONFIG_JS, '--run', shadowRunDir, '--set', MANIFESTO_SET], { cwd: wt });
  assert.equal(cfgOut.code, 3, `expected the anchoring guard to refuse (exit 3), got ${cfgOut.code}: ${cfgOut.stdout}${cfgOut.stderr}`);
  assert.match(cfgOut.stderr, /not anchored|shadow/i);
  assert.ok(!fs.existsSync(path.join(shadowRunDir, 'config.yml')), 'config.yml must never be written to the worktree-local shadow path');
});
