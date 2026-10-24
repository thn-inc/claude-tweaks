// bin/lib/timing/budget.js — the efficiency-budget check behind
// `phase-timing.js --check-budgets` (#4029). Compares a run's timing totals with
// the per-ceremony-profile ceilings policy.js reads (`readEfficiencyCeilings`);
// a breach stages one `efficiency-budget-{run-id}` proposal for the Wrap-Up
// Review Console's Queue writes section and logs it as a STAGED decision. A
// breach never blocks or fails a run: every failure here degrades to a report
// field (`budget.stageError`) plus a stderr line, never a throw to the caller,
// and every degrade the run's decision log can carry also lands there as a
// SKIP line (checkBudgets).
//
// Repeats fold into one record per ceremony profile: the proposal's title names
// the profile and metrics (never the run id) and its body carries the
// `efficiency-budget:{profile}` work fingerprint. Before staging, an OPEN record
// carrying that fingerprint is looked up through the injectable `deps.gh`
// runner (gh-api-module-pattern); a confirmed match logs AUTO and stages
// nothing, and a gh failure fails open (staged, plus a `budget.notes` line). A
// multi-spec run's `{parent}/spec-N` dir stages into the parent, keyed on the
// parent id, so N specs leave one item.
//
// Pure pieces (evaluateBudgets, formatBudgetLine, budgetProposal,
// budgetFingerprint, repoRootOf, readCeremonyProfile) are exported for direct
// tests; checkBudgets is the one call phase-timing.js makes.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readEfficiencyCeilings, readGhTimeoutMs } = require('../policy');
const { parseFlatLines } = require('../policy-schema');
const { specShapedBody, recordPayload, checkFingerprint } = require('../issues/record');
const { fingerprintFromBasis } = require('../health-core/fingerprint');
const { fingerprintMap } = require('../console/finding-filing');
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

// The work fingerprint the proposal's body carries: one open record per profile.
const budgetFingerprint = (profile) => fingerprintFromBasis('efficiencybudget', [`efficiency-budget:${profile}`]);

// -> the staged file text: the header leftover-routing.md's staging step defines
// (Title / Type / Labels / Defer-reason, a blank line), then the spec-shaped body.
// The title is stable across runs (profile + metrics); runId appears in the body only.
// unattributed: timing.json's `unattributed` bucket, absent without a transcript.
function budgetProposal({ runId, profile, checks, totals, unattributed }) {
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
  const total = totals && totals.toolRoundTrips;
  const outside = unattributed && unattributed.toolRoundTrips;
  if (Number.isFinite(total) && total > 0 && Number.isFinite(outside)) {
    const pct = Math.round((outside * 100) / total);
    currentState.push(`Unattributed round trips: ${outside} of ${total} (${pct}%) fell outside every phase, so the per-phase breakdown in \`timing.json\` covers the other ${100 - pct}%.`);
  }
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
  const p = recordPayload({
    title: `Efficiency budget: ${profile} runs over the ${over.map((c) => c.metric).join(', ')} ceiling`,
    body, type: 'task', deferReason: DEFER_REASON, fingerprint: budgetFingerprint(profile),
  });
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

// Appends one /wrap-up entry to runDir's decisions.md through the same
// resolve + appendEntry path the STAGED line takes. -> null when it landed, or
// the reason it did not (an unresolvable log, a failed append).
function logBudgetEntry({ runDir, cwd, status, step, text, reversibility }) {
  const target = resolveDecisionTarget({ runDir, cwd });
  if (!target.ok) return `decision log ${target.reason}`;
  try {
    appendEntry({ runDir: path.dirname(target.file), section: '/wrap-up', entry: formatEntry({ status, now: Date.now(), step, text, reversibility }) });
    return null;
  } catch (err) {
    return message(err);
  }
}

const metricList = (checks) => checks.map((c) => `${c.metric} ${c.value}/${c.ceiling}`).join(', ');

// The real gh runner: an argv array, bounded, quiet (a failed lookup is
// handled by the caller, so gh's own stderr is piped, never echoed).
function defaultGh(args, { cwd, timeout }) {
  return execFileSync('gh', args, { encoding: 'utf8', cwd, timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

const firstLine = (s) => String(s).split('\n').find((l) => l.trim()) || String(s);

// -> { number } — the OPEN record carrying `fingerprint`, or null when none —
// or { error } when gh failed or answered something other than a JSON array
// (the caller fails open). GitHub search is fuzzy, so every hit is confirmed by
// its body's marker (fingerprintMap / checkFingerprint), never by the hit alone.
// No `--` separator: `gh issue list` takes no positional argument, and the one
// computed value rides inside --search's own value and never begins with `-`.
function findTrackingRecord({ fingerprint, repoRoot, gh }) {
  let out;
  try {
    out = gh(['issue', 'list', '--state', 'open', '--search', `${fingerprint} in:body`, '--json', 'number,body', '--limit', '50'], { cwd: repoRoot, timeout: readGhTimeoutMs(repoRoot) });
  } catch (err) {
    return { error: `gh issue list failed: ${firstLine(message(err)).slice(0, 200)}` };
  }
  let rows;
  try { rows = JSON.parse(out); } catch { rows = null; }
  if (!Array.isArray(rows)) return { error: 'gh issue list did not answer a JSON array' };
  return { number: checkFingerprint(fingerprintMap(rows), fingerprint) };
}

// A multi-spec run's per-spec dir — basename `spec-N` under a parent holding
// manifest.yml — stages into that parent, so every spec of the run overwrites
// one item. -> the dir to stage into (runDir itself otherwise).
function stagingDirOf(runDir) {
  const abs = path.resolve(runDir);
  const parent = path.dirname(abs);
  return /^spec-\d+$/.test(path.basename(abs)) && lstatType(path.join(parent, 'manifest.yml')).type === 'file' ? parent : abs;
}

// Stages the proposal and logs it. Throws on any failure; the caller reports it.
// -> the run-relative staged path. The decision-log append is skipped when this
// stage path is already logged, so a re-run overwrites the one staged file
// without logging it twice. runLabel names the run in the body (the spec dir in
// a multi-spec run); runId keys the staged id.
function stageProposal({ runDir, cwd, runId, runLabel = runId, profile, checks, totals, unattributed }) {
  const target = resolveTarget({ runDir, cwd });
  if (!target.ok) throw new Error(`run directory ${target.reason} — not an anchored run directory under the main checkout ([IL-127])`);
  const stagePath = `staged/efficiency-budget-${runId}.md`;
  writeStagedItem({
    runDir: target.dir, id: `efficiency-budget-${runId}`, sourcePath: 'proposal.md', content: budgetProposal({ runId: runLabel, profile, checks, totals, unattributed }),
  });
  const decisionTarget = resolveDecisionTarget({ runDir, cwd });
  if (!decisionTarget.ok) throw new Error(`staged ${stagePath} but could not log it (decision log ${decisionTarget.reason})`);
  let logged = '';
  try { logged = fs.readFileSync(decisionTarget.file, 'utf8'); } catch { /* no decisions.md yet */ }
  if (!logged.includes(`Stage path: ${stagePath}.`)) {
    const metrics = metricList(breached(checks));
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

// { runDir, totals, unattributed?, deps? } -> { budget, line, stderr[] } for timing.json's `budget` key.
// totals carries toolRoundTrips / procedureBytes only when a transcript was read;
// unattributed is timing.json's bucket of the same name (the proposal's share line).
// deps.cwd (default process.cwd()) anchors the staging and decision-log targets;
// deps.gh (default: real gh) is the open-record lookup's runner.
// Never throws: a staging failure becomes budget.staged = null + budget.stageError.
// Each degrade the decision log can carry is written there as a SKIP line by
// this function itself (Degrade-trace rule, _shared/auto-decision-log.md): a
// breach whose staging failed, and unmeasured metrics. No .claude-tweaks
// ancestor has no decision log to write to: budget.skipped plus stderr only.
// A breach an open record already tracks sets budget.trackedBy and logs AUTO.
function checkBudgets({ runDir, totals, unattributed, deps = {} }) {
  const cwd = deps.cwd || process.cwd();
  const gh = deps.gh || defaultGh;
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
  const notes = [];
  const skip = (logDir, text) => {
    const failed = logBudgetEntry({ runDir: logDir, cwd, status: 'SKIP', step: 'efficiency budget (degraded)', text, reversibility: 'n/a' });
    if (failed) stderr.push(`budget: could not log the degrade trace (${failed})`);
  };
  const over = breached(checks);
  if (over.length > 0) {
    // The breach's lines (STAGED, AUTO, its SKIP) go where the item is staged:
    // the multi-spec parent for a spec dir, else the run dir itself.
    const stageDir = stagingDirOf(runDir);
    const multi = stageDir !== path.resolve(runDir);
    const runId = path.basename(stageDir);
    const runLabel = multi ? `${runId}/${path.basename(path.resolve(runDir))}` : runId;
    const tracked = findTrackingRecord({ fingerprint: budgetFingerprint(profile), repoRoot, gh });
    if (tracked.error) {
      const note = `open-record fold skipped (${tracked.error}) — staged without it`;
      notes.push(note);
      stderr.push(`budget: ${note}`);
    }
    if (tracked.number) {
      budget.trackedBy = tracked.number;
      const failed = logBudgetEntry({
        runDir: stageDir, cwd, status: 'AUTO', step: 'efficiency budget', reversibility: 'n/a',
        text: `efficiency budget breach (${profile}: ${metricList(over)}) already tracked by #${tracked.number} — not re-staged`,
      });
      if (failed) stderr.push(`budget: could not log the already-tracked decision (${failed})`);
    } else {
      const rel = (p) => (multi ? `../${p}` : p);
      try {
        budget.staged = rel(stageProposal({ runDir: stageDir, cwd, runId, runLabel, profile, checks, totals, unattributed }));
      } catch (err) {
        budget.stageError = message(err);
        stderr.push(`budget: could not stage the efficiency-budget proposal (${budget.stageError})`);
        // a throw after the file landed (the log step) leaves the file in place: report its path
        if (lstatType(path.join(stageDir, 'staged', `efficiency-budget-${runId}.md`)).type === 'file') budget.staged = rel(`staged/efficiency-budget-${runId}.md`);
        else skip(stageDir, `condition: breach of ${metricList(over)} found but staging failed (${budget.stageError}) → fallback: no Review Console item this run; breach recorded in timing.json budget`);
      }
    }
  }
  const unmeasured = checks.filter((c) => c.status === 'unmeasured');
  if (unmeasured.length > 0) skip(runDir, `condition: ${unmeasured.map((c) => c.metric).join(', ')} unmeasured (no transcript rows) → fallback: only measured metrics checked`);
  if (notes.length > 0) budget.notes = notes;
  return { budget, line: formatBudgetLine(profile, checks), stderr };
}

module.exports = {
  evaluateBudgets, formatBudgetLine, budgetProposal, budgetFingerprint, repoRootOf, readCeremonyProfile, checkBudgets,
};
