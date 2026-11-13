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

// Per-workflow checks, in CHECKS order.
const WORKFLOW_CHECKS = [
  ['draft-skip-no-ready-for-review', checkNoReadyForReview],
  ['draft-skip-with-ci-source', checkCiSource],
];

function isGeneratedTrackingWorkflow(entry) {
  if (basenameOf(entry.workflow) !== GENERATED_TRACKING_WORKFLOW || typeof entry.text !== 'string') return false;
  const rung = classifyExistingWorkflow(entry.text);
  return rung === 'current' || rung === 'prior-generated';
}

// `workflows`: `{workflow, text}` or `{workflow, unreadable: reason}` entries,
// `workflow` the repo-display ID. `ciSources`: the declared `ci` sources, or
// null when no verify-scope.json was read (check 2 skipped).
function reviewWorkflows({ workflows, ciSources }) {
  const findings = [];
  const unparsed = [];
  const skipped = [];
  let reviewed = 0;
  for (const entry of workflows) {
    if (isGeneratedTrackingWorkflow(entry)) { skipped.push(entry.workflow); continue; }
    reviewed++;
    if (typeof entry.text !== 'string') { unparsed.push({ workflow: entry.workflow, reason: entry.unreadable }); continue; }
    const shape = readWorkflowShape(entry.text);
    const reasons = [...shape.unparsed];
    if (shape.prTrigger && shape.jobs.some((j) => j.if !== null && classifyDraftCondition(j.if) === 'unparsed')) {
      reasons.push('draft condition not understood');
    }
    if (reasons.length > 0) { unparsed.push({ workflow: entry.workflow, reason: reasons.join('; ') }); continue; }
    const draftSkipIds = shape.prTrigger
      ? shape.jobs.filter((j) => j.if !== null && classifyDraftCondition(j.if) === 'skip').map((j) => j.id)
      : [];
    const ctx = { entry, shape, draftSkipIds, ciSources };
    for (const [check, fn] of WORKFLOW_CHECKS) {
      const detail = fn(ctx);
      if (detail !== null) findings.push({ workflow: entry.workflow, check, remedy: CHECKS[check], detail });
    }
  }
  return { reviewed, findings, unparsed, skipped };
}

function formatRemedy(remedy) {
  return remedy === 'see #5152' ? remedy : `\`_shared/ci-skips-drafts.md\` § ${remedy}`;
}

module.exports = { CHECKS, GENERATED_TRACKING_WORKFLOW, classifyDraftCondition, reviewWorkflows, formatRemedy };
