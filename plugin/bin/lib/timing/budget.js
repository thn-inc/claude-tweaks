// bin/lib/timing/budget.js — the efficiency-budget check behind
// `phase-timing.js --check-budgets` (#4029). Compares a run's timing totals with
// the per-ceremony-profile ceilings policy.js reads (`readEfficiencyCeilings`);
// a breach stages one `efficiency-budget-{run-id}` proposal for the Wrap-Up
// Review Console's Queue writes section and logs it as a STAGED decision. A
// breach never blocks or fails a run: every failure here degrades to a report
// field (`budget.stageError`) plus a stderr line, never a throw to the caller.
//
// Pure pieces (evaluateBudgets, formatBudgetLine, budgetProposal, repoRootOf,
// readCeremonyProfile) are exported for direct tests; checkBudgets is the one
// call phase-timing.js makes.
'use strict';
const fs = require('fs');
const path = require('path');
const { readEfficiencyCeilings } = require('../policy');
const { parseFlatLines } = require('../policy-schema');
const { specShapedBody, recordPayload } = require('../issues/record');
const { resolveTarget, writeStagedItem } = require('../stage-item/write');
const { formatEntry, appendEntry, resolveTarget: resolveDecisionTarget } = require('../log-decision/append');
const { TURN_CLASSES } = require('./turn-class');
const { canonicalRealpath, lstatType } = require('../path-guard');

const PROFILES = ['fast-lane', 'standard'];
const DEFER_REASON = 'needs-human-decision';
const FILED_BY = 'phase-timing.js --check-budgets';
// metric -> { ceilings key, policy-key measure segment, totals reader }
const METRICS = [
  { metric: 'round-trips', ceilingKey: 'roundTrips', policyMeasure: 'round-trip', read: (t) => t.toolRoundTrips },
  { metric: 'procedure-kb', ceilingKey: 'procedureKb', policyMeasure: 'procedure-kb', read: (t) => (Number.isFinite(t.procedureBytes) ? Math.round((t.procedureBytes / 1024) * 10) / 10 : undefined) },
  { metric: 'verify-minutes', ceilingKey: 'verifyMinutes', policyMeasure: 'verify-minutes', read: (t) => t.verifyMinutes },
];

// { totals, ceilings } -> [{ metric, value, ceiling, status }]. A ceiling of 0
// disables the budget; a value that is not a finite number (no transcript data)
// is unmeasured, never ok.
function evaluateBudgets({ totals, ceilings }) {
  return METRICS.map(({ metric, ceilingKey, read }) => {
    const ceiling = ceilings[ceilingKey];
    const raw = read(totals || {});
    const measured = typeof raw === 'number' && Number.isFinite(raw);
    const value = measured ? raw : null;
    let status = 'ok';
    if (ceiling === 0) status = 'disabled';
    else if (!measured) status = 'unmeasured';
    else if (value > ceiling) status = 'breach';
    return { metric, value, ceiling, status };
  });
}

function formatBudgetLine(profile, checks) {
  const cells = checks.map((c) => `${c.metric} ${c.value === null ? '—' : c.value}/${c.ceiling} ${c.status === 'breach' ? 'BREACH' : c.status}`);
  return `Budget (${profile}): ${cells.join(' · ')}`;
}

const breached = (checks) => checks.filter((c) => c.status === 'breach');
const policyKey = (profile, metric) => `${profile}-run-${METRICS.find((m) => m.metric === metric).policyMeasure}-ceiling`;

// The run's three most frequent turn classes, ties in TURN_CLASSES order, zero counts left out.
function topTurnClasses(turnClasses) {
  if (!turnClasses || typeof turnClasses !== 'object') return null;
  return TURN_CLASSES
    .map((c, i) => ({ c, i, n: turnClasses[c] }))
    .filter((x) => typeof x.n === 'number' && x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 3)
    .map((x) => `${x.c} ${x.n}`);
}

// -> the staged file text: the header leftover-routing.md's staging step defines
// (Title / Type / Labels / Defer-reason, a blank line), then the spec-shaped body.
function budgetProposal({ runId, profile, checks, totals }) {
  const over = breached(checks);
  if (over.length === 0) throw new Error('budgetProposal: no breached metric to propose on');
  const top = topTurnClasses(totals && totals.turnClasses);
  const currentState = [
    `Run \`${runId}\` (ceremony profile \`${profile}\`) exceeded ${over.length === 1 ? 'an efficiency budget' : 'efficiency budgets'} when \`${FILED_BY}\` checked it:`,
    over.map((c) => `- ${c.metric}: ${c.value} against a ceiling of ${c.ceiling} (\`${policyKey(profile, c.metric)}\`)`).join('\n'),
    top
      ? `Top turn classes by tool-call count: ${top.join(', ')}.`
      : 'Turn classes: not measured (no transcript data was read for this run).',
  ];
  const deliverables = [
    '- Investigate where the turns went (the run directory\'s `timing.json` carries the per-phase turn-class breakdown) and reduce them.',
    over.map((c) => `- Or raise \`${policyKey(profile, c.metric)}\` in \`.claude-tweaks/policy.yml\` with a rationale for the new value.`).join('\n'),
  ].join('\n');
  const acceptanceCriteria = [
    `- [ ] The next run of the \`${profile}\` profile checks within budget (\`phase-timing.js --check-budgets\` prints no BREACH).`,
    '- [ ] Or the ceiling change lands in `policy.yml` with its derivation.',
  ].join('\n');
  const body = specShapedBody({
    currentState,
    deliverables,
    acceptanceCriteria,
    releaseNote: 'No user-visible change.',
    filedBy: FILED_BY,
    provenance: { origin: `efficiency budget check on run ${runId}`, deferReason: DEFER_REASON },
  });
  const p = recordPayload({ title: `Efficiency budget breached on run ${runId} (${profile})`, body, type: 'task', deferReason: DEFER_REASON });
  return `Title: ${p.title}\nType: ${p.type}\nLabels: ${p.labels.join(', ') || 'none'}\nDefer-reason: ${DEFER_REASON}\n\n${p.body}`;
}

// The checkout root: the parent of the last `.claude-tweaks` segment of the run
// dir's real path (covers pipelines/{id} and pipelines/archive/{id}); null when
// the path has none.
function repoRootOf(runDir) {
  const real = canonicalRealpath(runDir) || path.resolve(runDir);
  const segments = real.split(path.sep);
  const at = segments.lastIndexOf('.claude-tweaks');
  if (at === -1) return null;
  return segments.slice(0, at).join(path.sep) || path.sep;
}

// { profile, source: 'config' | 'fallback' } — a missing, unreadable or invalid
// ceremony-profile in config.yml reads as `standard`.
function readCeremonyProfile(runDir) {
  let raw = null;
  try { raw = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'); } catch { /* absent -> fallback */ }
  const value = parseFlatLines(raw)['ceremony-profile'];
  return PROFILES.includes(value) ? { profile: value, source: 'config' } : { profile: 'standard', source: 'fallback' };
}

const message = (err) => (err && err.message ? err.message : String(err));

// Stages the proposal and logs it. Throws on any failure; the caller reports it.
// -> the run-relative staged path. The decision-log append is skipped when this
// stage path is already logged, so a re-run overwrites the one staged file
// without logging it twice.
function stageProposal({ runDir, runId, profile, checks, totals }) {
  const target = resolveTarget({ runDir });
  if (!target.ok) throw new Error(`run directory ${target.reason} — not an anchored run directory under the main checkout ([IL-127])`);
  const stagePath = `staged/efficiency-budget-${runId}.md`;
  writeStagedItem({
    runDir: target.dir, id: `efficiency-budget-${runId}`, sourcePath: 'proposal.md', content: budgetProposal({ runId, profile, checks, totals }),
  });
  const decisionTarget = resolveDecisionTarget({ runDir });
  if (!decisionTarget.ok) throw new Error(`staged ${stagePath} but could not log it (decision log ${decisionTarget.reason})`);
  let logged = '';
  try { logged = fs.readFileSync(decisionTarget.file, 'utf8'); } catch { /* no decisions.md yet */ }
  if (!logged.includes(`Stage path: ${stagePath}.`)) {
    const metrics = breached(checks).map((c) => `${c.metric} ${c.value}/${c.ceiling}`).join(', ');
    appendEntry({
      runDir: target.dir,
      section: '/wrap-up',
      entry: formatEntry({
        status: 'STAGED',
        now: Date.now(),
        step: 'efficiency budget',
        text: `Efficiency budget breached (${profile}): ${metrics}. Stage path: ${stagePath}.`,
        reversibility: 'high',
      }),
    });
  }
  return stagePath;
}

// { runDir, totals } -> { budget, line, stderr[] } for timing.json's `budget` key.
// totals carries toolRoundTrips / procedureBytes only when a transcript was read.
// Never throws: a staging failure becomes budget.staged = null + budget.stageError.
function checkBudgets({ runDir, totals }) {
  const stderr = [];
  const repoRoot = repoRootOf(runDir);
  if (repoRoot === null) {
    stderr.push('budget: skipped — no .claude-tweaks ancestor');
    return { budget: { skipped: 'no .claude-tweaks ancestor' }, line: null, stderr };
  }
  const { profile, source } = readCeremonyProfile(runDir);
  if (source === 'fallback') stderr.push('budget: ceremony-profile absent from config.yml — checked against standard');
  const checks = evaluateBudgets({ totals, ceilings: readEfficiencyCeilings(repoRoot, profile) });
  const budget = { profile, profileSource: source, checks, staged: null };
  if (breached(checks).length > 0) {
    const runId = path.basename(path.resolve(runDir));
    try {
      budget.staged = stageProposal({ runDir, runId, profile, checks, totals });
    } catch (err) {
      budget.stageError = message(err);
      stderr.push(`budget: could not stage the efficiency-budget proposal (${budget.stageError})`);
      // a throw after the file landed (the log step) leaves the file in place: report its path
      if (lstatType(path.join(runDir, 'staged', `efficiency-budget-${runId}.md`)).type === 'file') budget.staged = `staged/efficiency-budget-${runId}.md`;
    }
  }
  return { budget, line: formatBudgetLine(profile, checks), stderr };
}

module.exports = {
  evaluateBudgets, formatBudgetLine, budgetProposal, repoRootOf, readCeremonyProfile, checkBudgets,
};
