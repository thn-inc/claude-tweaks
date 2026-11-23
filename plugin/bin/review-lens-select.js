#!/usr/bin/env node
// bin/review-lens-select.js — the per-run review lens selection (#6001): which of /claude-tweaks:review Step 3's lenses
// to dispatch, decided in code from the tier, the diff facts, the per-lens history and the skip streaks.
//   node bin/review-lens-select.js --run <run-dir> --tier low|medium|high|xhigh|max --base <ref> [--risk-flags <value>]
//
// stdout, one JSON line, exactly: { tier, selected: [<lens id>], skipped: [{lens, reason}], fallback: null | "<reason>" }.
// The same object plus `v: 1` is written to {run}/lens-selection.json (lib/review-lens/selection-record.js). One
// decisions.md line per outcome (section /review, step "Step 3 lens selection"): one SKIP per skipped lens
// (`condition: {reason} → fallback: lens not dispatched`), or — on a fallback — one AUTO naming its reason. The record
// is written before the log, so a failed log leaves a record that over-counts skips (streaks then force a lens
// sooner: the safe direction), never SKIP lines with no record. Nothing is printed unless both writes succeeded.
//
// --risk-flags takes the record's `Risk-flags:` value (`auth, public-contract`, or `none`) and reads it with that line's
// own reader (issues/record-risk-flags.js's parseRiskFlagsValue, with control mode's `risk-categories`): `none`, an empty
// value or an absent flag is no flags; a malformed value or an unknown slug reads as flagged (all four built-ins).
//
// Exit codes: 0 printed; 1 a write or log failed (nothing printed); 2 malformed invocation (a bad or missing flag, an
// unknown flag, a --tier outside TIERS, a --risk-flags value over more than one line) or a --run the anchoring guard
// refuses (missing, not anchored under the main checkout's .claude-tweaks/pipelines — _shared/pipeline-run-dir.md — or
// no main checkout resolvable from the cwd). A relative --run resolves against the cwd.
//
// --run is the log and record target only. The history root is the main checkout's pipelines root (hooks/run-dir-resolve
// rootOnly), never --run; --run's identity under that root (`{id}`, or `{id}/spec-{N}` for a multi-spec member) is the
// run the skip streaks leave out. Each input's failure selects the full tier set (`fallback` set, `skipped: []`) with
// the reason logged — never read as "nothing calls for a lens":
//   - the diff facts cannot be computed (--base unresolvable, git diff fails, a fact throws, an unreadable
//     risk-path-globs block with control mode on): facts.js's `{ok:false, fact, reason}` -> select.js's fallback.
//   - the lens history is unreadable or malformed (readLensHistory throws, or select.js's historyProblem): fallback.
//     When the facts failed too, the fallback names both reasons; a thrown read is named by its message.
//   - the skip streaks are unreadable (readSkipStreaks `ok:false`, or it throws): select.js forces every below-floor
//     lens silently and sets no fallback, so this CLI logs the reason as one AUTO line itself.
//   - readRiskPolicy(mainRoot) throws: riskPolicy `{ error }`, so the riskPathTouched fact fails -> fallback.
// A --base equal to HEAD is an empty diff: every fact false, the rules apply as written.
// Entry contract: .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const path = require('node:path');
const { resolve: resolveRoot } = require('./lib/hooks/run-dir-resolve');
const { safeReal } = require('./lib/hooks/worktree-detect');
const { readRiskPolicy } = require('./lib/policy');
const { parseRiskFlagsValue } = require('./lib/issues/record-risk-flags');
const { resolveTarget, appendEntries, formatEntry } = require('./lib/log-decision/append');
const { computeFacts } = require('./lib/review-lens/facts');
const { readLensHistory } = require('./lib/review-lens/history');
const { selectLenses, historyProblem, TIERS } = require('./lib/review-lens/select');
const { writeLensSelection, readSkipStreaks } = require('./lib/review-lens/selection-record');

const USAGE = 'usage: review-lens-select.js --run <run-dir> --tier low|medium|high|xhigh|max --base <ref> [--risk-flags <value>]\n';
const SECTION = '/review';
const STEP = 'Step 3 lens selection';
const VALUE_FLAGS = { '--run': 'run', '--tier': 'tier', '--base': 'base', '--risk-flags': 'riskFlags' };

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  git: null,
  now: () => Date.now(),
  readLensHistory,
};

const messageOf = (err) => (err && err.message) || String(err);

// The --risk-flags value read as the record's `Risk-flags:` line: an absent or empty value is no flags.
function riskFlagsOf(value, riskPolicy) {
  if (value === null || value.trim() === '') return [];
  const extraCategories = riskPolicy && Array.isArray(riskPolicy.extraCategories) ? riskPolicy.extraCategories : [];
  return parseRiskFlagsValue(value.trim(), { extraCategories }).flags;
}

// The run's identity under the pipelines root: `{id}`, or `{id}/spec-{N}` for a multi-spec member.
function runIdentity(root, runDir) {
  const parts = path.relative(safeReal(root) || root, runDir).split(path.sep);
  if (parts[0] === 'archive') parts.shift();
  return parts.join('/');
}

function parseArgs(argv) {
  const o = { run: null, tier: null, base: null, riskFlags: null };
  for (let i = 0; i < argv.length; i++) {
    const key = Object.prototype.hasOwnProperty.call(VALUE_FLAGS, argv[i]) ? VALUE_FLAGS[argv[i]] : null;
    if (!key) return { error: `unknown argument: ${argv[i]}` };
    const value = argv[++i];
    // An empty --risk-flags is the record having no flags; every other flag needs a value.
    if (value === undefined || (value === '' && key !== 'riskFlags')) return { error: `${argv[i - 1]} requires a value` };
    if (key === 'riskFlags' && /[\r\n]/.test(value)) return { error: '--risk-flags must be one line' };
    o[key] = value;
  }
  for (const [flag, key] of Object.entries(VALUE_FLAGS)) {
    if (key !== 'riskFlags' && o[key] === null) return { error: `${flag} is required` };
  }
  if (!TIERS.includes(o.tier)) return { error: `--tier must be one of ${TIERS.join('|')}` };
  return o;
}

function run(argv, deps = {}) {
  deps = { ...realDeps, ...deps };
  const usageError = (message) => { deps.stderr(`review-lens-select.js: ${message}\n${USAGE}`); return 2; };
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);

  let cwd;
  let mainRoot;
  let target;
  try {
    cwd = deps.cwd();
    const resolved = resolveRoot({ cwd, env: deps.env, rootOnly: true });
    if (!resolved.ok) return usageError(`no main checkout resolvable: ${resolved.message}`);
    mainRoot = resolved.path;
    target = resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot });
  } catch (err) {
    return usageError(`could not resolve --run ${o.run}: ${messageOf(err)}`);
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `run dir does not exist: ${o.run}`
      : `run dir is not anchored under the main checkout's .claude-tweaks/pipelines: ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = path.dirname(target.file);

  let riskPolicy;
  try { riskPolicy = readRiskPolicy(mainRoot); } catch (err) { riskPolicy = { error: messageOf(err) }; }
  const riskFlags = riskFlagsOf(o.riskFlags, riskPolicy);
  let facts;
  try {
    facts = computeFacts({ cwd, base: o.base, riskFlags, riskPolicy, git: deps.git || undefined });
  } catch (err) {
    facts = { ok: false, fact: 'facts', reason: messageOf(err) };
  }

  const roots = [path.join(mainRoot, '.claude-tweaks', 'pipelines')];
  let history = null;
  let historyError = null;
  try { history = deps.readLensHistory({ roots }); } catch (err) { historyError = `lens history unreadable: ${messageOf(err)}`; }
  let streaks;
  try { streaks = readSkipStreaks({ roots, excludeRunId: runIdentity(roots[0], runDir) }); } catch (err) {
    streaks = { ok: false, reason: messageOf(err) };
  }

  const selection = selectLenses({ tier: o.tier, facts, history, streaks });
  // A thrown history read reaches select.js as `null`; its fallback names the throw instead (beside a facts reason).
  if (historyError) selection.fallback = selection.fallback.replace(historyProblem(null), () => historyError);

  const items = [];
  if (selection.fallback) {
    items.push({ status: 'AUTO', text: `lens selection fell back to the full ${selection.tier} tier set: ${selection.fallback}` });
  } else {
    if (!streaks.ok) items.push({ status: 'AUTO', text: `skip streaks unreadable, every below-floor lens forced: ${streaks.reason}` });
    for (const s of selection.skipped) items.push({ status: 'SKIP', text: `condition: ${s.reason} → fallback: lens not dispatched` });
  }
  const now = deps.now();
  try {
    writeLensSelection(runDir, selection);
  } catch (err) {
    deps.stderr(`review-lens-select.js: could not write the lens selection (${messageOf(err)})\n`);
    return 1;
  }
  try {
    appendEntries({
      runDir,
      items: items.map((it) => ({ section: SECTION, entry: formatEntry({ ...it, step: STEP, reversibility: 'n/a', now }) })),
    });
  } catch (err) {
    deps.stderr(`review-lens-select.js: could not log the lens selection (${messageOf(err)})\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify(selection)}\n`);
  return 0;
}

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
