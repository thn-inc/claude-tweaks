// plugin/bin/lib/init/ci-workflow-review.js — /claude-tweaks:init's report-only
// review of a project's GitHub Actions PR workflows (#5162). The five checks are
// a pure function over readWorkflowShape results (bin/lib/merge-verification.js,
// the one place workflow text is parsed); this module never parses YAML and
// never writes. It only classifies a job `if:` expression string
// (classifyDraftCondition). A workflow the reader could not follow, or whose
// draft condition is not understood, is reported as `unparsed` and never judged.
// Remedies are section names in `_shared/ci-skips-drafts.md`, never restated text.
// readWorkflowSet / readCiSources discover the two inputs by convention under
// the checkout root; every leaf is realpath-resolved and must stay inside it,
// so a symlink out of the checkout is refused and never read.
'use strict';

const fs = require('fs');
const path = require('path');
const { readWorkflowShape, DRAFT_REF } = require('../merge-verification');
const { classifyExistingWorkflow } = require('../issue-branch-tracking');
const { lstatType, resolveLeaf, canonicalRealpath } = require('../path-guard');
const { isPathContained } = require('../shared-primitives');
const { readDeclaration } = require('../verify/declaration');

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

// path-guard options: `realpath` only when the caller injected one.
const guardOpts = (fsImpl, realpath) => (realpath ? { fsImpl, realpath } : { fsImpl });

// One workflow file's entry: `{workflow, text}`, or `{workflow, unreadable}`
// naming why it was not read. Containment runs for a plain file too: a parent
// directory can be the symlink.
function readWorkflowEntry(dir, name, rootReal, fsImpl, opts) {
  const workflow = `.github/workflows/${name}`;
  const leaf = resolveLeaf(path.join(dir, name), opts);
  if (leaf.state === 'dangling') return { workflow, unreadable: 'dangling symlink — not read' };
  if (leaf.state === 'unreadable') return { workflow, unreadable: `unreadable: ${leaf.code}` };
  if (leaf.state === 'missing') return { workflow, unreadable: 'vanished during the review' };
  if (!isPathContained(leaf.path, rootReal, { orEqual: true })) {
    return { workflow, unreadable: 'symlink resolves outside the checkout — not read' };
  }
  if (lstatType(leaf.path, { fsImpl }).type !== 'file') return { workflow, unreadable: 'not a regular file' };
  try {
    return { workflow, text: fsImpl.readFileSync(leaf.path, 'utf8') };
  } catch (err) {
    return { workflow, unreadable: `could not read: ${(err && err.code) || 'EUNKNOWN'}` };
  }
}

// path-guard's `missing` covers ENOENT and ENOTDIR; only ENOENT is absent. An
// ENOTDIR (a regular file where a parent directory belongs) is unreadable.
const isAbsent = (leaf) => leaf.state === 'missing' && leaf.code === 'ENOENT';
const isUnreadable = (leaf) => leaf.state === 'unreadable' || (leaf.state === 'missing' && !isAbsent(leaf));

// resolveLeaf(p), after `parent` is resolved first: a parent that resolves
// outside the checkout is `outside` with `parent: true`, and nothing under it
// is touched, leaf or not. Then an ENOENT leaf is absent only when its parent
// is absent or a real directory. A parent that resolves to a non-directory
// reads as ENOTDIR (an OS that reports a path under a regular file as ENOENT,
// win32, must not make that file read as absent); a dangling-symlink parent
// is `dangling` with `parent: true`; an unreadable parent is unreadable.
function resolveUnder(p, parent, rootReal, fsImpl, opts) {
  const up = resolveLeaf(parent, opts);
  if (up.state === 'resolved' && !isPathContained(up.path, rootReal, { orEqual: true })) return { state: 'outside', parent: true };
  const leaf = resolveLeaf(p, opts);
  if (!isAbsent(leaf)) return leaf;
  if (up.state === 'dangling') return { state: 'dangling', parent: true };
  if (up.state === 'unreadable') return up;
  if (up.state === 'resolved' && lstatType(up.path, { fsImpl }).type !== 'directory') return { state: 'missing', code: 'ENOTDIR' };
  return leaf;
}

// `.github/workflows/*.y{a,}ml` under `root`, sorted. A missing directory is
// an empty set; a directory that exists but cannot be listed (or is not a
// directory, or it or `.github` resolves outside the checkout) is an error,
// never empty.
function readWorkflowSet(root, { fsImpl = fs, realpath } = {}) {
  const opts = guardOpts(fsImpl, realpath);
  const rootReal = canonicalRealpath(root, opts);
  if (rootReal === null) return { ok: false, error: 'could not resolve --root' };
  const leaf = resolveUnder(path.join(root, '.github', 'workflows'), path.join(root, '.github'), rootReal, fsImpl, opts);
  if (isAbsent(leaf)) return { ok: true, workflows: [] };
  if (leaf.state === 'outside') return { ok: false, error: '.github/workflows: .github resolves outside the checkout — not read' };
  if (leaf.state === 'dangling') {
    return { ok: false, error: `.github/workflows: ${leaf.parent ? '.github is a dangling symlink' : 'dangling symlink'} — not read` };
  }
  if (isUnreadable(leaf)) return { ok: false, error: `.github/workflows: unreadable: ${leaf.code} — not read` };
  if (!isPathContained(leaf.path, rootReal, { orEqual: true })) {
    return { ok: false, error: '.github/workflows resolves outside the checkout — not read' };
  }
  if (lstatType(leaf.path, { fsImpl }).type !== 'directory') return { ok: false, error: '.github/workflows is not a directory' };
  let names;
  try {
    names = fsImpl.readdirSync(leaf.path);
  } catch (err) {
    return { ok: false, error: `.github/workflows could not be listed: ${(err && err.code) || 'EUNKNOWN'}` };
  }
  const dir = path.join(root, '.github', 'workflows');
  const workflows = names.filter((n) => /\.ya?ml$/i.test(n)).sort()
    .map((name) => readWorkflowEntry(dir, name, rootReal, fsImpl, opts));
  return { ok: true, workflows };
}

// The `ci` verification sources declared in `.claude-tweaks/verify-scope.json`:
// null when the file is absent (check 2 skipped), [] when declared without
// `ci`. A declaration that is invalid, unreadable, dangling or outside the
// checkout, or under a `.claude-tweaks` that resolves outside it, is an error,
// never absent.
function readCiSources(root, { fsImpl = fs, realpath } = {}) {
  const opts = guardOpts(fsImpl, realpath);
  const rootReal = canonicalRealpath(root, opts);
  if (rootReal === null) return { ok: false, errors: ['could not resolve --root'] };
  const leaf = resolveUnder(path.join(root, '.claude-tweaks', 'verify-scope.json'), path.join(root, '.claude-tweaks'), rootReal, fsImpl, opts);
  if (isAbsent(leaf)) return { ok: true, ciSources: null };
  if (leaf.state === 'outside') return { ok: false, errors: ['verify-scope.json: .claude-tweaks resolves outside the checkout — not read'] };
  if (leaf.state === 'dangling') {
    return { ok: false, errors: [`verify-scope.json: ${leaf.parent ? '.claude-tweaks is a dangling symlink' : 'dangling symlink'} — not read`] };
  }
  if (isUnreadable(leaf)) return { ok: false, errors: [`verify-scope.json: unreadable: ${leaf.code}`] };
  if (!isPathContained(leaf.path, rootReal, { orEqual: true })) {
    return { ok: false, errors: ['verify-scope.json: resolves outside the checkout — not read'] };
  }
  const parsed = readDeclaration(leaf.path, fsImpl);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  if (parsed.missing) return { ok: true, ciSources: null };
  if (parsed.decl.ci === null) return { ok: true, ciSources: [] };
  return { ok: true, ciSources: Object.entries(parsed.decl.ci).map(([suite, s]) => ({ suite, workflow: s.workflow })) };
}

module.exports = {
  CHECKS, GENERATED_TRACKING_WORKFLOW, classifyDraftCondition, reviewWorkflows, formatRemedy, readWorkflowSet, readCiSources, guardOpts,
};
