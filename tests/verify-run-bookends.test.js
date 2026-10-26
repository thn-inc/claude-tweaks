// tests/verify-run-bookends.test.js
// Fake deps per the gh-api-module-pattern skill's injectable-runner
// convention — never real git or the filesystem. `readClaimBlobGit` fakes
// return the same shape claims-git-cas.js's real implementation does
// ({content, tipSha, absent, failure}).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  run, parseArgs, parseTargets, USAGE, realDeps,
} = require('../plugin/bin/verify-run-bookends');
const { run: setConfigRun } = require('../plugin/bin/set-config');
const { run: logDecisionRun } = require('../plugin/bin/log-decision');
const { appendEntry, hms } = require('../plugin/bin/lib/log-decision/append');
const { readText } = require('./helpers/read-skill');

const canonicalClaim = (n) => `## /flow\n- AUTO 09:41:32 — Step 2.8: claimed #${n} (bin/claim-targets.js, transport: git). Reversibility: high.\n`;

function gitIn(cwd) {
  return (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

const RUN_DIR = '/repo/.claude-tweaks/pipelines/2026-09-17T001731-record-1728';
const RUN_ID = '2026-09-17T001731-record-1728';
const NOW = Date.parse('2026-09-17T01:00:00.000Z');

function liveMarker(runId, claimedAtIso = new Date(NOW).toISOString(), ttlHours = 72) {
  return JSON.stringify({
    runId, sessionId: 's', claimedAt: claimedAtIso, ttlHours, host: 'h',
  });
}
function tombstoneMarker(runId) {
  return JSON.stringify({ released: true, runId, reason: 'x', releasedAt: new Date(NOW).toISOString() });
}

function makeDeps({
  runState = { worktree: '/wt', pr: { number: 1, url: 'https://x' } },
  integrationModel = 'pr-first',
  claims = {},
  isSpecCommitted = () => true,
  readDecisions = () => `${canonicalClaim(1728)}${canonicalClaim(1729)}`,
} = {}) {
  // Every decisions.md append the CLI makes, recorded (#4026).
  const appended = [];
  return {
    appended,
    appendDecision: (args) => { appended.push(args); },
    readRunState: () => runState,
    readIntegrationModel: () => integrationModel,
    isSpecCommitted,
    readDecisions,
    readClaimBlobGit: ({ issueNumber }) => claims[issueNumber] || { content: null, absent: true, failure: null },
    now: () => NOW,
    stdout: () => {},
    stderr: () => {},
  };
}

function captured(deps) {
  const out = [];
  const err = [];
  return {
    ...deps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    out,
    err,
  };
}

test('parseArgs: rejects an unknown flag', () => {
  assert.deepStrictEqual(parseArgs(['--bogus']), { error: 'unknown argument: --bogus' });
});

test('parseTargets: rejects blank, trailing comma, and non-positive-integer parts', () => {
  assert.strictEqual(parseTargets(''), null);
  assert.strictEqual(parseTargets('1,'), null);
  assert.strictEqual(parseTargets('0'), null);
});

test('parseTargets: accepts a clean comma-separated list', () => {
  assert.deepStrictEqual(parseTargets('1,2,3'), [1, 2, 3]);
});

test('--help prints usage and exits 0', () => {
  const deps = captured(makeDeps());
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.out[0], USAGE);
});

test('missing --run exits 2', () => {
  const deps = captured(makeDeps());
  const code = run(['--targets', '1728'], deps);
  assert.strictEqual(code, 2);
});

test('missing --targets exits 2', () => {
  const deps = captured(makeDeps());
  const code = run(['--run', RUN_DIR], deps);
  assert.strictEqual(code, 2);
});

test('all bookends confirmed (worktree stamped, PR recorded under pr-first, live claim matching this run) -> exit 0', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.ok, true);
  assert.deepStrictEqual(payload.confirmed.claims, [1728]);
});

test('a stale claim still counts as confirmed when the runId matches this run (TTL expiry is not "never claimed")', () => {
  const staleClaimedAt = new Date(NOW - 100 * 60 * 60 * 1000).toISOString(); // 100h ago, past the 72h TTL
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker(RUN_ID, staleClaimedAt), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
});

test('no run-state.json (worktree never recorded) -> exit 1, missing worktree bookend', () => {
  const deps = captured(makeDeps({
    runState: null,
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.ok, false);
  assert.ok(payload.missing.some((m) => m.bookend === 'worktree'));
});

test('pr-first with no PR recorded -> exit 1, missing pr bookend', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.ok(payload.missing.some((m) => m.bookend === 'pr'));
});

test('local-merge run with no PR recorded -> the pr bookend is not required', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    integrationModel: 'local-merge',
    claims: { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 0);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.confirmed.pr, 'n/a');
});

test('AC2.1: with an integration-model: pr-first pin and no recorded PR, the pr bookend is asserted (missing), not skipped', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    integrationModel: 'pr-first',
    claims: OWN_CLAIM,
  }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const payload = JSON.parse(deps.out[0]);
  assert.ok(payload.missing.some((m) => m.bookend === 'pr'), 'pr bookend missing');
  assert.ok(!deps.err.join('').includes('degraded'), deps.err.join(''));
});

test('AC2.1: readConfigIntegrationModel reads a pin written by set-config.js', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  const err = [];
  const code = setConfigRun(['--run', runDir, '--key', 'integration-model', '--value', 'pr-first'], {
    cwd: () => main, stdout: () => {}, stderr: (s) => err.push(s),
  });
  assert.strictEqual(code, 0, err.join(''));
  assert.strictEqual(realDeps.readIntegrationModel(runDir), 'pr-first');
});

test('readConfigIntegrationModel: an empty integration-model line reads as absent, not the next line\'s key', (t) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-emptypin-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\nintegration-model:\nspec: 42\n');
  assert.strictEqual(realDeps.readIntegrationModel(runDir), null);
});

test('AC3.1: with no integration-model pin, a degrade line is printed instead of passing silently', () => {
  const deps = captured(makeDeps({ integrationModel: null, claims: OWN_CLAIM }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 0);
  assert.strictEqual(deps.err.length, 1);
  assert.match(deps.err.join(''), /^verify-run-bookends: degraded — .*carries no valid integration-model pin \(absent\)/m);
});

test('AC3.1: an invalid integration-model pin prints the same degrade line', () => {
  const deps = captured(makeDeps({ integrationModel: 'bogus', claims: OWN_CLAIM }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 0);
  assert.strictEqual(deps.err.length, 1);
  assert.match(deps.err.join(''), /^verify-run-bookends: degraded — .*carries no valid integration-model pin \(bogus\)/m);
});

test('a local-merge pin prints no degrade line', () => {
  const deps = captured(makeDeps({ integrationModel: 'local-merge', claims: OWN_CLAIM }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 0);
  assert.strictEqual(deps.err.join(''), '');
});

test('claim never written (absent) -> exit 1, missing claim bookend', () => {
  const deps = captured(makeDeps({ claims: {} }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.ok(claimMiss, 'absent claim must be reported missing');
  assert.match(claimMiss.reason, /state=absent/);
});

test('claim held by a DIFFERENT run -> exit 1, not silently accepted as this run\'s own', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: liveMarker('some-other-run'), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.match(claimMiss.reason, /runId=some-other-run/);
});

test('a tombstoned (released) claim does not count as confirmed', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: tombstoneMarker(RUN_ID), absent: false, failure: null } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
});

test('a git read failure surfaces as a distinct reason, never mistaken for "never claimed"', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: null, absent: false, failure: 'transport-failure' } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.match(claimMiss.reason, /read-failed: transport-failure/);
});

// #3051: a timed-out git read names the timeout specifically — "remote
// slow" is a different, more actionable signal than "remote unreachable".
test('a git read failure with timedOut set names the timeout in the missing-bookend reason', () => {
  const deps = captured(makeDeps({
    claims: { 1728: { content: null, absent: false, failure: 'transport-failure', timedOut: true } },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  const claimMiss = payload.missing.find((m) => m.bookend === 'claim' && m.issue === 1728);
  assert.match(claimMiss.reason, /read-failed: transport-failure \(timed out after \d+ ms\)/);
});

test('multiple targets: every one is checked independently, all confirmed -> exit 0', () => {
  const deps = captured(makeDeps({
    claims: {
      1728: { content: liveMarker(RUN_ID), absent: false, failure: null },
      1729: { content: liveMarker(RUN_ID), absent: false, failure: null },
    },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728,1729'], deps);
  assert.strictEqual(code, 0);
});

test('multiple targets: one unconfirmed target is reported without masking the confirmed one', () => {
  const deps = captured(makeDeps({
    claims: {
      1728: { content: liveMarker(RUN_ID), absent: false, failure: null },
      1729: { content: null, absent: true, failure: null },
    },
  }));
  const code = run(['--run', RUN_DIR, '--targets', '1728,1729'], deps);
  assert.strictEqual(code, 1);
  const payload = JSON.parse(deps.out[0]);
  assert.strictEqual(payload.missing.length, 1);
  assert.strictEqual(payload.missing[0].issue, 1729);
});

const OWN_CLAIM = { 1728: { content: liveMarker(RUN_ID), absent: false, failure: null } };
const BUNDLE_TARGETS = '1728,1729';
const BUNDLE_CLAIMS = {
  1728: { content: liveMarker(RUN_ID), absent: false, failure: null },
  1729: { content: liveMarker(RUN_ID), absent: false, failure: null },
};

test('AC1.1: a target whose spec is not committed -> exit 1, missing materialize bookend with a materialize.js remedy', () => {
  const deps = captured(makeDeps({ claims: OWN_CLAIM, isSpecCommitted: () => false }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'materialize' && x.issue === 1728);
  assert.ok(m, 'materialize bookend missing');
  assert.strictEqual(m.reason, 'not-committed');
  assert.match(m.remedy, /materialize\.js" 1728/);
});

test('isSpecCommitted returning null -> missing materialize with reason "undetermined"', () => {
  const deps = captured(makeDeps({ claims: OWN_CLAIM, isSpecCommitted: () => null }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'materialize');
  assert.strictEqual(m.reason, 'undetermined');
});

test('AC1.1: realDeps.isSpecCommitted is true only for a spec committed at HEAD', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-spec-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = gitIn(root);
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'init');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  const specRel = `.claude-tweaks/pipelines/${RUN_ID}/work/1728-spec.md`;
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, specRel), 'spec\n');
  const args = { runDir, worktree: root, issue: 1728 };
  assert.strictEqual(realDeps.isSpecCommitted(args), false, 'untracked');
  git('add', specRel);
  assert.strictEqual(realDeps.isSpecCommitted(args), false, 'staged but not committed');
  git('commit', '-q', '-m', 'spec');
  assert.strictEqual(realDeps.isSpecCommitted(args), true, 'committed');
  assert.strictEqual(realDeps.isSpecCommitted({ ...args, issue: 1729 }), false, 'other record');

  const specRunDir = path.join(runDir, 'spec-1730');
  const nestedRel = `.claude-tweaks/pipelines/${RUN_ID}/spec-1730/work/1730-spec.md`;
  fs.mkdirSync(path.join(specRunDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, nestedRel), 'spec\n');
  git('add', nestedRel);
  git('commit', '-q', '-m', 'nested spec');
  assert.strictEqual(realDeps.isSpecCommitted({ runDir: specRunDir, worktree: root, issue: 1730 }), true, 'spec-N run dir');
  assert.strictEqual(realDeps.isSpecCommitted({ runDir, worktree: root, issue: 1730 }), true, 'nested spec found from the parent run id');
});

test('realDeps.isSpecCommitted -> null when the worktree is unresolvable', () => {
  assert.strictEqual(realDeps.isSpecCommitted({ runDir: RUN_DIR, worktree: path.join(os.tmpdir(), 'bookends-no-such-dir-2912'), issue: 1728 }), null);
  assert.strictEqual(realDeps.isSpecCommitted({ runDir: RUN_DIR, worktree: undefined, issue: 1728 }), null);
});

test('AC3.1: a paraphrased claim line -> exit 1, missing claim-log bookend whose remedy is the canonical log-decision.js command', () => {
  const deps = captured(makeDeps({
    claims: OWN_CLAIM,
    readDecisions: () => '- AUTO 09:00:00 — Step 2.8: claimed issue #1728. Reversibility: high.',
  }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'claim-log' && x.issue === 1728);
  assert.ok(m, 'claim-log bookend missing');
  assert.match(m.remedy, /--step "Step 2\.8"/);
  assert.match(m.remedy, /claimed #1728 \(bin\/claim-targets\.js/);
});

test('unreadable decisions.md (null) -> missing claim-log, not a crash', () => {
  const deps = captured(makeDeps({ claims: OWN_CLAIM, readDecisions: () => null }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  assert.ok(JSON.parse(deps.out[0]).missing.some((x) => x.bookend === 'claim-log' && x.issue === 1728));
});

test('every missing entry carries a remedy string', () => {
  const deps = captured(makeDeps({
    runState: null, claims: {}, isSpecCommitted: () => false, readDecisions: () => '',
  }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const { missing } = JSON.parse(deps.out[0]);
  assert.deepStrictEqual(missing.map((m) => m.bookend).sort(), ['claim', 'claim-log', 'materialize', 'pr', 'worktree']);
  for (const m of missing) assert.strictEqual(typeof m.remedy, 'string', m.bookend);
});

test('all bookends confirmed -> payload.confirmed.materialize and .claimLog list the targets', () => {
  const deps = captured(makeDeps({ claims: BUNDLE_CLAIMS }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', BUNDLE_TARGETS], deps), 0);
  const { confirmed } = JSON.parse(deps.out[0]);
  assert.deepStrictEqual(confirmed.materialize, [1728, 1729]);
  assert.deepStrictEqual(confirmed.claimLog, [1728, 1729]);
});

test('AC4.1: a run in this record\'s own pre-fix shape (pr-first, no PR, paraphrased claim, uncommitted spec) exits 1 naming pr, materialize and claim-log', () => {
  const deps = captured(makeDeps({
    runState: { worktree: '/wt' },
    integrationModel: 'pr-first',
    claims: OWN_CLAIM,
    isSpecCommitted: () => false,
    readDecisions: () => '- AUTO 09:00:00 — Step 2.8: claimed issue #1728. Reversibility: high.',
  }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const names = JSON.parse(deps.out[0]).missing.map((m) => m.bookend);
  for (const b of ['pr', 'materialize', 'claim-log']) assert.ok(names.includes(b), b);
});

test('realDeps.readDecisions reads decisions.md and returns null when absent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-dec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.strictEqual(realDeps.readDecisions(dir), null);
  fs.writeFileSync(path.join(dir, 'decisions.md'), 'hello\n');
  assert.strictEqual(realDeps.readDecisions(dir), 'hello\n');
});

// #2912 final review: remedies must be runnable as printed, on either transport.

test('a bundle-shaped materialize remedy carries the literal run dir and --multi-record-slug, never the placeholder', () => {
  const deps = captured(makeDeps({ claims: BUNDLE_CLAIMS, isSpecCommitted: () => false }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', BUNDLE_TARGETS], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'materialize' && x.issue === 1729);
  assert.ok(m.remedy.includes(`--run-dir "${RUN_DIR}"`), m.remedy);
  assert.ok(m.remedy.includes('--multi-record-slug 1729'), m.remedy);
  assert.ok(!m.remedy.includes('<worktree-local run dir>'), m.remedy);
  assert.ok(m.remedy.includes('[--record-json <path> when gh is absent]'), m.remedy);
});

test('a single-target materialize remedy has no --multi-record-slug', () => {
  const deps = captured(makeDeps({ claims: OWN_CLAIM, isSpecCommitted: () => false }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'materialize');
  assert.ok(!m.remedy.includes('--multi-record-slug'), m.remedy);
  assert.ok(!m.remedy.includes('<worktree-local run dir>'), m.remedy);
});

test('a spec-{N} run dir with several targets gets no --multi-record-slug (the run dir already is the per-spec dir)', () => {
  const specRunDir = `${RUN_DIR}/spec-1728`;
  const deps = captured(makeDeps({ claims: BUNDLE_CLAIMS, isSpecCommitted: () => false }));
  assert.strictEqual(run(['--run', specRunDir, '--targets', BUNDLE_TARGETS], deps), 1);
  const ms = JSON.parse(deps.out[0]).missing.filter((x) => x.bookend === 'materialize');
  assert.ok(ms.length >= 1);
  for (const m of ms) assert.ok(!m.remedy.includes('--multi-record-slug'), m.remedy);
});

test('the claim remedy names the MCP claim procedure for a gh-absent run', () => {
  const deps = captured(makeDeps({ claims: {} }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 1);
  const m = JSON.parse(deps.out[0]).missing.find((x) => x.bookend === 'claim');
  assert.match(m.remedy, /gh-absent: flow\/claim-targets\.md's MCP claim procedure/);
});

test('a claim-log remedy defers to the claim remedy when the same issue\'s claim is also missing', () => {
  const deps = captured(makeDeps({ claims: OWN_CLAIM, readDecisions: () => '' }));
  assert.strictEqual(run(['--run', RUN_DIR, '--targets', BUNDLE_TARGETS], deps), 1);
  const { missing } = JSON.parse(deps.out[0]);
  const logFor = (n) => missing.find((x) => x.bookend === 'claim-log' && x.issue === n);
  assert.match(logFor(1728).remedy, /log-decision\.js/, '1728 claim is held: the log line is its own remedy');
  assert.strictEqual(logFor(1729).remedy, 'covered by the claim remedy above (claim-targets.js --run writes the canonical line)');
});

test('a two-target parent run with a spec committed only at flat work/{n}-spec.md reports materialize missing (real git)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = gitIn(root);
  git('init', '-q');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  const flatRel = `.claude-tweaks/pipelines/${RUN_ID}/work/1729-spec.md`;
  const nestedRel = `.claude-tweaks/pipelines/${RUN_ID}/spec-1728/work/1728-spec.md`;
  fs.mkdirSync(path.join(root, path.dirname(flatRel)), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(nestedRel)), { recursive: true });
  fs.writeFileSync(path.join(root, flatRel), 'spec\n');
  fs.writeFileSync(path.join(root, nestedRel), 'spec\n');
  git('add', flatRel, nestedRel);
  git('commit', '-q', '-m', 'specs');
  const deps = captured({
    ...makeDeps({ runState: { worktree: root, pr: { number: 1, url: 'https://x' } } }),
    isSpecCommitted: realDeps.isSpecCommitted,
    readClaimBlobGit: () => ({ content: liveMarker(RUN_ID), absent: false, failure: null }),
  });
  assert.strictEqual(run(['--run', runDir, '--targets', BUNDLE_TARGETS], deps), 1);
  const mat = JSON.parse(deps.out[0]).missing.filter((x) => x.bookend === 'materialize');
  assert.deepStrictEqual(mat.map((x) => x.issue), [1729], 'the flat-layout bundle member is missing; the nested one is found');
  assert.strictEqual(mat[0].reason, 'not-committed');
});

test('isSpecCommitted: a git timeout or spawn error is undetermined (null), never "not committed"', () => {
  const args = { runDir: RUN_DIR, worktree: os.tmpdir(), issue: 1728 };
  const timeout = () => { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; e.signal = 'SIGTERM'; throw e; };
  const spawnFail = () => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; throw e; };
  const exitNonZero = () => { const e = new Error('fatal'); e.status = 128; throw e; };
  assert.strictEqual(realDeps.isSpecCommitted(args, timeout), null, 'timeout');
  assert.strictEqual(realDeps.isSpecCommitted(args, spawnFail), null, 'spawn error');
  assert.strictEqual(realDeps.isSpecCommitted(args, exitNonZero), null, 'cat-file and rev-parse both exit non-zero: HEAD unresolvable');
  const catFileMissRevParseOk = (cmd, argv) => { if (argv.includes('cat-file')) exitNonZero(); };
  assert.strictEqual(realDeps.isSpecCommitted(args, catFileMissRevParseOk), false, 'git ran, HEAD resolves, spec absent');
  const catFileTimeoutRevParseOk = (cmd, argv) => { if (argv.includes('cat-file')) timeout(); };
  assert.strictEqual(realDeps.isSpecCommitted(args, catFileTimeoutRevParseOk), null, 'cat-file timed out: not provably absent');
});

// ---- #4026: the degrade line logs its own SKIP ----

const degradeLine = (pin) => `verify-run-bookends: degraded — ${RUN_DIR}/config.yml carries no valid integration-model pin (${pin}); PR bookend not checked (_shared/integration-model.md's Run-scoped stability)\n`;
const withoutLogged = ({ logged, ...rest }) => rest;

// Characterization (pre-#4026 behaviour that must not move): the exact stderr
// line, the exit code and every envelope key but the new `logged`.
test('characterization: a degraded pin prints exactly one stderr line, exit and envelope unchanged', () => {
  for (const pin of [null, 'bogus']) {
    const ok = captured(makeDeps({ integrationModel: pin, claims: OWN_CLAIM }));
    assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], ok), 0);
    assert.deepStrictEqual(ok.err, [degradeLine(pin ?? 'absent')]);
    assert.deepStrictEqual(withoutLogged(JSON.parse(ok.out[0])), {
      ok: true,
      confirmed: {
        worktree: true, pr: 'n/a', claims: [1728], materialize: [1728], claimLog: [1728],
      },
    });

    const miss = captured(makeDeps({ integrationModel: pin, claims: {} }));
    assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], miss), 1);
    assert.deepStrictEqual(miss.err, [degradeLine(pin ?? 'absent')]);
    assert.deepStrictEqual(withoutLogged(JSON.parse(miss.out[0])).missing.map((m) => m.bookend), ['claim']);
  }
});

test('AC3.1: verify-run-bookends degraded pin logs the SKIP line', () => {
  for (const [pin, code, claims] of [[null, 0, OWN_CLAIM], ['bogus', 0, OWN_CLAIM], [null, 1, {}]]) {
    const deps = captured(makeDeps({ integrationModel: pin, claims }));
    assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), code);
    assert.strictEqual(deps.appended.length, 1);
    const [{ runDir, section, entry }] = deps.appended;
    assert.strictEqual(runDir, RUN_DIR);
    assert.strictEqual(section, undefined, 'the prose passed no --section');
    assert.strictEqual(entry, `- SKIP ${hms(NOW)} — log-decision: condition: ${degradeLine(pin ?? 'absent').trimEnd()} → fallback: PR-bookend check not run. Reversibility: n/a.`);
    assert.strictEqual(JSON.parse(deps.out[0]).logged, true);
  }
});

test('AC3.1: the self-logged line equals the one log-decision.js wrote from the prose\'s {text-file} template', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const template = 'condition: {stderr line} → fallback: PR-bookend check not run';
  for (const rel of ['plugin/skills/dispatch/task-prompt.md', 'plugin/skills/flow/claim-targets.md']) {
    assert.ok(readText(path.join(__dirname, '..', rel)).includes(template), `${rel} no longer carries the {text-file} template`);
  }

  const deps = captured({
    ...makeDeps({ integrationModel: null, claims: OWN_CLAIM }),
    appendDecision: (args) => appendEntry(args),
  });
  assert.strictEqual(run(['--run', runDir, '--targets', '1728'], deps), 0);
  const selfLogged = readText(path.join(runDir, 'decisions.md'));

  // The prose's hand log: {text-file} holds the template with the stderr line substituted.
  const textFile = path.join(root, 'text.txt');
  fs.writeFileSync(textFile, `${template.replace('{stderr line}', deps.err[0].trimEnd())}\n`);
  fs.rmSync(path.join(runDir, 'decisions.md'));
  const code = logDecisionRun(['--run', runDir, '--status', 'SKIP', '--text-file', textFile], {
    cwd: () => root, mainRoot: root, now: () => NOW, stdout: () => {}, stderr: () => {},
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(selfLogged, readText(path.join(runDir, 'decisions.md')));
});

test('a valid pin appends nothing and reports logged:false', () => {
  for (const pin of ['pr-first', 'local-merge']) {
    const deps = captured(makeDeps({ integrationModel: pin, claims: OWN_CLAIM }));
    assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), 0);
    assert.strictEqual(deps.appended.length, 0, pin);
    assert.strictEqual(JSON.parse(deps.out[0]).logged, false, pin);
  }
});

test('a failed SKIP append keeps the exit code, reports logged:false and adds one stderr line', () => {
  for (const [code, claims] of [[0, OWN_CLAIM], [1, {}]]) {
    const deps = captured({
      ...makeDeps({ integrationModel: null, claims }),
      appendDecision: () => { throw new Error('disk full'); },
    });
    assert.strictEqual(run(['--run', RUN_DIR, '--targets', '1728'], deps), code);
    assert.strictEqual(JSON.parse(deps.out[0]).logged, false);
    assert.deepStrictEqual(deps.err, [degradeLine('absent'), 'verify-run-bookends: could not append the decisions.md entry: disk full\n']);
  }
});

test('realDeps.appendDecision refuses a run dir not anchored under the main checkout, writing nothing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookends-shadow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  assert.throws(() => realDeps.appendDecision({ runDir, entry: '- SKIP 00:00:00 — x: y. Reversibility: n/a.' }), /not anchored/);
  assert.strictEqual(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});
