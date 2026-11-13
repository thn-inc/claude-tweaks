// plugin/bin/lib/init/ci-workflow-review.js — /claude-tweaks:init's report-only
// review of a project's GitHub Actions PR workflows (#5162). The five checks are
// a pure function over readWorkflowShape results (bin/lib/merge-verification.js,
// the one place workflow text is parsed); this module never parses YAML and
// never writes. It only classifies a job `if:` expression string
// (classifyDraftCondition). A workflow the reader could not follow, or whose
// draft condition is not understood, is reported as `unparsed` and never judged.
// Remedies are section names in `_shared/ci-skips-drafts.md`, never restated text.
'use strict';

const { readWorkflowShape, DRAFT_REF } = require('../merge-verification');
const { classifyExistingWorkflow } = require('../issue-branch-tracking');

// Check id -> remedy, in report order.
const CHECKS = Object.freeze({
  'draft-skip-no-ready-for-review': 'Workflow shape',
  'draft-skip-with-ci-source': 'Coexistence with the `ci` verification source',
  'paths-filter-no-always-reporting-job': 'Path filters',
  'no-cancel-in-progress-concurrency': 'Concurrency',
  'push-all-step-gated': 'see #5152',
});

// The plugin's own generated issue-tracking workflow (init Step 16): skipped
// while it is the current or an earlier generated version, reviewed once edited.
const GENERATED_TRACKING_WORKFLOW = 'track-issue-fixes.yml';

const D = String.raw`github\.event\.pull_request(?:\.draft|\[[ \t]*'draft'[ \t]*\]|\[[ \t]*"draft"[ \t]*\])`;
const SKIP = new RegExp(String.raw`^(?:![ \t]*${D}|${D}[ \t]*==[ \t]*false|${D}[ \t]*!=[ \t]*true)$`);
const DRAFT_ONLY = new RegExp(String.raw`^(?:${D}[ \t]*==[ \t]*true|${D}[ \t]*!=[ \t]*false)$`);

// `s` split on `&&` at paren depth 0 outside quotes, in one pass; null when a
// quote never closes or the parens do not balance.
function splitTopLevelAnd(s) {
  const clauses = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote !== null) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') { if (--depth < 0) return null; }
    else if (c === '&' && s[i + 1] === '&' && depth === 0) {
      clauses.push(s.slice(start, i).trim());
      start = i + 2;
      i++;
    }
  }
  if (quote !== null || depth !== 0) return null;
  clauses.push(s.slice(start).trim());
  return clauses;
}

// A job `if:` as 'skip' (the job never runs on a draft), 'draft-only' (it runs
// only on drafts), 'none' (no draft reference) or 'unparsed' (a draft reference
// in a shape not recognised whole: `||`, a function around it, a reversed
// comparison, mixed polarity). Never guesses a polarity.
function classifyDraftCondition(expr) {
  let s = String(expr).trim();
  if (s.startsWith('${{') && s.endsWith('}}')) s = s.slice(3, -2).trim();
  if (!DRAFT_REF.test(s)) return 'none';
  if (s.includes('${{') || s.includes('||')) return 'unparsed';
  const clauses = splitTopLevelAnd(s);
  if (clauses === null) return 'unparsed';
  let skip = 0;
  let draftOnly = 0;
  for (const clause of clauses) {
    if (!DRAFT_REF.test(clause)) continue;
    if (SKIP.test(clause)) skip++;
    else if (DRAFT_ONLY.test(clause)) draftOnly++;
    else return 'unparsed';
  }
  if (skip > 0 && draftOnly === 0) return 'skip';
  if (draftOnly > 0 && skip === 0) return 'draft-only';
  return 'unparsed';
}

const basenameOf = (workflow) => workflow.slice(workflow.lastIndexOf('/') + 1);

// Check 1: drafts are skipped, and the PR going ready never re-runs the job.
function checkNoReadyForReview({ shape, draftSkipIds }) {
  if (draftSkipIds.length === 0 || shape.types.includes('ready_for_review')) return null;
  return `job(s) ${draftSkipIds.join(', ')} skip drafts; types: ${shape.types.join(', ')}${shape.typesDeclared ? '' : ' (default)'}`;
}

// Check 2: a `ci` verification source names a workflow that skips drafts.
function checkCiSource({ entry, shape, draftSkipIds, ciSources }) {
  if (ciSources === null || draftSkipIds.length === 0) return null;
  const names = new Set([basenameOf(entry.workflow), entry.workflow]);
  if (shape.name !== null) names.add(shape.name);
  const suites = [...new Set(ciSources.filter((s) => names.has(s.workflow)).map((s) => s.suite))];
  if (suites.length === 0) return null;
  return `ci source ${suites.join(', ')} names this workflow; job(s) ${draftSkipIds.join(', ')} skip drafts`;
}

// The reader reasons that leave a workflow's PR trigger unknown.
const PR_TRIGGER_UNREAD = new Set(['pull_request trigger not read', 'on: block not read', 'tab indentation in on:', 'anchor or alias in on:']);

// A reviewed, not-unparsed PR workflow with no filter, types that cover every PR
// head (opened and synchronize; undeclared types read as the default set, which
// has both) and a job with no `if:`: it reports on every PR, so a required check
// never waits on a paths filter.
const isAlwaysReporting = (row) => row.reasons.length === 0 && row.shape.prTrigger
  && row.shape.prFilters.length === 0 && ['opened', 'synchronize'].every((t) => row.shape.types.includes(t))
  && row.shape.jobs.some((j) => j.if === null);

// An unparsed workflow that could have been the always-reporting one: an
// unreadable file (its trigger is unknown), a PR workflow, or one whose PR
// trigger was not read.
const isPrCandidate = (row) => row.reasons.length > 0
  && (row.shape === null || row.shape.prTrigger || row.reasons.some((r) => PR_TRIGGER_UNREAD.has(r)));

// Check 3: a paths filter, and no other workflow reports on every PR. An
// unparsed workflow never counts; the ones that might have are named.
function checkPathsFilter({ row, shape, rows }) {
  const carried = [];
  for (const [trigger, keys] of Object.entries(shape.prFiltersByTrigger)) {
    const filters = keys.filter((k) => k === 'paths' || k === 'paths-ignore');
    if (filters.length > 0) carried.push(`${filters.join(', ')} on ${trigger}`);
  }
  if (!shape.prTrigger || carried.length === 0) return null;
  const others = rows.filter((r) => r !== row);
  if (others.some(isAlwaysReporting)) return null;
  const files = others.filter(isPrCandidate).map((r) => r.entry.workflow);
  return `${carried.join('; ')}; no always-reporting workflow${files.length > 0 ? ` (unparsed, not counted: ${files.join(', ')})` : ''}`;
}

// Check 4: a PR workflow without workflow-level `cancel-in-progress: true`
// (an expression never reaches here: it is unparsed).
function checkConcurrency({ shape }) {
  if (!shape.prTrigger || shape.concurrency === 'cancel-true') return null;
  if (shape.concurrency === 'absent') {
    return shape.jobs.some((j) => j.concurrency) ? 'job-level concurrency only' : 'no workflow-level concurrency';
  }
  if (shape.concurrency === 'no-cancel') return 'concurrency has no cancel-in-progress';
  return 'cancel-in-progress: false';
}

// Check 5: push on every branch, gated only at step level.
function checkPushStepGated({ shape }) {
  if (!shape.pushTrigger || shape.pushBranchesIgnore) return null;
  if (shape.pushBranches !== 'absent' && shape.pushBranches !== 'all') return null;
  if (shape.pushTags && shape.pushBranches === 'absent') return null;
  if (shape.jobs.some((j) => j.if !== null)) return null;
  const n = shape.jobs.reduce((sum, j) => sum + j.stepIfCount, 0);
  return n > 0 ? `push on every branch; no job-level if:, ${n} step-level if:` : null;
}

// Per-workflow checks, in CHECKS order.
const WORKFLOW_CHECKS = [
  ['draft-skip-no-ready-for-review', checkNoReadyForReview],
  ['draft-skip-with-ci-source', checkCiSource],
  ['paths-filter-no-always-reporting-job', checkPathsFilter],
  ['no-cancel-in-progress-concurrency', checkConcurrency],
  ['push-all-step-gated', checkPushStepGated],
];

function isGeneratedTrackingWorkflow(entry) {
  if (basenameOf(entry.workflow) !== GENERATED_TRACKING_WORKFLOW || typeof entry.text !== 'string') return false;
  const rung = classifyExistingWorkflow(entry.text);
  return rung === 'current' || rung === 'prior-generated';
}

// `workflows`: `{workflow, text}` or `{workflow, unreadable: reason}` entries,
// `workflow` the repo-display ID. `ciSources`: the declared `ci` sources, or
// null when no verify-scope.json was read (check 2 skipped).
// Every shape is read first: check 3 looks across the whole reviewed set.
function reviewWorkflows({ workflows, ciSources }) {
  const findings = [];
  const unparsed = [];
  const skipped = [];
  const rows = [];
  for (const entry of workflows) {
    if (isGeneratedTrackingWorkflow(entry)) { skipped.push(entry.workflow); continue; }
    if (typeof entry.text !== 'string') { rows.push({ entry, shape: null, reasons: [entry.unreadable] }); continue; }
    const shape = readWorkflowShape(entry.text);
    const reasons = [...shape.unparsed];
    if (shape.prTrigger && shape.jobs.some((j) => j.if !== null && classifyDraftCondition(j.if) === 'unparsed')) {
      reasons.push('draft condition not understood');
    }
    if (shape.prTrigger && shape.concurrency === 'cancel-expression') reasons.push('cancel-in-progress expression not evaluated');
    rows.push({ entry, shape, reasons });
  }
  for (const row of rows) {
    const { entry, shape, reasons } = row;
    if (reasons.length > 0) { unparsed.push({ workflow: entry.workflow, reason: reasons.join('; ') }); continue; }
    const draftSkipIds = shape.prTrigger
      ? shape.jobs.filter((j) => j.if !== null && classifyDraftCondition(j.if) === 'skip').map((j) => j.id)
      : [];
    const ctx = { entry, shape, draftSkipIds, ciSources, row, rows };
    for (const [check, fn] of WORKFLOW_CHECKS) {
      const detail = fn(ctx);
      if (detail !== null) findings.push({ workflow: entry.workflow, check, remedy: CHECKS[check], detail });
    }
  }
  return { reviewed: rows.length, findings, unparsed, skipped };
}

function formatRemedy(remedy) {
  return remedy === 'see #5152' ? remedy : `\`_shared/ci-skips-drafts.md\` § ${remedy}`;
}

module.exports = { CHECKS, GENERATED_TRACKING_WORKFLOW, classifyDraftCondition, reviewWorkflows, formatRemedy };
