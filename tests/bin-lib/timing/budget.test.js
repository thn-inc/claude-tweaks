'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateBudgets, formatBudgetLine, budgetProposal, repoRootOf, readCeremonyProfile, checkBudgets } = require('../../../plugin/bin/lib/timing/budget');

const CEILINGS = { roundTrips: 5, procedureKb: 560, verifyMinutes: 21 };
const TOTALS = { toolRoundTrips: 10, procedureBytes: 100, verifyMinutes: 2 };
const byMetric = (checks) => Object.fromEntries(checks.map((c) => [c.metric, c]));

test('#4029: evaluateBudgets classifies ok/breach/unmeasured/disabled', () => {
  const checks = evaluateBudgets({ totals: TOTALS, ceilings: CEILINGS });
  assert.deepEqual(checks.map((c) => c.metric), ['round-trips', 'procedure-kb', 'verify-minutes']);
  assert.deepEqual(byMetric(checks)['round-trips'], { metric: 'round-trips', value: 10, ceiling: 5, status: 'breach' });
  // procedure-kb is bytes/1024 rounded to 1 dp: 100 B -> 0.1
  assert.deepEqual(byMetric(checks)['procedure-kb'], { metric: 'procedure-kb', value: 0.1, ceiling: 560, status: 'ok' });
  assert.deepEqual(byMetric(checks)['verify-minutes'], { metric: 'verify-minutes', value: 2, ceiling: 21, status: 'ok' });

  // no transcript: round trips and procedure bytes absent -> unmeasured; verify minutes still checked
  const bare = byMetric(evaluateBudgets({ totals: { verifyMinutes: 30 }, ceilings: CEILINGS }));
  assert.equal(bare['round-trips'].status, 'unmeasured');
  assert.equal(bare['procedure-kb'].status, 'unmeasured');
  assert.equal(bare['verify-minutes'].status, 'breach');
  // a NaN is as unmeasured as an absent value
  assert.equal(byMetric(evaluateBudgets({ totals: { toolRoundTrips: NaN, verifyMinutes: 1 }, ceilings: CEILINGS }))['round-trips'].status, 'unmeasured');

  // a ceiling of 0 disables the budget, even for a huge value or an unmeasured one
  const off = byMetric(evaluateBudgets({ totals: { toolRoundTrips: 9999, verifyMinutes: 999 }, ceilings: { roundTrips: 0, procedureKb: 0, verifyMinutes: 0 } }));
  assert.deepEqual(Object.values(off).map((c) => c.status), ['disabled', 'disabled', 'disabled']);

  // the boundary: a value equal to the ceiling is within budget, one over is a breach
  const edge = (v) => byMetric(evaluateBudgets({ totals: { toolRoundTrips: v, verifyMinutes: 0 }, ceilings: CEILINGS }))['round-trips'].status;
  assert.equal(edge(5), 'ok');
  assert.equal(edge(6), 'breach');
});

test('#4029: formatBudgetLine renders one line per profile with BREACH upper-cased', () => {
  const line = formatBudgetLine('fast-lane', evaluateBudgets({ totals: TOTALS, ceilings: CEILINGS }));
  assert.equal(line, 'Budget (fast-lane): round-trips 10/5 BREACH · procedure-kb 0.1/560 ok · verify-minutes 2/21 ok');
  const bare = formatBudgetLine('standard', evaluateBudgets({ totals: { verifyMinutes: 2 }, ceilings: { roundTrips: 0, procedureKb: 560, verifyMinutes: 21 } }));
  assert.equal(bare, 'Budget (standard): round-trips —/0 disabled · procedure-kb —/560 unmeasured · verify-minutes 2/21 ok');
});

test('#4029: budgetProposal is a staged-file text with the Title/Type/Labels/Defer-reason header and a spec-shaped body', () => {
  const totals = { ...TOTALS, turnClasses: { edit: 1, read: 1, explore: 0, procedure: 1, bookkeeping: 1, orientation: 2, verify: 1, 'guard-refusal': 1, dispatch: 1, other: 1 } };
  const checks = evaluateBudgets({ totals, ceilings: CEILINGS });
  const text = budgetProposal({ runId: 'run-x', profile: 'fast-lane', checks, totals });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Title: Efficiency budget breached on run run-x (fast-lane)');
  assert.equal(lines[1], 'Type: task');
  assert.equal(lines[2], 'Labels: none');
  assert.equal(lines[3], 'Defer-reason: needs-human-decision');
  assert.equal(lines[4], '');
  for (const h of ['## Current State', '## Deliverables', '## Acceptance Criteria', '## Release Note']) assert.ok(text.includes(h), h);
  assert.ok(text.includes('No user-visible change.'));
  assert.ok(text.includes('phase-timing.js --check-budgets'));
  // Current State names the breached metric against its ceiling, not the ok ones
  assert.match(text, /round-trips[^\n]*10[^\n]*5/);
  assert.doesNotMatch(text, /verify-minutes: 2/);
  // top three turn classes by count, ties in class order
  assert.match(text, /orientation 2, edit 1, read 1/);
  // the policy key a human would raise
  assert.ok(text.includes('fast-lane-run-round-trip-ceiling'));
});

test('#4029: budgetProposal without turn-class data says so, and refuses a run with nothing breached', () => {
  const totals = { verifyMinutes: 30 };
  const checks = evaluateBudgets({ totals, ceilings: CEILINGS });
  assert.match(budgetProposal({ runId: 'r', profile: 'standard', checks, totals }), /turn classes: not measured/i);
  assert.throws(() => budgetProposal({ runId: 'r', profile: 'standard', checks: evaluateBudgets({ totals: { verifyMinutes: 1 }, ceilings: CEILINGS }), totals }), /no breached/);
});

test('#4029: repoRootOf takes the parent of the last .claude-tweaks segment, for a live and an archived run dir', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-')));
  const live = path.join(root, '.claude-tweaks', 'pipelines', 'r1');
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(live, { recursive: true });
  fs.mkdirSync(archived, { recursive: true });
  assert.equal(repoRootOf(live), root);
  assert.equal(repoRootOf(archived), root);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-bare-'));
  assert.equal(repoRootOf(bare), null);
});

test('#4029: readCeremonyProfile reads config.yml and falls back to standard when absent, unknown or unreadable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-cfg-'));
  assert.deepEqual(readCeremonyProfile(dir), { profile: 'standard', source: 'fallback' });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\nceremony-profile: fast-lane  # chosen\n');
  assert.deepEqual(readCeremonyProfile(dir), { profile: 'fast-lane', source: 'config' });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'ceremony-profile: turbo\n');
  assert.deepEqual(readCeremonyProfile(dir), { profile: 'standard', source: 'fallback' });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\n');
  assert.deepEqual(readCeremonyProfile(dir), { profile: 'standard', source: 'fallback' });
});

// --- checkBudgets against a tmp checkout --------------------------------------
// A tmp checkout (.git dir) with a policy.yml and a run dir under .claude-tweaks/pipelines/;
// deps.cwd = the checkout so the staging and decision-log anchors resolve to it, and deps.gh
// is a fake runner (tests never touch real gh).
function checkout({ policy = 'fast-lane-run-round-trip-ceiling: 5\n' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-chk-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  return root;
}
function runDirIn(root, id, rel = []) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', id, ...rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'ceremony-profile: fast-lane\n');
  return dir;
}
const ghNone = () => '[]';
const decisionLines = (dir) => (fs.existsSync(path.join(dir, 'decisions.md')) ? fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')) : []);
const stagedIn = (dir) => (fs.existsSync(path.join(dir, 'staged')) && fs.statSync(path.join(dir, 'staged')).isDirectory() ? fs.readdirSync(path.join(dir, 'staged')) : []);

test('#4029 I2(a): a breach whose staging fails writes a degraded SKIP line through the decision log', () => {
  const root = checkout();
  const dir = runDirIn(root, 'r-stagefail');
  fs.writeFileSync(path.join(dir, 'staged'), 'a file where the staged/ directory should be');
  const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh: ghNone } });
  assert.equal(r.budget.staged, null);
  assert.ok(r.budget.stageError, 'stageError recorded');
  assert.ok(r.stderr.some((l) => /could not stage the efficiency-budget proposal/.test(l)), r.stderr.join('\n'));
  const skip = decisionLines(dir).filter((l) => l.startsWith('- SKIP'));
  assert.equal(skip.length, 1, decisionLines(dir).join('\n'));
  assert.match(skip[0], /^- SKIP \d{2}:\d{2}:\d{2} — efficiency budget \(degraded\): condition: breach of round-trips 10\/5 found but staging failed \(.+\) → fallback: no Review Console item this run; breach recorded in timing\.json budget\. Reversibility: n\/a\.$/);
  assert.match(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), /^## \/wrap-up$/m);
});

test('#4029 I2: a breach staged but whose STAGED line cannot be written keeps the staged path and reports the error', () => {
  const root = checkout();
  const dir = runDirIn(root, 'r-logfail');
  fs.mkdirSync(path.join(dir, 'decisions.md')); // a directory: the append throws EISDIR
  const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh: ghNone } });
  assert.equal(r.budget.staged, 'staged/efficiency-budget-r-logfail.md');
  assert.ok(fs.existsSync(path.join(dir, 'staged', 'efficiency-budget-r-logfail.md')));
  assert.match(r.budget.stageError, /EISDIR|illegal operation on a directory/);
  assert.ok(r.stderr.some((l) => /could not stage the efficiency-budget proposal/.test(l)), r.stderr.join('\n'));
});

test('#4029 I2(c): unmeasured metrics write one degraded SKIP line naming them; a clean pass writes nothing', () => {
  const root = checkout();
  const dir = runDirIn(root, 'r-unmeasured');
  const r = checkBudgets({ runDir: dir, totals: { verifyMinutes: 2 }, deps: { cwd: root, gh: ghNone } });
  assert.deepEqual(stagedIn(dir), []);
  assert.equal(r.budget.staged, null);
  const lines = decisionLines(dir);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^- SKIP \d{2}:\d{2}:\d{2} — efficiency budget \(degraded\): condition: round-trips, procedure-kb unmeasured \(no transcript rows\) → fallback: only measured metrics checked\. Reversibility: n\/a\.$/);
  const clean = runDirIn(root, 'r-clean');
  checkBudgets({ runDir: clean, totals: { toolRoundTrips: 1, procedureBytes: 1, verifyMinutes: 1 }, deps: { cwd: root, gh: ghNone } });
  assert.deepEqual(decisionLines(clean), []);
});

test('#4029 I2(b): no .claude-tweaks ancestor keeps budget.skipped plus the stderr line and writes no decisions.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-noanc-'));
  const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { gh: () => { throw new Error('unexpected gh call'); } } });
  assert.deepEqual(r.budget, { skipped: 'no .claude-tweaks ancestor' });
  assert.deepEqual(r.stderr, ['budget: skipped — no .claude-tweaks ancestor']);
  assert.equal(fs.existsSync(path.join(dir, 'decisions.md')), false);
});
