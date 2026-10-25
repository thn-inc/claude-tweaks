'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateBudgets, formatBudgetLine, budgetProposal, repoRootOf, readCeremonyProfile, checkBudgets, budgetFingerprint } = require('../../../plugin/bin/lib/timing/budget');
const { extractFingerprint } = require('../../../plugin/bin/lib/issues/record-fingerprint');

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
  assert.equal(lines[0], 'Title: Efficiency budget: fast-lane runs over the round-trips ceiling');
  // the run id stays in Current State, not the title
  assert.match(text, /Run `run-x` \(ceremony profile `fast-lane`\)/);
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

test('#4029 M7: Current State names the unattributed round-trip share, so a reader knows what the per-phase breakdown explains', () => {
  const checks = evaluateBudgets({ totals: TOTALS, ceilings: CEILINGS });
  const text = budgetProposal({ runId: 'r', profile: 'fast-lane', checks, totals: TOTALS, unattributed: { toolRoundTrips: 3 } });
  const current = text.slice(text.indexOf('## Current State'), text.indexOf('## Deliverables'));
  assert.match(current, /Unattributed round trips: 3 of 10 \(30%\) fell outside every phase, so the per-phase breakdown in `timing\.json` covers the other 70%\./);
  // no unattributed bucket (no transcript) or no round trips: the line is left out, never a 0% guess
  assert.doesNotMatch(budgetProposal({ runId: 'r', profile: 'fast-lane', checks, totals: TOTALS }), /Unattributed round trips/);
  const noRt = evaluateBudgets({ totals: { verifyMinutes: 30 }, ceilings: CEILINGS });
  assert.doesNotMatch(budgetProposal({ runId: 'r', profile: 'fast-lane', checks: noRt, totals: { verifyMinutes: 30 }, unattributed: { toolRoundTrips: 0 } }), /Unattributed round trips/);
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

// --- I3: stable identity and the open-record fold ------------------------------
test('#4029 I3: the proposal title is stable across runs and the body carries the per-profile work fingerprint', () => {
  const checks = evaluateBudgets({ totals: { toolRoundTrips: 10, verifyMinutes: 30 }, ceilings: CEILINGS });
  const a = budgetProposal({ runId: '2026-10-24T100000-record-1', profile: 'fast-lane', checks, totals: {} });
  const b = budgetProposal({ runId: '2026-10-25T090000-record-2', profile: 'fast-lane', checks, totals: {} });
  assert.equal(a.split('\n')[0], b.split('\n')[0]);
  // metrics in check order, joined by ", "
  assert.equal(a.split('\n')[0], 'Title: Efficiency budget: fast-lane runs over the round-trips, verify-minutes ceiling');
  const fp = budgetFingerprint('fast-lane');
  assert.match(fp, /^efficiencybudget-[0-9a-f]{8}$/);
  assert.equal(extractFingerprint(a), fp);
  assert.equal(extractFingerprint(b), fp);
  assert.ok(a.includes(`<!-- work-fingerprint: ${fp} -->`) && a.includes(`\nwork-fingerprint: ${fp}`));
  // one open record per profile: the other profile keys differently
  assert.notEqual(budgetFingerprint('standard'), fp);
});

// A fake gh that records each call and answers `issue list` with `rows` (or throws `fail`).
function fakeGh({ rows = [], fail = null, raw = null } = {}) {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    if (args[0] !== 'issue' || args[1] !== 'list') throw new Error('unexpected gh ' + args.join(' '));
    if (fail) throw fail;
    return raw !== null ? raw : JSON.stringify(rows);
  };
  return { gh, calls };
}
const trackedBody = (fp) => `## Current State\n\nx\n\n<!-- work-fingerprint: ${fp} -->\nwork-fingerprint: ${fp}`;

test('#4029 I3: a confirmed open record with the fingerprint folds the breach — no staged file, an AUTO line, budget.trackedBy', () => {
  const root = checkout();
  const dir = runDirIn(root, 'r-tracked');
  const fp = budgetFingerprint('fast-lane');
  const { gh, calls } = fakeGh({ rows: [{ number: 12, body: 'mentions it but no marker' }, { number: 77, body: trackedBody(fp) }] });
  const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['issue', 'list', '--state', 'open', '--search', `${fp} in:body`, '--json', 'number,body', '--limit', '50']);
  assert.equal(calls[0].opts.cwd, root);
  assert.equal(calls[0].opts.timeout, 5000, 'readGhTimeoutMs default');
  assert.deepEqual(stagedIn(dir), []);
  assert.equal(r.budget.staged, null);
  assert.equal(r.budget.trackedBy, 77);
  const lines = decisionLines(dir);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^- AUTO \d{2}:\d{2}:\d{2} — efficiency budget: efficiency budget breach \(fast-lane: round-trips 10\/5\) already tracked by #77 — not re-staged\. Reversibility: n\/a\.$/);
});

test('#4029 I3: the gh timeout comes from policy.yml gh-timeout-ms', () => {
  const root = checkout({ policy: 'fast-lane-run-round-trip-ceiling: 5\ngh-timeout-ms: 12000\n' });
  const dir = runDirIn(root, 'r-timeout');
  const { gh, calls } = fakeGh();
  checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh } });
  assert.equal(calls[0].opts.timeout, 12000);
});

test('#4029 I3: a search hit whose body lacks the fingerprint is not a match — the breach is staged', () => {
  const root = checkout();
  const dir = runDirIn(root, 'r-fuzzy');
  const { gh } = fakeGh({ rows: [{ number: 5, body: `talks about ${budgetFingerprint('fast-lane')} in prose` }, { number: 6, body: trackedBody(budgetFingerprint('standard')) }] });
  const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh } });
  assert.equal(r.budget.trackedBy, undefined);
  assert.deepEqual(stagedIn(dir), ['efficiency-budget-r-fuzzy.md']);
  assert.equal(r.budget.notes, undefined);
});

test('#4029 I3: a gh failure or an unparseable answer fails open — staged as before, plus a note and a stderr line', () => {
  for (const [label, opts] of [['throw', { fail: Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }) }], ['garbage', { raw: 'not json' }]]) {
    const root = checkout();
    const dir = runDirIn(root, `r-ghfail-${label}`);
    const { gh } = fakeGh(opts);
    const r = checkBudgets({ runDir: dir, totals: TOTALS, deps: { cwd: root, gh } });
    assert.deepEqual(stagedIn(dir), [`efficiency-budget-r-ghfail-${label}.md`], label);
    assert.equal(r.budget.staged, `staged/efficiency-budget-r-ghfail-${label}.md`, label);
    assert.equal(r.budget.notes.length, 1, label);
    assert.match(r.budget.notes[0], /^open-record fold skipped \(.+\) — staged without it$/, label);
    assert.ok(r.stderr.some((l) => l === `budget: ${r.budget.notes[0]}`), `${label}: ${r.stderr.join('\n')}`);
    assert.equal(decisionLines(dir).filter((l) => l.startsWith('- STAGED')).length, 1, label);
  }
});

test('#4029 I3: a spec-N run dir under a multi-spec parent stages into the parent, keyed on the parent id', () => {
  const root = checkout();
  const parent = runDirIn(root, '2026-10-24T100000-multi');
  fs.writeFileSync(path.join(parent, 'manifest.yml'), 'specs: []\n');
  const spec = runDirIn(root, '2026-10-24T100000-multi', ['spec-41']);
  const r = checkBudgets({ runDir: spec, totals: TOTALS, deps: { cwd: root, gh: ghNone } });
  assert.deepEqual(stagedIn(spec), []);
  assert.deepEqual(stagedIn(parent), ['efficiency-budget-2026-10-24T100000-multi.md']);
  assert.equal(r.budget.staged, '../staged/efficiency-budget-2026-10-24T100000-multi.md');
  assert.deepEqual(decisionLines(spec), []);
  const staged = decisionLines(parent).filter((l) => l.startsWith('- STAGED'));
  assert.equal(staged.length, 1);
  assert.ok(staged[0].includes('Stage path: staged/efficiency-budget-2026-10-24T100000-multi.md.'), staged[0]);
  // the body still names the spec run it came from
  assert.match(fs.readFileSync(path.join(parent, 'staged', 'efficiency-budget-2026-10-24T100000-multi.md'), 'utf8'), /Run `2026-10-24T100000-multi\/spec-41`/);
});

test('#4029 I3: two spec dirs of one multi-spec run leave exactly one staged item', () => {
  const root = checkout();
  const parent = runDirIn(root, 'p-two');
  fs.writeFileSync(path.join(parent, 'manifest.yml'), 'specs: []\n');
  for (const n of ['spec-1', 'spec-2']) checkBudgets({ runDir: runDirIn(root, 'p-two', [n]), totals: TOTALS, deps: { cwd: root, gh: ghNone } });
  assert.deepEqual(stagedIn(parent), ['efficiency-budget-p-two.md']);
  assert.equal(decisionLines(parent).filter((l) => l.startsWith('- STAGED')).length, 1);
  for (const n of ['spec-1', 'spec-2']) assert.deepEqual(stagedIn(path.join(parent, n)), [], n);
});

test('#4029 I3: a spec-N dir whose parent holds no manifest.yml stages in its own dir', () => {
  const root = checkout();
  const spec = runDirIn(root, 'p-nomanifest', ['spec-3']);
  const r = checkBudgets({ runDir: spec, totals: TOTALS, deps: { cwd: root, gh: ghNone } });
  assert.deepEqual(stagedIn(spec), ['efficiency-budget-spec-3.md']);
  assert.equal(r.budget.staged, 'staged/efficiency-budget-spec-3.md');
});
